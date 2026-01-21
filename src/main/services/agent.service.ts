/**
 * Agent Service - Integrates with Claude Agent SDK
 * Handles AI agent interactions with tool calling support
 */

import { app, BrowserWindow } from 'electron'
import { join, dirname, normalize, resolve, sep } from 'path'
import { getEmbeddedPythonDir, getPythonEnhancedPath } from './python.service'
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync, realpathSync, statSync } from 'fs'
import { getConfig, getTempSpacePath, getHaloDir, onApiConfigChange } from './config.service'
import { getConversation, saveSessionId, addMessage, updateLastMessage } from './conversation.service'
import { getSpace } from './space.service'
import { getSpaceConfig, getSpaceClaudeCodeConfig } from './space-config.service'
import { getFormattedMemory } from './memory.service'
import { getAgentDefinitions } from './agents.service'
import { buildHooksFromConfig, mergeWithBuiltinHooks } from './hooks.service'
import {
  query as claudeQuery,
  unstable_v2_createSession
} from '@anthropic-ai/claude-agent-sdk'

/**
 * SDK Patch Notes (patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch)
 *
 * The @anthropic-ai/claude-agent-sdk unstable_v2_createSession API has limitations
 * that we've patched. These patches can be removed when officially supported.
 *
 * SDK Version: 0.2.7 (upgraded from 0.1.76)
 * Change: receive() method renamed to stream()
 *
 * Official 0.2.7 SDKSessionOptions only supports:
 *   - model, pathToClaudeCodeExecutable, executable, executableArgs, env
 *
 * Patch contents:
 * 1. includePartialMessages: true - Enable token-level streaming (stream_event)
 *    - Original SDK hardcodes false, resulting in block-level output only
 *
 * 2. Full parameter pass-through - V2 Session SDKSessionOptions only accepts limited params
 *    - After patch supports: cwd, stderr, systemPrompt.append, maxThinkingTokens, maxTurns,
 *      maxBudgetUsd, fallbackModel, permissionMode, allowDangerouslySkipPermissions,
 *      continueConversation, settingSources, allowedTools, disallowedTools,
 *      mcpServers, strictMcpConfig, canUseTool, hooks, forkSession,
 *      resumeSessionAt, extraArgs
 *
 * 3. interrupt() method - Interrupt current generation
 *    - Original SDK Session doesn't expose interrupt method
 *    - After patch: can call session.interrupt() to interrupt generation
 *
 * Patch file location: patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch
 * Applied automatically via patch-package on npm install
 *
 * Tracking issue: Remove when officially supported
 * - V2 Session full parameter support
 * - V2 Session interrupt method
 * - includePartialMessages configuration
 */
import { broadcastToAll, broadcastToWebSocket } from '../http/websocket'
import { ensureOpenAICompatRouter, encodeBackendConfig } from '../openai-compat-router'
import {
  isAIBrowserTool,
  AI_BROWSER_SYSTEM_PROMPT,
  createAIBrowserMcpServer
} from './ai-browser'

// Cached path to headless Electron binary (outside .app bundle to prevent Dock icon on macOS)
let headlessElectronPath: string | null = null

/**
 * Get the path to the headless Electron binary.
 *
 * On macOS, spawning Electron with ELECTRON_RUN_AS_NODE=1 still shows a Dock icon
 * because macOS detects the .app bundle before checking the env var.
 *
 * Solution: Create a symlink outside .app bundle. Symlinks (not copies) preserve
 * framework resolution since the real binary stays in .app.
 */
function getHeadlessElectronPath(): string {
  if (headlessElectronPath && existsSync(headlessElectronPath)) {
    return headlessElectronPath
  }

  const electronPath = process.execPath

  // Non-macOS or not in .app bundle: use original path
  if (process.platform !== 'darwin' || !electronPath.includes('.app/')) {
    headlessElectronPath = electronPath
    console.log('[Agent] Using original Electron path:', headlessElectronPath)
    return headlessElectronPath
  }

  // macOS: Create symlink outside .app bundle
  try {
    const headlessDir = join(app.getPath('userData'), 'headless-electron')
    const headlessSymlinkPath = join(headlessDir, 'electron-node')

    if (!existsSync(headlessDir)) {
      mkdirSync(headlessDir, { recursive: true })
    }

    // Check if symlink needs to be created or updated
    let needsSymlink = true
    if (existsSync(headlessSymlinkPath)) {
      try {
        const stat = lstatSync(headlessSymlinkPath)
        if (stat.isSymbolicLink() && readlinkSync(headlessSymlinkPath) === electronPath) {
          needsSymlink = false
        } else {
          unlinkSync(headlessSymlinkPath)
        }
      } catch {
        try { unlinkSync(headlessSymlinkPath) } catch { /* ignore */ }
      }
    }

    if (needsSymlink) {
      console.log('[Agent] Creating headless Electron symlink:', headlessSymlinkPath)
      symlinkSync(electronPath, headlessSymlinkPath)
    }

    headlessElectronPath = headlessSymlinkPath
    return headlessElectronPath
  } catch (error) {
    console.error('[Agent] Failed to set up headless Electron symlink:', error)
    headlessElectronPath = electronPath
    return headlessElectronPath
  }
}

// Image attachment type (matches renderer types)
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

interface ImageAttachment {
  id: string
  type: 'image'
  mediaType: ImageMediaType
  data: string  // Base64 encoded
  name?: string
  size?: number
}

/**
 * Canvas Context - Injected into messages to provide AI awareness of user's open tabs
 * This allows AI to naturally understand what the user is currently viewing
 */
interface CanvasContext {
  isOpen: boolean
  tabCount: number
  activeTab: {
    type: string  // 'browser' | 'code' | 'markdown' | 'image' | 'pdf' | 'text' | 'json' | 'csv'
    title: string
    url?: string   // For browser/pdf tabs
    path?: string  // For file tabs
  } | null
  tabs: Array<{
    type: string
    title: string
    url?: string
    path?: string
    isActive: boolean
  }>
}

interface AgentRequest {
  spaceId: string
  conversationId: string
  message: string
  resumeSessionId?: string
  images?: ImageAttachment[]  // Optional images for multi-modal messages
  aiBrowserEnabled?: boolean  // Enable AI Browser tools for this request
  thinkingEnabled?: boolean  // Enable extended thinking mode (maxThinkingTokens: 10240)
  model?: string  // Model to use (for future model switching)
  canvasContext?: CanvasContext  // Current canvas state for AI awareness
}

interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'running' | 'success' | 'error' | 'waiting_approval'
  input: Record<string, unknown>
  output?: string
  error?: string
  progress?: number
  requiresApproval?: boolean
  description?: string
}

// Thought types for the agent's reasoning process
type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'system' | 'result' | 'error'

interface Thought {
  id: string
  type: ThoughtType
  content: string
  timestamp: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  isError?: boolean
  duration?: number
}

// Multi-session support: Map of conversationId -> session state
interface SessionState {
  abortController: AbortController
  spaceId: string
  conversationId: string
  pendingPermissionResolve: ((approved: boolean) => void) | null
  thoughts: Thought[]  // Backend accumulates thoughts (Single Source of Truth)
}

const activeSessions = new Map<string, SessionState>()

