/**
 * SDK Configuration Builder
 *
 * Centralizes SDK configuration to ensure consistency between
 * ensureSessionWarm() and sendMessage().
 */

import { isAbsolute, join } from 'path'
import { existsSync, mkdirSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { getConfig, getTempSpacePath } from '../config.service'
import { getSpaceConfig, type SpaceToolkit } from '../space-config.service'
import { buildHooksConfig } from '../hooks.service'
import { listEnabledPlugins } from '../plugins.service'
import { isValidDirectoryPath } from '../../utils/path-validation'
import { getSpace } from '../space.service'
import { getSpaceToolkit } from '../toolkit.service'
import { createAIBrowserMcpServer, AI_BROWSER_SYSTEM_PROMPT } from '../ai-browser'
import { SKILLS_LAZY_SYSTEM_PROMPT } from '../skills-mcp-server'
import { buildPluginMcpServers } from '../plugin-mcp.service'
import { getLockedUserConfigRootDir } from '../config-source-mode.service'
import { resolveResourceRuntimePolicy as resolveNormalizedRuntimePolicy } from '../resource-runtime-policy.service'
import { resolveEffectiveConversationAi } from './ai-config-resolver'
import {
  buildAnthropicCompatEnvDefaults,
  shouldEnableAnthropicCompatEnvDefaults
} from './provider-resolver'
import { normalizeLocale, SUPPORTED_LOCALES, type LocaleCode } from '../../../shared/i18n/locale'
import type { PluginConfig, SettingSource, ToolCall } from './types'
import type { ClaudeCodeResourceRuntimePolicy } from '../../../shared/types/claude-code'

// Re-export types for convenience
export type { PluginConfig, SettingSource }

function createWorkDirResolutionError(errorCode: string, message: string): Error & { errorCode: string } {
  const error = new Error(message) as Error & { errorCode: string }
  error.errorCode = errorCode
  return error
}

/**
 * Get working directory for a space
 */
export function getWorkingDir(spaceId: string): string {
  console.log('[Agent] getWorkingDir entry', { phase: 'resolve_workdir', spaceId })

  if (spaceId === 'kite-temp') {
    const artifactsDir = join(getTempSpacePath(), 'artifacts')
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true })
    }
    console.log('[Agent] getWorkingDir resolved temp dir', {
      phase: 'resolve_workdir',
      spaceId,
      resolvedWorkDir: artifactsDir
    })
    return artifactsDir
  }

  const space = getSpace(spaceId)
  console.log('[Agent] getWorkingDir getSpace result', {
    phase: 'resolve_workdir',
    spaceId,
    resolvedWorkDir: space?.path ?? null
  })

  if (space) {
    console.log('[Agent] getWorkingDir resolved space dir', {
      phase: 'resolve_workdir',
      spaceId,
      resolvedWorkDir: space.path
    })
    return space.path
  }

  const errorCode = 'SPACE_NOT_FOUND_FOR_WORKDIR'
  console.error('[Agent] getWorkingDir failed', {
    phase: 'resolve_workdir',
    spaceId,
    errorCode
  })
  throw createWorkDirResolutionError(errorCode, `Space not found for workdir: ${spaceId}`)
}

function getConfigSkillsLazyLoad(
  config: ReturnType<typeof getConfig>,
  spaceConfig: ReturnType<typeof getSpaceConfig>
): boolean {
  return (
    config.claudeCode?.skillsLazyLoad === true ||
    spaceConfig?.claudeCode?.skillsLazyLoad === true
  )
}

/**
 * Lazy-load decision for execution paths.
 * Lazy-load is enabled by explicit config flags only.
 */
export function getEffectiveSkillsLazyLoad(
  workDir: string,
  config?: ReturnType<typeof getConfig>
): {
  configLazyLoad: boolean
  effectiveLazyLoad: boolean
  toolkit: SpaceToolkit | null
  strictSpaceOnly: boolean
} {
  const resolvedConfig = config ?? getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const configLazyLoad = getConfigSkillsLazyLoad(resolvedConfig, spaceConfig)
  const toolkit = getSpaceToolkit(workDir)
  const strictSpaceOnly = false
  const effectiveLazyLoad = configLazyLoad
  return { configLazyLoad, effectiveLazyLoad, toolkit, strictSpaceOnly }
}