// V2 Session management: Map of conversationId -> persistent V2 session
// Note: SDK types are unstable after patching (return values may not be Promise<...>),
// using minimal interface for type safety and maintainability, avoiding inference to never.
type V2SDKSession = {
  send: (message: any) => void
  stream: () => AsyncIterable<any>
  close: () => void
  interrupt?: () => Promise<void> | void
  // Dynamic runtime methods (exposed via patch)
  setModel?: (model: string | undefined) => Promise<void>
  setMaxThinkingTokens?: (maxThinkingTokens: number | null) => Promise<void>
  setPermissionMode?: (mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan') => Promise<void>
}

function inferOpenAIWireApi(apiUrl: string): 'responses' | 'chat_completions' {
  const envApiType = process.env.HALO_OPENAI_API_TYPE || process.env.HALO_OPENAI_WIRE_API
  if (envApiType) {
    const v = envApiType.toLowerCase()
    if (v.includes('response')) return 'responses'
    if (v.includes('chat')) return 'chat_completions'
  }
  if (apiUrl?.includes('/responses')) return 'responses'
  return 'responses'
}

/**
 * Resolve API credentials, handling OpenAI compatibility mode.
 * When provider=openai, routes through local OpenAI-to-Anthropic proxy.
 */
async function resolveApiCredentials(config: ReturnType<typeof getConfig>, logPrefix = ''): Promise<{
  anthropicApiKey: string
  anthropicBaseUrl: string
  sdkModel: string
}> {
  let anthropicBaseUrl = config.api.apiUrl
  let anthropicApiKey = config.api.apiKey
  let sdkModel = config.api.model || 'claude-opus-4-5-20251101'

  if (config.api.provider === 'openai') {
    const router = await ensureOpenAICompatRouter({ debug: false })
    anthropicBaseUrl = router.baseUrl
    const apiType = inferOpenAIWireApi(config.api.apiUrl)
    anthropicApiKey = encodeBackendConfig({
      url: config.api.apiUrl,
      key: config.api.apiKey,
      model: config.api.model,
      ...(apiType ? { apiType } : {})
    })
    sdkModel = 'claude-sonnet-4-20250514'
    if (logPrefix) {
      console.log(`[Agent] OpenAI provider enabled${logPrefix}: routing via ${anthropicBaseUrl}`)
    }
  }

  return { anthropicApiKey, anthropicBaseUrl, sdkModel }
}

/**
 * Session configuration that requires session rebuild when changed
 * These are "process-level" parameters fixed at Claude Code subprocess startup
 */
interface SessionConfig {
  aiBrowserEnabled: boolean
  // model is now dynamic, no rebuild needed
  // thinkingEnabled is now dynamic, no rebuild needed
}

interface V2SessionInfo {
  session: V2SDKSession
  spaceId: string
  conversationId: string
  createdAt: number
  lastUsedAt: number
  // Track config at session creation time for rebuild detection
  config: SessionConfig
}

const v2Sessions = new Map<string, V2SessionInfo>()

// Session cleanup interval (clean up sessions not used for 30 minutes)
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
let cleanupIntervalId: NodeJS.Timeout | null = null

function startSessionCleanup(): void {
  if (cleanupIntervalId) return

  cleanupIntervalId = setInterval(() => {
    const now = Date.now()
    // Avoid TS downlevelIteration requirement (main process tsconfig doesn't force target=es2015)
    for (const [convId, info] of Array.from(v2Sessions.entries())) {
      if (now - info.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        console.log(`[Agent] Cleaning up idle V2 session: ${convId}`)
        try {
          info.session.close()
        } catch (e) {
          console.error(`[Agent] Error closing session ${convId}:`, e)
        }
        v2Sessions.delete(convId)
      }
    }
  }, 60 * 1000) // Check every minute
}

/**
 * Format Canvas Context for injection into user message
 * Returns empty string if no meaningful context to inject
 */
function formatCanvasContext(canvasContext?: CanvasContext): string {
  if (!canvasContext?.isOpen || canvasContext.tabCount === 0) {
    return ''
  }

  const activeTab = canvasContext.activeTab
  const tabsSummary = canvasContext.tabs
    .map(t => `${t.isActive ? '▶ ' : '  '}${t.title} (${t.type})${t.path ? ` - ${t.path}` : ''}${t.url ? ` - ${t.url}` : ''}`)
    .join('\n')

  return `<halo_canvas>
Content canvas currently open in Halo:
- Total ${canvasContext.tabCount} tabs
- Active: ${activeTab ? `${activeTab.title} (${activeTab.type})` : 'None'}
${activeTab?.url ? `- URL: ${activeTab.url}` : ''}${activeTab?.path ? `- File path: ${activeTab.path}` : ''}

All tabs:
${tabsSummary}
</halo_canvas>

`
}

/**
 * Check if session config requires rebuild
 * Only "process-level" params need rebuild; runtime params use setXxx() methods
 */
function needsSessionRebuild(existing: V2SessionInfo, newConfig: SessionConfig): boolean {
  return existing.config.aiBrowserEnabled !== newConfig.aiBrowserEnabled
}

/**
 * Close and remove an existing V2 session (internal helper for rebuild)
 */
function closeV2SessionForRebuild(conversationId: string): void {
  const existing = v2Sessions.get(conversationId)
  if (existing) {
    console.log(`[Agent][${conversationId}] Closing V2 session for rebuild`)
    try {
      existing.session.close()
    } catch (e) {
      console.error(`[Agent][${conversationId}] Error closing session:`, e)
    }
    v2Sessions.delete(conversationId)
  }
}

/**
 * Get or create V2 Session
 *
 * V2 Session enables process reuse: subsequent messages in the same conversation
 * reuse the running CC process, avoiding process restart each time (cold start ~3-5s).
 *
 * Note: Requires SDK patch for full parameter pass-through, see notes at top of file.
 * When sessionId is provided, CC restores conversation history from disk.
 *
 * @param config - Session configuration for rebuild detection
 */
async function getOrCreateV2Session(
  spaceId: string,
  conversationId: string,
  sdkOptions: Record<string, any>,
  sessionId?: string,
  config?: SessionConfig
): Promise<V2SessionInfo['session']> {
  // Check if we have an existing session for this conversation
  const existing = v2Sessions.get(conversationId)
  if (existing) {
    // Check if config changed and requires rebuild
    if (config && needsSessionRebuild(existing, config)) {
      console.log(`[Agent][${conversationId}] Config changed (aiBrowser: ${existing.config.aiBrowserEnabled} → ${config.aiBrowserEnabled}), rebuilding session...`)
      closeV2SessionForRebuild(conversationId)
      // Fall through to create new session
    } else {
      console.log(`[Agent][${conversationId}] Reusing existing V2 session`)
      existing.lastUsedAt = Date.now()
      return existing.session
    }
  }

  // Create new session
  // If sessionId exists, pass resume to let CC restore history from disk
  // After first message, the process stays alive and maintains context in memory
  console.log(`[Agent][${conversationId}] Creating new V2 session...`)
  if (sessionId) {
    console.log(`[Agent][${conversationId}] With resume: ${sessionId}`)
  }
  const startTime = Date.now()

  // Requires SDK patch: resume parameter lets CC restore history from disk
  // Native SDK V2 Session doesn't support resume parameter
  if (sessionId) {
    sdkOptions.resume = sessionId
  }
  // Requires SDK patch: native SDK ignores most sdkOptions parameters
  // Use 'as any' to bypass type check, actual params handled by patched SDK
  const session = (await unstable_v2_createSession(sdkOptions as any)) as unknown as V2SDKSession

  console.log(`[Agent][${conversationId}] V2 session created in ${Date.now() - startTime}ms`)

  // Store session with config
  v2Sessions.set(conversationId, {
    session,
    spaceId,
    conversationId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    config: config || { aiBrowserEnabled: false }
  })

  // Start cleanup if not already running
  startSessionCleanup()

  return session
}

/**
 * Warm up V2 Session (called when user switches conversations)
 * Pre-initialize or reuse V2 Session to avoid delay when sending messages.
 */
export async function ensureSessionWarm(
  spaceId: string,
  conversationId: string
): Promise<void> {
  const config = getConfig()
  const workDir = getWorkingDir(spaceId)
  const conversation = getConversation(spaceId, conversationId)
  const sessionId = conversation?.sessionId
  const electronPath = getHeadlessElectronPath()
  const abortController = new AbortController()

  const { anthropicApiKey, anthropicBaseUrl, sdkModel } = await resolveApiCredentials(config, ' (warm)')

  const sdkOptions = buildSdkOptions({
    spaceId,
    conversationId,
    workDir,
    config,
    abortController,
    anthropicApiKey,
    anthropicBaseUrl,
    sdkModel,
    electronPath,
    aiBrowserEnabled: false,
    thinkingEnabled: false,
    stderrSuffix: ' (warm)'
  })

  try {
    console.log(`[Agent] Warming up V2 session: ${conversationId}`)
    await getOrCreateV2Session(spaceId, conversationId, sdkOptions, sessionId)
    console.log(`[Agent] V2 session warmed up: ${conversationId}`)
  } catch (error) {
    console.error(`[Agent] Failed to warm up session ${conversationId}:`, error)
  }
}

// Close V2 session for a conversation
export function closeV2Session(conversationId: string): void {
  const info = v2Sessions.get(conversationId)
  if (info) {
    console.log(`[Agent][${conversationId}] Closing V2 session`)
    try {
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session:`, e)
    }
    v2Sessions.delete(conversationId)
  }
}

// Close all V2 sessions (for app shutdown)
export function closeAllV2Sessions(): void {
  console.log(`[Agent] Closing all ${v2Sessions.size} V2 sessions`)
  // Avoid TS downlevelIteration requirement
  for (const [convId, info] of Array.from(v2Sessions.entries())) {
    try {
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session ${convId}:`, e)
    }
  }
  v2Sessions.clear()

  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
  }
}

/**
 * Invalidate all V2 sessions due to API config change.
 * Called by config.service via callback when API config changes.
 *
 * Sessions are closed immediately, but users are not interrupted.
 * New sessions will be created with updated config on next message.
 */
function invalidateAllSessions(): void {
  const count = v2Sessions.size
  if (count === 0) {
    console.log('[Agent] No active sessions to invalidate')
    return
  }

  console.log(`[Agent] Invalidating ${count} sessions due to API config change`)

  for (const [convId, info] of Array.from(v2Sessions.entries())) {
    try {
      console.log(`[Agent] Closing session: ${convId}`)
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session ${convId}:`, e)
    }
  }

  v2Sessions.clear()
  console.log('[Agent] All sessions invalidated, will use new config on next message')
}

// Register for API config change notifications
onApiConfigChange(() => {
  invalidateAllSessions()
})

let currentMainWindow: BrowserWindow | null = null

function getWorkingDir(spaceId: string): string {
  if (spaceId === 'halo-temp') {
    const artifactsDir = join(getTempSpacePath(), 'artifacts')
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true })
    }
    return artifactsDir
  }

  const space = getSpace(spaceId)
  if (space) {
    return space.path
  }

  console.log(`[Agent] WARNING: Space not found for ${spaceId}, falling back to temp path`)
  return getTempSpacePath()
}

// Plugin configuration type for skills loading
type PluginConfig = { type: 'local'; path: string }

/**
 * Build SDK options for V2 Session creation
 * Centralizes configuration to ensure consistency between ensureSessionWarm() and sendMessage()
 *
 * @param params - Configuration parameters
 * @returns SDK options object ready for getOrCreateV2Session()
 */
function buildSdkOptions(params: {
  spaceId: string
  conversationId: string
  workDir: string
  config: ReturnType<typeof getConfig>
  abortController: AbortController
  anthropicApiKey: string
  anthropicBaseUrl: string
  sdkModel: string
  electronPath: string
  aiBrowserEnabled?: boolean
  thinkingEnabled?: boolean
  stderrSuffix?: string  // Optional suffix for stderr logs (e.g., "(warm)")
}): Record<string, any> {
  const {
    spaceId,
    conversationId,
    workDir,
    config,
    abortController,
    anthropicApiKey,
    anthropicBaseUrl,
    sdkModel,
    electronPath,
    aiBrowserEnabled,
    thinkingEnabled,
    stderrSuffix = ''
  } = params

  // Get Claude Code configuration
  const claudeCodeConfig = config.claudeCode || {}
  const spaceConfig = getSpaceClaudeCodeConfig(workDir)

  // 1. Build settingSources based on compat settings
  const settingSources: string[] = []
  if (claudeCodeConfig.compat?.enableUserSettings) {
    settingSources.push('user')
  }
  if (claudeCodeConfig.compat?.enableProjectSettings) {
    settingSources.push('project')
  }

  // 2. Build plugins (configurable: system < global custom < app default < space custom < space default)
  const plugins = buildPluginsConfigFromSettings(
    workDir,
    claudeCodeConfig.plugins,
    spaceConfig.plugins,
    claudeCodeConfig.compat?.enableSystemSkills
  )

  // 3. Build memory content for system prompt
  const memoryContent = getFormattedMemory(workDir, {
    enabled: claudeCodeConfig.memory?.enabled ?? true,
    autoLoadClaudeMd: claudeCodeConfig.memory?.autoLoadClaudeMd ?? true,
    globalMemory: claudeCodeConfig.memory?.globalMemory,
    spaceMemory: spaceConfig.memory?.spaceMemory
  })

  // 4. Build agents (merge: builtin < global < space)
  const agents = getAgentDefinitions(
    claudeCodeConfig.agents || {},
    spaceConfig.agents || {}
  )

  // 5. Build hooks (merge: builtin + global + space)
  const userHooks = buildHooksFromConfig(
    claudeCodeConfig.hooks || {},
    spaceConfig.hooks || {}
  )
  const hooks = mergeWithBuiltinHooks(userHooks)

  // 6. Build tools configuration (space overrides global)
  const toolsConfig = spaceConfig.tools || claudeCodeConfig.tools || {}
  const allowedTools = toolsConfig.allowed || ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']
  const disallowedTools = toolsConfig.disallowed

  // 7. Build MCP servers (merge global + space)
  const mcpServers: Record<string, any> = {}
  // Global MCP servers
  const enabledGlobalMcp = getEnabledMcpServers(config.mcpServers || {})
  if (enabledGlobalMcp) {
    Object.assign(mcpServers, enabledGlobalMcp)
  }
  // Space MCP servers (can override global)
  if (spaceConfig.mcpServers) {
    const enabledSpaceMcp = getEnabledMcpServers(spaceConfig.mcpServers)
    if (enabledSpaceMcp) {
      Object.assign(mcpServers, enabledSpaceMcp)
    }
  }
  // Add AI Browser as SDK MCP server if enabled
  if (aiBrowserEnabled) {
    mcpServers['ai-browser'] = createAIBrowserMcpServer()
    console.log(`[Agent][${conversationId}] AI Browser MCP server added`)
  }

  const sdkOptions: Record<string, any> = {
    model: sdkModel,
    cwd: workDir,
    abortController,
    env: {
      ...process.env,
      // Add embedded Python to PATH (prepend to ensure it's found first)
      PATH: getPythonEnhancedPath(),
      ELECTRON_RUN_AS_NODE: 1,
      ELECTRON_NO_ATTACH_CONSOLE: 1,
      ANTHROPIC_API_KEY: anthropicApiKey,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      // Ensure localhost bypasses proxy
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1'
    },
    extraArgs: {
      'dangerously-skip-permissions': null
    },
    stderr: (data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr${stderrSuffix}:`, data)
    },
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      // Append: base system prompt + memory + AI Browser prompt (if enabled)
      append: buildSystemPromptAppend(workDir) + memoryContent + (aiBrowserEnabled ? AI_BROWSER_SYSTEM_PROMPT : '')
    },
    maxTurns: 50,
    allowedTools,
    ...(disallowedTools && disallowedTools.length > 0 ? { disallowedTools } : {}),
    permissionMode: 'acceptEdits' as const,
    canUseTool: createCanUseTool(workDir, spaceId, conversationId),
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],
    // Settings sources (controlled by compat settings)
    settingSources,
    // Plugins (three-tier skills loading)
    plugins,
    // Custom agents
    ...(Object.keys(agents).length > 0 ? { agents } : {}),
    // Hooks
    ...(hooks && Object.keys(hooks).length > 0 ? { hooks } : {}),
    // Extended thinking: enable when user requests it (10240 tokens, same as Claude Code CLI Tab)
    ...(thinkingEnabled ? { maxThinkingTokens: 10240 } : {}),
    // MCP servers
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {})
  }

  // Log configuration summary
  console.log(`[Agent][${conversationId}] SDK options built:`, {
    settingSources: settingSources.length > 0 ? settingSources : 'none',
    plugins: plugins.length,
    memoryEnabled: claudeCodeConfig.memory?.enabled ?? true,
    agents: Object.keys(agents).length,
    hooks: hooks ? Object.keys(hooks).length : 0,
    mcpServers: Object.keys(mcpServers).length
  })

  return sdkOptions
}