export function resolveResourceRuntimePolicy(
  workDir: string,
  config?: ReturnType<typeof getConfig>,
  explicit?: ClaudeCodeResourceRuntimePolicy
): ClaudeCodeResourceRuntimePolicy {
  const resolvedConfig = config ?? getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  return resolveNormalizedRuntimePolicy(
    {
      explicit,
      spacePolicy: spaceConfig?.claudeCode?.resourceRuntimePolicy,
      globalPolicy: resolvedConfig.claudeCode?.resourceRuntimePolicy,
    },
    'agent.sdk-config.builder'
  )
}

/**
 * Build plugins configuration for skills loading.
 * Loading priority: installed plugins → global → app → space → workDir/.claude/
 */
export function buildPluginsConfig(
  workDir: string,
  options?: {
    resourceRuntimePolicy?: ClaudeCodeResourceRuntimePolicy
  }
): PluginConfig[] {
  const plugins: PluginConfig[] = []
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const claudeCodeConfig = config.claudeCode
  const { effectiveLazyLoad } = getEffectiveSkillsLazyLoad(workDir, config)
  const effectiveResourceRuntimePolicy = resolveResourceRuntimePolicy(
    workDir,
    config,
    options?.resourceRuntimePolicy
  )

  // Helper to add plugin if valid and not already added
  const addedPaths = new Set<string>()
  const addIfValid = (pluginPath: string): void => {
    const resolvedPath = isAbsolute(pluginPath) ? pluginPath : join(workDir, pluginPath)
    const canonicalPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath
    if (addedPaths.has(canonicalPath)) return
    if (isValidDirectoryPath(canonicalPath, 'Agent')) {
      plugins.push({ type: 'local', path: canonicalPath })
      addedPaths.add(canonicalPath)
    }
  }

  // Check if plugins are enabled (default: true)
  if (claudeCodeConfig?.plugins?.enabled === false) {
    console.log('[Agent] Plugins disabled by configuration')
    return plugins
  }

  if (effectiveLazyLoad) {
    console.log('[Agent] Skills lazy-load enabled: skipping plugin directories for Claude Code')
    return plugins
  }

  // 0. Load enabled plugins from registry (highest priority for marketplace plugins)
  // These are plugins installed via `claude plugins install` command
  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    addIfValid(plugin.installPath)
  }

  // Check if space disables global plugins
  const disableGlobal = spaceConfig?.claudeCode?.plugins?.disableGlobal === true

  if (!disableGlobal) {
    if (claudeCodeConfig?.enableSystemSkills) {
      console.warn('[Agent] claudeCode.enableSystemSkills is deprecated and ignored.')
    }

    // 1. Global custom paths from config.claudeCode.plugins.globalPaths
    const globalPaths = claudeCodeConfig?.plugins?.globalPaths || []
    for (const globalPath of globalPaths) {
      // Resolve relative paths from home directory
      const resolvedPath = globalPath.startsWith('/') ? globalPath : join(homedir(), globalPath)
      addIfValid(resolvedPath)
    }

    // 2. App config directory (default: ~/.kite/)
    // This loads skills/, commands/, hooks/, agents/ from ~/.kite/
    if (claudeCodeConfig?.plugins?.loadDefaultPaths !== false) {
      const kiteDir = getLockedUserConfigRootDir()
      addIfValid(kiteDir)
    }
  }

  // 3. Space custom paths from space-config.json
  const spacePaths = spaceConfig?.claudeCode?.plugins?.paths || []
  for (const spacePath of spacePaths) {
    // Resolve relative paths from workDir
    const resolvedPath = spacePath.startsWith('/') ? spacePath : join(workDir, spacePath)
    addIfValid(resolvedPath)
  }

  // 4. Default space-level path (unless disabled)
  // {workDir}/.claude/ - Claude Code CLI compatible
  if (spaceConfig?.claudeCode?.plugins?.loadDefaultPath !== false) {
    if (workDir) {
      addIfValid(join(workDir, '.claude'))
    }
  }

  // Single summary log
  if (plugins.length > 0) {
    console.log(
      `[Agent] Plugins loaded (${effectiveResourceRuntimePolicy}): ${plugins.map((p) => p.path).join(', ')}`
    )
  }

  return plugins
}

/**
 * Build settingSources configuration.
 * Controls which filesystem settings SDK will load.
 */