// Build plugins configuration based on config settings
// Loading order: system < global custom < app default < space custom < space default
function buildPluginsConfigFromSettings(
  workDir: string,
  globalPluginsConfig: { enabled?: boolean; globalPaths?: string[]; loadDefaultPaths?: boolean } | undefined,
  spacePluginsConfig: { paths?: string[]; disableGlobal?: boolean; loadDefaultPath?: boolean } | undefined,
  enableSystemSkills?: boolean
): PluginConfig[] {
  const plugins: PluginConfig[] = []
  const { homedir } = require('os')

  if (globalPluginsConfig?.enabled === false) {
    return plugins
  }

  const allowedBasePaths = [homedir(), workDir].filter(Boolean)

  // Validate plugin path with symlink resolution
  const isValidPluginPath = (pluginPath: string): boolean => {
    try {
      const stat = lstatSync(pluginPath)

      if (stat.isSymbolicLink()) {
        try {
          const realPath = realpathSync(pluginPath)
          const isAllowed = allowedBasePaths.some(base => {
            if (!base) return false
            const normalizedBase = normalize(resolve(base))
            const normalizedReal = normalize(resolve(realPath))
            return normalizedReal.startsWith(normalizedBase + sep) || normalizedReal === normalizedBase
          })

          if (!isAllowed) {
            console.warn(`[Agent] Security: Symlink outside allowed directories: ${pluginPath}`)
            return false
          }
          return statSync(realPath).isDirectory()
        } catch {
          return false
        }
      }

      return stat.isDirectory()
    } catch {
      return false
    }
  }

  const addPluginIfValid = (pluginPath: string): void => {
    if (isValidPluginPath(pluginPath) && !plugins.some(p => p.path === pluginPath)) {
      plugins.push({ type: 'local', path: pluginPath })
    }
  }

  const resolvePath = (inputPath: string, baseDir?: string): string => {
    if (inputPath.startsWith('~')) {
      return join(homedir(), inputPath.slice(1))
    }
    if (inputPath.startsWith('/') || inputPath.match(/^[A-Za-z]:/)) {
      return inputPath
    }
    return baseDir ? join(baseDir, inputPath) : inputPath
  }

  const disableGlobal = spacePluginsConfig?.disableGlobal === true

  // 1. System plugins
  if (enableSystemSkills && !disableGlobal) {
    addPluginIfValid(join(homedir(), '.claude', 'skills'))
  }

  // 2. Global custom paths
  if (!disableGlobal && globalPluginsConfig?.globalPaths) {
    for (const path of globalPluginsConfig.globalPaths) {
      addPluginIfValid(resolvePath(path))
    }
  }

  // 3. App-level default (~/.halo/plugins/ and ~/.halo/skills/)
  if (!disableGlobal && globalPluginsConfig?.loadDefaultPaths !== false) {
    const haloDir = getHaloDir()
    if (haloDir) {
      addPluginIfValid(join(haloDir, 'plugins'))
      addPluginIfValid(join(haloDir, 'skills'))
    }
  }

  // 4. Space custom paths
  if (spacePluginsConfig?.paths) {
    for (const path of spacePluginsConfig.paths) {
      addPluginIfValid(resolvePath(path, workDir))
    }
  }

  // 5. Space-level default ({workDir}/.claude/)
  if (workDir && spacePluginsConfig?.loadDefaultPath !== false) {
    addPluginIfValid(join(workDir, '.claude'))
  }

  if (plugins.length > 0) {
    console.log(`[Agent] Plugins loaded: ${plugins.map(p => p.path).join(', ')}`)
  }

  return plugins
}

// ============================================
// MCP Status Management
// ============================================

// MCP server status type (matches SDK)
interface McpServerStatusInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending'
  serverInfo?: {
    name: string
    version: string
  }
  error?: string
}

// Cached MCP status - updated when SDK reports status during conversation
let cachedMcpStatus: McpServerStatusInfo[] = []
let lastMcpStatusUpdate: number = 0

// Get cached MCP status
export function getCachedMcpStatus(): McpServerStatusInfo[] {
  return cachedMcpStatus
}

// Broadcast MCP status to all renderers (global, not conversation-specific)
function broadcastMcpStatus(mcpServers: Array<{ name: string; status: string }>): void {
  // Convert to our status type
  cachedMcpStatus = mcpServers.map(s => ({
    name: s.name,
    status: s.status as McpServerStatusInfo['status']
  }))
  lastMcpStatusUpdate = Date.now()

  const eventData = {
    servers: cachedMcpStatus,
    timestamp: lastMcpStatusUpdate
  }

  // 1. Send to Electron renderer via IPC (global event)
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.send('agent:mcp-status', eventData)
    console.log(`[Agent] Broadcast MCP status: ${cachedMcpStatus.length} servers`)
  }

  // 2. Broadcast to remote WebSocket clients
  try {
    // MCP status is a global event (not conversation-scoped), so send to all authenticated WS clients.
    broadcastToAll('agent:mcp-status', eventData)
  } catch (error) {
    // WebSocket module might not be initialized yet, ignore
  }
}

// Test MCP connections manually
let mcpTestInProgress = false

export async function testMcpConnections(mainWindow?: BrowserWindow | null): Promise<{ success: boolean; servers: McpServerStatusInfo[]; error?: string }> {
  if (mcpTestInProgress) {
    return { success: false, servers: cachedMcpStatus, error: 'Test already in progress' }
  }

  if (mainWindow) {
    currentMainWindow = mainWindow
  }

  mcpTestInProgress = true
  console.log('[Agent] Starting MCP connection test...')

  try {
    const config = getConfig()
    if (!config?.api?.apiKey) {
      return { success: false, servers: [], error: 'API key not configured' }
    }

    const enabledMcpServers = getEnabledMcpServers(config.mcpServers || {})
    if (!enabledMcpServers || Object.keys(enabledMcpServers).length === 0) {
      return { success: true, servers: [], error: 'No MCP servers configured' }
    }

    console.log('[Agent] MCP servers to test:', Object.keys(enabledMcpServers).join(', '))

    const cwd = getTempSpacePath()
    const electronPath = getHeadlessElectronPath()
    const { anthropicApiKey, anthropicBaseUrl, sdkModel } = await resolveApiCredentials(config, ' (MCP test)')

    console.log('[Agent] MCP test config:', JSON.stringify(enabledMcpServers, null, 2))

    const abortController = new AbortController()
    const queryIterator = claudeQuery({
      prompt: 'hi',
      options: {
        apiKey: anthropicApiKey,
        model: sdkModel,
        anthropicBaseUrl,
        cwd,
        executable: electronPath,
        executableArgs: ['--no-warnings'],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ELECTRON_NO_ATTACH_CONSOLE: '1',
          ANTHROPIC_API_KEY: anthropicApiKey,
          ANTHROPIC_BASE_URL: anthropicBaseUrl,
          NO_PROXY: 'localhost,127.0.0.1',
          no_proxy: 'localhost,127.0.0.1'
        },
        permissionMode: 'bypassPermissions',
        abortController,
        mcpServers: enabledMcpServers,
        maxTurns: 1
      } as any
    })

    let foundStatus = false
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        abortController.abort()
        reject(new Error('MCP test timeout'))
      }, 30000)
    })

    const iteratePromise = (async () => {
      for await (const msg of queryIterator) {
        console.log('[Agent] MCP test received msg type:', msg.type)

        // Check for system message which contains MCP status
        if (msg.type === 'system') {
          const mcpServers = (msg as any).mcp_servers as Array<{ name: string; status: string }> | undefined
          console.log('[Agent] MCP test mcp_servers field:', mcpServers)

          if (mcpServers) {
            console.log('[Agent] MCP test got status:', JSON.stringify(mcpServers))
            broadcastMcpStatus(mcpServers)
            foundStatus = true
          }
          // After getting system message with MCP status, abort to save resources
          abortController.abort()
          break
        }

        // If we get a result before system message, something is wrong
        if (msg.type === 'result') {
          break
        }
      }
    })()

    try {
      await Promise.race([iteratePromise, timeoutPromise])
    } catch (e) {
      // Ignore abort errors, they're expected
      if ((e as Error).name !== 'AbortError') {
        throw e
      }
    }

    if (foundStatus) {
      return { success: true, servers: cachedMcpStatus }
    } else {
      return { success: true, servers: [], error: 'No MCP status received from SDK' }
    }
  } catch (error) {
    const err = error as Error
    console.error('[Agent] MCP test error:', err)
    return { success: false, servers: cachedMcpStatus, error: err.message }
  } finally {
    mcpTestInProgress = false
  }
}

// ============================================
// Renderer Communication
// ============================================

// Send event to renderer with session identifiers
// Also broadcasts to WebSocket for remote clients
function sendToRenderer(channel: string, spaceId: string, conversationId: string, data: Record<string, unknown>): void {
  // Always include spaceId and conversationId in event data
  const eventData = { ...data, spaceId, conversationId }

  // 1. Send to Electron renderer via IPC
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.send(channel, eventData)
    console.log(`[Agent] Sent to renderer: ${channel}`, JSON.stringify(eventData).substring(0, 200))
  }

  // 2. Broadcast to remote WebSocket clients
  try {
    broadcastToWebSocket(channel, eventData)
  } catch (error) {
    // WebSocket module might not be initialized yet, ignore
  }
}

// Create tool permission handler for a specific session
function createCanUseTool(workDir: string, spaceId: string, conversationId: string): (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<{ behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string }> {
  const config = getConfig()
  const path = require('path')
  const absoluteWorkDir = path.resolve(workDir)

  return async (
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal }
  ) => {
    // Check file path tools - restrict to working directory
    const fileTools = ['Read', 'Write', 'Edit', 'Grep', 'Glob']
    if (fileTools.includes(toolName)) {
      const pathParam = (input.file_path || input.path) as string | undefined
      if (pathParam) {
        const absolutePath = path.resolve(pathParam)
        const isWithinWorkDir =
          absolutePath.startsWith(absoluteWorkDir + path.sep) || absolutePath === absoluteWorkDir

        if (!isWithinWorkDir) {
          return {
            behavior: 'deny' as const,
            message: `Can only access files within the current space: ${workDir}`
          }
        }
      }
    }

    // Check Bash commands based on permission settings
    if (toolName === 'Bash') {
      const permission = config.permissions.commandExecution

      if (permission === 'deny') {
        return { behavior: 'deny' as const, message: 'Command execution is disabled' }
      }

      if (permission === 'ask' && !config.permissions.trustMode) {
        const toolCall: ToolCall = {
          id: `tool-${Date.now()}`,
          name: toolName,
          status: 'waiting_approval',
          input,
          requiresApproval: true,
          description: `Execute command: ${input.command}`
        }

        sendToRenderer('agent:tool-call', spaceId, conversationId, toolCall as unknown as Record<string, unknown>)

        const session = activeSessions.get(conversationId)
        if (!session) {
          return { behavior: 'deny' as const, message: 'Session not found' }
        }

        return new Promise((resolve) => {
          session.pendingPermissionResolve = (approved: boolean) => {
            resolve(approved
              ? { behavior: 'allow' as const }
              : { behavior: 'deny' as const, message: 'User rejected command execution' }
            )
          }
        })
      }
    }

    // AI Browser tools are always allowed (sandboxed browser context)
    if (isAIBrowserTool(toolName)) {
      return { behavior: 'allow' as const }
    }

    return { behavior: 'allow' as const }
  }
}

// Handle tool approval from renderer for a specific conversation
export function handleToolApproval(conversationId: string, approved: boolean): void {
  const session = activeSessions.get(conversationId)
  if (session?.pendingPermissionResolve) {
    session.pendingPermissionResolve(approved)
    session.pendingPermissionResolve = null
  }
}

// Build multi-modal message content for Claude API
function buildMessageContent(text: string, images?: ImageAttachment[]): string | Array<{ type: string; [key: string]: unknown }> {
  if (!images?.length) {
    return text
  }

  const contentBlocks: Array<{ type: string; [key: string]: unknown }> = []

  if (text.trim()) {
    contentBlocks.push({ type: 'text', text })
  }

  for (const image of images) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data
      }
    })
  }

  return contentBlocks
}