export function buildSettingSources(workDir: string): SettingSource[] {
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const { effectiveLazyLoad } = getEffectiveSkillsLazyLoad(workDir, config)

  if (effectiveLazyLoad) {
    console.log('[Agent] Skills lazy-load enabled: settingSources=local only')
    return ['local']
  }

  const sources: SettingSource[] = ['user', 'project']

  if (spaceConfig?.claudeCode?.enableProjectSettings === false) {
    const idx = sources.indexOf('project')
    if (idx !== -1) {
      sources.splice(idx, 1)
    }
  }

  console.log(`[Agent] Setting sources enabled: ${sources.join(', ')}`)
  return sources
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const sanitized = Object.fromEntries(
    Object.entries(value).filter(([, mapValue]) => typeof mapValue === 'string')
  )

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function sanitizeMcpServerConfig(
  name: string,
  rawConfig: unknown
): Record<string, unknown> | null {
  if (!isPlainObject(rawConfig)) {
    console.warn(`[Agent][MCP] Skip server "${name}": config must be an object`)
    return null
  }

  const typeRaw = typeof rawConfig.type === 'string' ? rawConfig.type.trim() : ''
  const type = typeRaw === '' ? 'stdio' : typeRaw

  if (type === 'stdio') {
    const command = typeof rawConfig.command === 'string' ? rawConfig.command.trim() : ''
    if (!command) {
      console.warn(`[Agent][MCP] Skip server "${name}": stdio server requires non-empty command`)
      return null
    }

    const args = Array.isArray(rawConfig.args)
      ? rawConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined
    const env = sanitizeStringMap(rawConfig.env)

    const normalized: Record<string, unknown> = {
      ...(typeRaw === 'stdio' ? { type: 'stdio' } : {}),
      command
    }

    if (args && args.length > 0) {
      normalized.args = args
    }
    if (env) {
      normalized.env = env
    }
    if (typeof rawConfig.timeout === 'number' && Number.isFinite(rawConfig.timeout) && rawConfig.timeout > 0) {
      normalized.timeout = rawConfig.timeout
    }

    return normalized
  }

  if (type === 'http' || type === 'sse') {
    const url = typeof rawConfig.url === 'string' ? rawConfig.url.trim() : ''
    if (!url) {
      console.warn(`[Agent][MCP] Skip server "${name}": ${type} server requires non-empty url`)
      return null
    }

    const headers = sanitizeStringMap(rawConfig.headers)
    return {
      type,
      url,
      ...(headers ? { headers } : {})
    }
  }

  console.warn(`[Agent][MCP] Skip server "${name}": unsupported MCP server type "${type}"`)
  return null
}

/**
 * Filter out disabled MCP servers and merge global with space-level config.
 */
export function getEnabledMcpServers(
  globalMcpServers: Record<string, any>,
  workDir?: string
): Record<string, any> | null {
  const spaceConfig = workDir ? getSpaceConfig(workDir) : null
  const spaceMcpServers = spaceConfig?.claudeCode?.mcpServers || {}

  const mergedServers = { ...globalMcpServers, ...spaceMcpServers }

  if (Object.keys(mergedServers).length === 0) {
    return null
  }

  const enabled: Record<string, any> = {}
  for (const [name, config] of Object.entries(mergedServers)) {
    const disabled = isPlainObject(config) && config.disabled === true
    if (disabled) {
      continue
    }

    const sanitizedConfig = sanitizeMcpServerConfig(name, config)
    if (!sanitizedConfig) {
      continue
    }

    enabled[name] = sanitizedConfig
  }

  return Object.keys(enabled).length > 0 ? enabled : null
}

/**
 * Build MCP servers configuration
 */
function buildMcpServersConfig(
  config: ReturnType<typeof getConfig>,
  spaceConfig: ReturnType<typeof getSpaceConfig>,
  workDir: string,
  conversationId: string,
  aiBrowserEnabled?: boolean,
  enabledPluginMcps?: string[]
): { mcpServers?: Record<string, any> } {
  const mcpDisabled =
    config.claudeCode?.mcpEnabled === false ||
    spaceConfig?.claudeCode?.mcpEnabled === false
  const enabledMcp = getEnabledMcpServers(config.mcpServers || {}, workDir)
  const mcpServers: Record<string, any> = enabledMcp ? { ...enabledMcp } : {}

  if (!mcpDisabled && enabledPluginMcps && enabledPluginMcps.length > 0) {
    const pluginServers = buildPluginMcpServers(enabledPluginMcps, mcpServers)
    Object.assign(mcpServers, pluginServers)
  }

  if (aiBrowserEnabled) {
    mcpServers['ai-browser'] = createAIBrowserMcpServer()
    console.log(`[Agent][${conversationId}] AI Browser MCP server added`)
  }

  if (mcpDisabled) {
    console.log(`[Agent][${conversationId}] MCP disabled by configuration (external only)`)
    const internalOnly = Object.fromEntries(
      Object.entries(mcpServers).filter(([name]) => name === 'ai-browser')
    )
    return Object.keys(internalOnly).length > 0 ? { mcpServers: internalOnly } : {}
  }

  return Object.keys(mcpServers).length > 0 ? { mcpServers } : {}
}

/**
 * Build system prompt append.
 */
export function buildSystemPromptAppend(workDir: string, responseLanguage: LocaleCode = 'en'): string {
  const normalizedLanguage = normalizeLocale(responseLanguage)
  const languageName = SUPPORTED_LOCALES[normalizedLanguage] || normalizedLanguage
  const base = `
You are Kite, an AI assistant that helps users accomplish real work.
All created files will be saved in the user's workspace. Current workspace: ${workDir}.

## Language policy
Use ${languageName} (${normalizedLanguage}) for all natural-language responses by default.
Keep code snippets, shell commands, file paths, environment variable names, logs, and error messages in their original language.
If the user explicitly requests a different output language in the current turn, follow that request for the current turn only.

## Workspace isolation policy
Current workspace: ${workDir}
Treat the current workspace as the only project context for this run.
Do not reuse project identity or file facts from previous workspaces/sessions.
When user asks about this project/codebase, inspect current workspace files first and answer from evidence.
If evidence is unavailable in current workspace, state uncertainty explicitly instead of guessing.

## AskUserQuestion batching policy
When information is missing, only ask AskUserQuestion for execution-blocking gaps.
In plan/code modes, AskUserQuestion has higher priority than plain-text clarification.
If blocking gaps are 2 or more, batch them into one AskUserQuestion call with at most 3 questions.
Use multiSelect=true only when multiple choices can be valid at the same time.
Avoid duplicate question texts and duplicate option labels.
Never include an explicit "Other" option in AskUserQuestion options; the UI adds it automatically.
If follow-up questions are predictable, include them in the same AskUserQuestion call.
If AskUserQuestion is unavailable, plain-text clarification is allowed only once per conversation.
`
  return base
}

/**
 * Tool permission handler type
 */
export type CanUseToolHandler = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
      message?: string
    }
  | {
      behavior: 'deny'
      message?: string
    }