// Send message to agent (supports multiple concurrent sessions)
export async function sendMessage(
  mainWindow: BrowserWindow | null,
  request: AgentRequest
): Promise<void> {
  currentMainWindow = mainWindow

  const { spaceId, conversationId, message, resumeSessionId, images, aiBrowserEnabled, thinkingEnabled, canvasContext } = request
  console.log(`[Agent] sendMessage: conv=${conversationId}${images?.length ? `, images=${images.length}` : ''}${aiBrowserEnabled ? ', AI Browser enabled' : ''}${thinkingEnabled ? ', thinking=ON' : ''}${canvasContext?.isOpen ? `, canvas tabs=${canvasContext.tabCount}` : ''}`)

  const config = getConfig()
  const workDir = getWorkingDir(spaceId)

  const { anthropicApiKey, anthropicBaseUrl, sdkModel } = await resolveApiCredentials(config, '')

  const conversation = getConversation(spaceId, conversationId)
  const sessionId = resumeSessionId || conversation?.sessionId
  const abortController = new AbortController()

  // Accumulate stderr for detailed error messages
  let stderrBuffer = ''

  // Register this session in the active sessions map
  const sessionState: SessionState = {
    abortController,
    spaceId,
    conversationId,
    pendingPermissionResolve: null,
    thoughts: []
  }
  activeSessions.set(conversationId, sessionState)

  // Add user message to conversation (with images if provided)
  addMessage(spaceId, conversationId, {
    role: 'user',
    content: message,
    images
  })

  // Add placeholder for assistant response
  addMessage(spaceId, conversationId, {
    role: 'assistant',
    content: '',
    toolCalls: []
  })

  try {
    const electronPath = getHeadlessElectronPath()

    const sdkOptions = buildSdkOptions({
      spaceId,
      conversationId,
      workDir,
      config,
      abortController,
      anthropicApiKey,
      anthropicBaseUrl,
      sdkModel,
      electronPath,
      aiBrowserEnabled,
      thinkingEnabled
    })

    // Override stderr handler to accumulate buffer for error reporting
    sdkOptions.stderr = (data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr:`, data)
      stderrBuffer += data  // Accumulate for error reporting
    }

    const t0 = Date.now()
    console.log(`[Agent][${conversationId}] Getting or creating V2 session...`)

    // Log MCP servers if configured (only enabled ones)
    const enabledMcpServers = getEnabledMcpServers(config.mcpServers || {})
    const mcpServerNames = enabledMcpServers ? Object.keys(enabledMcpServers) : []
    if (mcpServerNames.length > 0) {
      console.log(`[Agent][${conversationId}] MCP servers configured: ${mcpServerNames.join(', ')}`)
    }

    // Session config for rebuild detection
    const sessionConfig: SessionConfig = {
      aiBrowserEnabled: !!aiBrowserEnabled
    }

    // Get or create persistent V2 session for this conversation
    // Pass config for rebuild detection when aiBrowserEnabled changes
    const v2Session = await getOrCreateV2Session(spaceId, conversationId, sdkOptions, sessionId, sessionConfig)

    // Dynamic runtime parameter adjustment (via SDK patch)
    // These can be changed without rebuilding the session
    try {
      // Set thinking tokens dynamically
      if (v2Session.setMaxThinkingTokens) {
        await v2Session.setMaxThinkingTokens(thinkingEnabled ? 10240 : null)
        console.log(`[Agent][${conversationId}] Thinking mode: ${thinkingEnabled ? 'ON (10240 tokens)' : 'OFF'}`)
      }
    } catch (e) {
      console.error(`[Agent][${conversationId}] Failed to set dynamic params:`, e)
    }
    console.log(`[Agent][${conversationId}] ⏱️ V2 session ready: ${Date.now() - t0}ms`)
    // Only keep track of the LAST text block as the final reply
    // Intermediate text blocks are shown in thought process, not accumulated into message bubble
    let lastTextContent = ''
    let capturedSessionId: string | undefined

    // Token usage tracking
    // lastSingleUsage: Last API call usage (single call, represents current context size)
    let lastSingleUsage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    } | null = null

    let tokenUsage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      totalCostUsd: number
      contextWindow: number
    } | null = null

    // Token-level streaming state
    let currentStreamingText = ''  // Accumulates text_delta tokens
    let isStreamingTextBlock = false  // True when inside a text content block
    let lastStreamTime = 0  // For throttling stream updates
    const STREAM_THROTTLE_MS = 30  // Throttle updates to ~33fps

    console.log(`[Agent][${conversationId}] Sending message to V2 session...`)
    const t1 = Date.now()
    if (images && images.length > 0) {
      console.log(`[Agent][${conversationId}] Message includes ${images.length} image(s)`)
    }

    // Inject Canvas Context prefix if available
    // This provides AI awareness of what user is currently viewing
    const canvasPrefix = formatCanvasContext(canvasContext)
    const messageWithContext = canvasPrefix + message

    // Build message content (text-only or multi-modal with images)
    const messageContent = buildMessageContent(messageWithContext, images)

    // Send message to V2 session and stream response
    // For multi-modal messages, we need to send as SDKUserMessage
    if (typeof messageContent === 'string') {
      v2Session.send(messageContent)
    } else {
      // Multi-modal message: construct SDKUserMessage
      const userMessage = {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: messageContent
        }
      }
      v2Session.send(userMessage as any)
    }

    // Stream messages from V2 session
    for await (const sdkMessage of v2Session.stream()) {
      // Handle abort - check this session's controller
      if (abortController.signal.aborted) {
        console.log(`[Agent][${conversationId}] Aborted`)
        break
      }

      // Handle stream_event for token-level streaming (text only)
      if (sdkMessage.type === 'stream_event') {
        const event = (sdkMessage as any).event
        if (!event) continue

        // DEBUG: Log all stream events with timestamp (ms since send)
        const elapsed = Date.now() - t1
        // For message_start, log the full event to see if it contains content structure hints
        if (event.type === 'message_start') {
          console.log(`[Agent][${conversationId}] 🔴 +${elapsed}ms message_start FULL:`, JSON.stringify(event))
        } else {
          console.log(`[Agent][${conversationId}] 🔴 +${elapsed}ms stream_event:`, JSON.stringify({
            type: event.type,
            index: event.index,
            content_block: event.content_block,
            delta: event.delta
          }))
        }

        // Text block started
        if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
          isStreamingTextBlock = true
          currentStreamingText = event.content_block.text || ''

          // 🔑 Send precise signal for new text block (fixes truncation bug)
          // This is 100% reliable - comes directly from SDK's content_block_start event
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: '',
            isComplete: false,
            isStreaming: false,
            isNewTextBlock: true  // Signal: new text block started
          })

          console.log(`[Agent][${conversationId}] ⏱️ Text block started (isNewTextBlock signal): ${Date.now() - t1}ms after send`)
        }

        // Text delta - accumulate locally, send delta to frontend
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && isStreamingTextBlock) {
          const delta = event.delta.text || ''
          currentStreamingText += delta

          // Send delta immediately without throttling
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            delta,
            isComplete: false,
            isStreaming: true
          })
        }

        // Text block ended
        if (event.type === 'content_block_stop' && isStreamingTextBlock) {
          isStreamingTextBlock = false
          // Send final content of this block
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: currentStreamingText,
            isComplete: false,
            isStreaming: false
          })
          // Update lastTextContent for final result
          lastTextContent = currentStreamingText
          console.log(`[Agent][${conversationId}] Text block completed, length: ${currentStreamingText.length}`)
        }

        continue  // stream_event handled, skip normal processing
      }

      // DEBUG: Log all SDK messages with timestamp
      const elapsed = Date.now() - t1
      console.log(`[Agent][${conversationId}] 🔵 +${elapsed}ms ${sdkMessage.type}:`,
        sdkMessage.type === 'assistant'
          ? JSON.stringify(
              Array.isArray((sdkMessage as any).message?.content)
                ? (sdkMessage as any).message.content.map((b: any) => ({ type: b.type, id: b.id, name: b.name, textLen: b.text?.length, thinkingLen: b.thinking?.length }))
                : (sdkMessage as any).message?.content
            )
          : sdkMessage.type === 'user'
            ? `tool_result or input`
            : ''
      )

      // Extract single API call usage from assistant message (represents current context size)
      if (sdkMessage.type === 'assistant') {
        const assistantMsg = sdkMessage as any
        const msgUsage = assistantMsg.message?.usage
        if (msgUsage) {
          // Save last API call usage (overwrite each time, keep final one)
          lastSingleUsage = {
            inputTokens: msgUsage.input_tokens || 0,
            outputTokens: msgUsage.output_tokens || 0,
            cacheReadTokens: msgUsage.cache_read_input_tokens || 0,
            cacheCreationTokens: msgUsage.cache_creation_input_tokens || 0,
          }
        }
      }

      // Parse SDK message into Thought and send to renderer
      const thought = parseSDKMessage(sdkMessage)

      if (thought) {
        // Accumulate thought in backend session (Single Source of Truth)
        sessionState.thoughts.push(thought)

        // Send ALL thoughts to renderer for real-time display in thought process area
        // This includes text blocks - they appear in the timeline during generation
        sendToRenderer('agent:thought', spaceId, conversationId, { thought })

        // Handle specific thought types
        if (thought.type === 'text') {
          // Keep only the latest text block (overwritten by each new text block)
          // This becomes the final reply when generation completes
          // Intermediate texts stay in the thought process area only
          lastTextContent = thought.content

          // Send streaming update - frontend shows this during generation
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: lastTextContent,
            isComplete: false
          })
        } else if (thought.type === 'tool_use') {
          // Send tool call event
          const toolCall: ToolCall = {
            id: thought.id,
            name: thought.toolName || '',
            status: 'running',
            input: thought.toolInput || {}
          }
          sendToRenderer('agent:tool-call', spaceId, conversationId, toolCall as unknown as Record<string, unknown>)
        } else if (thought.type === 'tool_result') {
          // Send tool result event
          sendToRenderer('agent:tool-result', spaceId, conversationId, {
            type: 'tool_result',
            toolId: thought.id,
            result: thought.toolOutput || '',
            isError: thought.isError || false
          })
        } else if (thought.type === 'result') {
          // Final result - use the last text block as the final reply
          const finalContent = lastTextContent || thought.content
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: finalContent,
            isComplete: true
          })
          // Fallback: if no text block was received, use result content for persistence
          if (!lastTextContent && thought.content) {
            lastTextContent = thought.content
          }
          // Note: updateLastMessage is called after loop to include tokenUsage
          console.log(`[Agent][${conversationId}] Result thought received, ${sessionState.thoughts.length} thoughts accumulated`)
        }
      }

      // Capture session ID and MCP status from system/result messages
      // Use type assertion for SDK message properties that may vary
      const msg = sdkMessage as Record<string, unknown>
      if (sdkMessage.type === 'system') {
        const subtype = msg.subtype as string | undefined
        const sessionId = msg.session_id || (msg.message as Record<string, unknown>)?.session_id
        if (sessionId) {
          capturedSessionId = sessionId as string
          console.log(`[Agent][${conversationId}] Captured session ID:`, capturedSessionId)
        }

        // Log skills and plugins from system init message
        const skills = msg.skills as string[] | undefined
        const plugins = msg.plugins as Array<{ name: string; path: string }> | undefined
        if (skills) {
          console.log(`[Agent][${conversationId}] Loaded skills:`, skills)
        }
        if (plugins) {
          console.log(`[Agent][${conversationId}] Loaded plugins:`, JSON.stringify(plugins))
        }

        // Handle compact_boundary - context compression notification
        if (subtype === 'compact_boundary') {
          const compactMetadata = msg.compact_metadata as { trigger: 'manual' | 'auto'; pre_tokens: number } | undefined
          if (compactMetadata) {
            console.log(`[Agent][${conversationId}] Context compressed: trigger=${compactMetadata.trigger}, pre_tokens=${compactMetadata.pre_tokens}`)
            // Send compact notification to renderer
            sendToRenderer('agent:compact', spaceId, conversationId, {
              type: 'compact',
              trigger: compactMetadata.trigger,
              preTokens: compactMetadata.pre_tokens
            })
          }
        }

        // Extract MCP server status from system init message
        // SDKSystemMessage includes mcp_servers: { name: string; status: string }[]
        const mcpServers = msg.mcp_servers as Array<{ name: string; status: string }> | undefined
        if (mcpServers && mcpServers.length > 0) {
          console.log(`[Agent][${conversationId}] MCP server status:`, JSON.stringify(mcpServers))
          // Broadcast MCP status to frontend (global event, not conversation-specific)
          broadcastMcpStatus(mcpServers)
        }

        // Also capture tools list if available
        const tools = msg.tools as string[] | undefined
        if (tools) {
          console.log(`[Agent][${conversationId}] Available tools: ${tools.length}`)
        }
      } else if (sdkMessage.type === 'result') {
        if (!capturedSessionId) {
          const sessionId = msg.session_id || (msg.message as Record<string, unknown>)?.session_id
          capturedSessionId = sessionId as string
        }

        // Get cumulative cost and contextWindow from result message
        const modelUsage = msg.modelUsage as Record<string, { contextWindow?: number }> | undefined
        const totalCostUsd = msg.total_cost_usd as number | undefined

        // Get context window from first model in modelUsage (usually only one model)
        let contextWindow = 200000  // Default to 200K
        if (modelUsage) {
          const firstModel = Object.values(modelUsage)[0]
          if (firstModel?.contextWindow) {
            contextWindow = firstModel.contextWindow
          }
        }

        // Use last API call usage (single) + cumulative cost
        if (lastSingleUsage) {
          tokenUsage = {
            ...lastSingleUsage,
            totalCostUsd: totalCostUsd || 0,
            contextWindow
          }
        } else {
          // Fallback: If no assistant message, use result.usage (cumulative, less accurate but has data)
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined
          if (usage) {
            tokenUsage = {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cacheReadTokens: usage.cache_read_input_tokens || 0,
              cacheCreationTokens: usage.cache_creation_input_tokens || 0,
              totalCostUsd: totalCostUsd || 0,
              contextWindow
            }
          }
        }
        if (tokenUsage) {
          console.log(`[Agent][${conversationId}] Token usage (single API):`, tokenUsage)
        }
      }
    }

    // Save session ID for future resumption
    if (capturedSessionId) {
      saveSessionId(spaceId, conversationId, capturedSessionId)
      console.log(`[Agent][${conversationId}] Session ID saved:`, capturedSessionId)
    }

    // Ensure complete event is sent even if no result message was received
    if (lastTextContent) {
      console.log(`[Agent][${conversationId}] Sending final complete event with last text`)
      // Backend saves complete message with thoughts and tokenUsage (Single Source of Truth)
      updateLastMessage(spaceId, conversationId, {
        content: lastTextContent,
        thoughts: sessionState.thoughts.length > 0 ? [...sessionState.thoughts] : undefined,
        tokenUsage: tokenUsage || undefined  // Include token usage if available
      })
      console.log(`[Agent][${conversationId}] Saved ${sessionState.thoughts.length} thoughts${tokenUsage ? ' with tokenUsage' : ''} to backend`)
      sendToRenderer('agent:complete', spaceId, conversationId, {
        type: 'complete',
        duration: 0,
        tokenUsage  // Include token usage data
      })
    } else {
      console.log(`[Agent][${conversationId}] WARNING: No text content after SDK query completed`)
    }
  } catch (error: unknown) {
    const err = error as Error

    // Don't report abort as error
    if (err.name === 'AbortError') {
      console.log(`[Agent][${conversationId}] Aborted by user`)
      return
    }

    console.error(`[Agent][${conversationId}] Error:`, error)

    // Extract detailed error message from stderr if available
    let errorMessage = err.message || 'Unknown error occurred'

    // Windows: Check for Git Bash related errors
    if (process.platform === 'win32') {
      const isExitCode1 = errorMessage.includes('exited with code 1') ||
                          errorMessage.includes('process exited') ||
                          errorMessage.includes('spawn ENOENT')
      const isBashError = stderrBuffer?.includes('bash') ||
                          stderrBuffer?.includes('ENOENT') ||
                          errorMessage.includes('ENOENT')

      if (isExitCode1 || isBashError) {
        // Check if Git Bash is properly configured
        const { detectGitBash } = require('./git-bash.service')
        const gitBashStatus = detectGitBash()

        if (!gitBashStatus.found) {
          errorMessage = 'Command execution environment not installed. Please restart the app and complete setup, or install manually in settings.'
        } else {
          // Git Bash found but still got error - could be path issue
          errorMessage = 'Command execution failed. This may be an environment configuration issue, please try restarting the app.\n\n' +
                        `Technical details: ${err.message}`
        }
      }
    }

    if (stderrBuffer && !errorMessage.includes('Command execution')) {
      // Try to extract the most useful error info from stderr
      const mcpErrorMatch = stderrBuffer.match(/Error: Invalid MCP configuration:[\s\S]*?(?=\n\s*at |$)/m)
      const genericErrorMatch = stderrBuffer.match(/Error: [\s\S]*?(?=\n\s*at |$)/m)
      if (mcpErrorMatch) {
        errorMessage = mcpErrorMatch[0].trim()
      } else if (genericErrorMatch) {
        errorMessage = genericErrorMatch[0].trim()
      }
    }

    sendToRenderer('agent:error', spaceId, conversationId, {
      type: 'error',
      error: errorMessage
    })

    // Close V2 session on error (it may be in a bad state)
    closeV2Session(conversationId)
  } finally {
    // Clean up active session state (but keep V2 session for reuse)
    activeSessions.delete(conversationId)
    console.log(`[Agent][${conversationId}] Active session state cleaned up. V2 sessions: ${v2Sessions.size}`)
  }
}

// Stop generation for a specific conversation
export async function stopGeneration(conversationId?: string): Promise<void> {
  if (conversationId) {
    // Stop specific session
    const session = activeSessions.get(conversationId)
    if (session) {
      session.abortController.abort()
      activeSessions.delete(conversationId)

      // Interrupt V2 Session and drain stale messages
      const v2Session = v2Sessions.get(conversationId)
      if (v2Session) {
        try {
          await (v2Session.session as any).interrupt()
          console.log(`[Agent] V2 session interrupted, draining stale messages...`)

          // Drain stale messages until we hit the result
          for await (const msg of v2Session.session.stream()) {
            console.log(`[Agent] Drained: ${msg.type}`)
            if (msg.type === 'result') break
          }
          console.log(`[Agent] Drain complete for: ${conversationId}`)
        } catch (e) {
          console.error(`[Agent] Failed to interrupt/drain V2 session:`, e)
        }
      }

      console.log(`[Agent] Stopped generation for conversation: ${conversationId}`)
    }
  } else {
    // Stop all sessions (backward compatibility)
    for (const [convId, session] of Array.from(activeSessions)) {
      session.abortController.abort()

      // Interrupt V2 Session
      const v2Session = v2Sessions.get(convId)
      if (v2Session) {
        try {
          await (v2Session.session as any).interrupt()
        } catch (e) {
          console.error(`[Agent] Failed to interrupt V2 session ${convId}:`, e)
        }
      }

      console.log(`[Agent] Stopped generation for conversation: ${convId}`)
    }
    activeSessions.clear()
    console.log('[Agent] All generations stopped')
  }
}

// Check if a conversation has an active generation
export function isGenerating(conversationId: string): boolean {
  return activeSessions.has(conversationId)
}

// Get all active session conversation IDs
export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys())
}

// Get current session state for a conversation (for recovery after refresh)
export function getSessionState(conversationId: string): {
  isActive: boolean
  thoughts: Thought[]
  spaceId?: string
} {
  const session = activeSessions.get(conversationId)
  if (!session) {
    return { isActive: false, thoughts: [] }
  }
  return {
    isActive: true,
    thoughts: [...session.thoughts],
    spaceId: session.spaceId
  }
}

// Parse SDK message into a Thought object
function parseSDKMessage(message: any): Thought | null {
  const timestamp = new Date().toISOString()
  const generateId = () => `thought-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  if (message.type === 'system') {
    if (message.subtype === 'init') {
      return { id: generateId(), type: 'system', content: `Connected | Model: ${message.model || 'claude'}`, timestamp }
    }
    return null
  }

  if (message.type === 'assistant') {
    const content = message.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'thinking') {
          return { id: generateId(), type: 'thinking', content: block.thinking || '', timestamp }
        }
        if (block.type === 'tool_use') {
          return {
            id: block.id || generateId(),
            type: 'tool_use',
            content: `Tool call: ${block.name}`,
            timestamp,
            toolName: block.name,
            toolInput: block.input
          }
        }
        if (block.type === 'text') {
          return { id: generateId(), type: 'text', content: block.text || '', timestamp }
        }
      }
    }
    return null
  }

  if (message.type === 'user') {
    const content = message.message?.content

    // Handle slash command output
    if (typeof content === 'string') {
      const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
      if (match) {
        return { id: generateId(), type: 'text', content: match[1].trim(), timestamp }
      }
    }

    // Handle tool results
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result') {
          const isError = block.is_error || false
          const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          return {
            id: block.tool_use_id || generateId(),
            type: 'tool_result',
            content: isError ? 'Tool execution failed' : 'Tool execution succeeded',
            timestamp,
            toolOutput: resultContent,
            isError
          }
        }
      }
    }
    return null
  }

  if (message.type === 'result') {
    return {
      id: generateId(),
      type: 'result',
      content: message.message?.result || message.result || '',
      timestamp,
      duration: message.duration_ms
    }
  }

  return null
}

// Build system prompt append
function buildSystemPromptAppend(workDir: string): string {
  const pythonDir = getEmbeddedPythonDir()
  const pythonExecutable = process.platform === 'win32'
    ? join(pythonDir, 'python.exe')
    : join(pythonDir, 'bin', 'python3')

  return `
You are Halo, an AI assistant that helps users accomplish real work.
All created files will be saved in the user's workspace. Current workspace: ${workDir}.

## Built-in Python Environment (IMPORTANT)
This application has a built-in Python 3.11.9 environment. You MUST use the built-in Python for all Python operations:

**Built-in Python path:** ${pythonExecutable}

When executing Python commands, ALWAYS use the full path:
- Check version: \`${pythonExecutable} --version\`
- Run script: \`${pythonExecutable} script.py\`
- Install package: \`${pythonExecutable} -m pip install package_name\`

DO NOT use \`python\`, \`python3\`, or any other Python command without the full path, as they may point to different Python versions on the system.
`
}

// Filter out disabled MCP servers before passing to SDK
function getEnabledMcpServers(mcpServers: Record<string, any>): Record<string, any> | null {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return null
  }

  const enabled: Record<string, any> = {}
  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config.disabled) {
      const { disabled, ...sdkConfig } = config as any
      enabled[name] = sdkConfig
    }
  }

  return Object.keys(enabled).length > 0 ? enabled : null
}