>

/**
 * Parameters for building SDK options
 */
export interface BuildSdkOptionsParams {
  spaceId: string
  conversationId: string
  workDir: string
  config: ReturnType<typeof getConfig>
  abortController: AbortController
  anthropicApiKey: string
  anthropicBaseUrl: string
  sdkModel: string
  effectiveModel?: string
  useAnthropicCompatModelMapping?: boolean
  electronPath: string
  aiBrowserEnabled?: boolean
  thinkingEnabled?: boolean
  responseLanguage?: LocaleCode
  disableToolsForCompat?: boolean
  resourceRuntimePolicy?: ClaudeCodeResourceRuntimePolicy
  stderrSuffix?: string // Optional suffix for stderr logs (e.g., "(warm)")
  canUseTool?: CanUseToolHandler
  enabledPluginMcps?: string[]
}

/**
 * Build SDK options for V2 Session creation.
 * Centralizes configuration for consistency between ensureSessionWarm and sendMessage.
 */
export function buildSdkOptions(params: BuildSdkOptionsParams): Record<string, any> {
  const {
    spaceId,
    conversationId,
    workDir,
    config,
    abortController,
    anthropicApiKey,
    anthropicBaseUrl,
    sdkModel,
    effectiveModel,
    useAnthropicCompatModelMapping,
    electronPath,
    aiBrowserEnabled,
    thinkingEnabled,
    responseLanguage = 'en',
    disableToolsForCompat,
    resourceRuntimePolicy,
    stderrSuffix = '',
    canUseTool,
    enabledPluginMcps
  } = params

  const spaceConfig = getSpaceConfig(workDir)
  const effectiveResourceRuntimePolicy = resolveResourceRuntimePolicy(
    workDir,
    config,
    resourceRuntimePolicy
  )
  const { effectiveLazyLoad } = getEffectiveSkillsLazyLoad(workDir, config)
  const shouldInjectAnthropicCompatEnvDefaults = (() => {
    try {
      const effectiveAi = resolveEffectiveConversationAi(spaceId, conversationId, effectiveModel)
      return shouldEnableAnthropicCompatEnvDefaults(
        effectiveAi.profile.protocol,
        effectiveAi.profile.vendor,
        useAnthropicCompatModelMapping
      )
    } catch {
      return Boolean(useAnthropicCompatModelMapping)
    }
  })()
  const compatEnvModel = effectiveModel || sdkModel

  const configDir = effectiveLazyLoad
    ? (() => {
        const isolated = join(getTempSpacePath(), 'claude-config')
        if (!existsSync(isolated)) {
          mkdirSync(isolated, { recursive: true })
        }
        return isolated
      })()
    : getLockedUserConfigRootDir()

  const sdkOptions: Record<string, any> = {
    model: sdkModel,
    cwd: workDir,
    abortController,
    env: {
      ...process.env,
      // Set CLAUDE_CONFIG_DIR to control which Claude Code config directory is used.
      // In lazy skills mode, use an isolated empty config dir to avoid preloading skills/plugins/hooks.
      CLAUDE_CONFIG_DIR: configDir,
      ELECTRON_RUN_AS_NODE: 1,
      ELECTRON_NO_ATTACH_CONSOLE: 1,
      ANTHROPIC_API_KEY: anthropicApiKey,
      ANTHROPIC_AUTH_TOKEN: anthropicApiKey,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      // Ensure localhost bypasses proxy
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
      ...(shouldInjectAnthropicCompatEnvDefaults
        ? buildAnthropicCompatEnvDefaults(compatEnvModel)
        : {})
    },
    extraArgs: {
      'dangerously-skip-permissions': null,
      'disable-slash-commands': null
    },
    stderr: (data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr${stderrSuffix}:`, data)
    },
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: [
        buildSystemPromptAppend(workDir, responseLanguage),
        aiBrowserEnabled ? AI_BROWSER_SYSTEM_PROMPT : '',
        effectiveLazyLoad ? SKILLS_LAZY_SYSTEM_PROMPT : ''
      ].filter(Boolean).join('\n')
    },
    maxTurns: 50,
    allowedTools: [
      'Read',
      'Write',
      'Edit',
      'Grep',
      'Glob',
      'Bash',
    ],
    permissionMode: 'acceptEdits' as const,
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],
    settingSources: buildSettingSources(workDir),
    plugins: buildPluginsConfig(workDir, {
      resourceRuntimePolicy: effectiveResourceRuntimePolicy
    }),
    hooks: buildHooksConfig(workDir),
    ...(thinkingEnabled && { maxThinkingTokens: 10240 }),
    ...buildMcpServersConfig(
      config,
      spaceConfig,
      workDir,
      conversationId,
      aiBrowserEnabled,
      enabledPluginMcps
    )
  }

  // Some Anthropic-compatible backends can reject tool schemas; caller can force-disable tools.
  if (disableToolsForCompat) {
    sdkOptions.tools = []
  }

  // Add canUseTool handler if provided
  if (canUseTool) {
    sdkOptions.canUseTool = canUseTool
  }

  return sdkOptions
}

// ============================================
// Test Helpers (exported for unit testing)
// ============================================

/**
 * Test helper: Get the env object that would be passed to SDK
 * Used to verify CLAUDE_CONFIG_DIR is set correctly
 */
export function _testBuildSdkOptionsEnv(): Record<string, any> {
  return {
    CLAUDE_CONFIG_DIR: getLockedUserConfigRootDir(),
    ELECTRON_RUN_AS_NODE: 1,
    ELECTRON_NO_ATTACH_CONSOLE: 1,
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1'
  }
}

/**
 * Test helper: Get the settingSources that would be passed to SDK
 * Used to verify default sources are ['user', 'project']
 */
export function _testBuildSettingSources(workDir: string): SettingSource[] {
  return buildSettingSources(workDir)
}
