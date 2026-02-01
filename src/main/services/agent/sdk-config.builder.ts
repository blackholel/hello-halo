/**
 * SDK Configuration Builder
 *
 * Centralizes SDK configuration to ensure consistency between
 * ensureSessionWarm() and sendMessage().
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { getConfig, getTempSpacePath, getHaloDir } from '../config.service'
import { getSpaceConfig } from '../space-config.service'
import { buildHooksConfig } from '../hooks.service'
import { getInstalledPluginPaths } from '../plugins.service'
import { getEmbeddedPythonDir, getPythonEnhancedPath } from '../python.service'
import { isValidDirectoryPath } from '../../utils/path-validation'
import { getSpace } from '../space.service'
import { createAIBrowserMcpServer, AI_BROWSER_SYSTEM_PROMPT } from '../ai-browser'
import type { PluginConfig, SettingSource, ToolCall } from './types'

// Re-export types for convenience
export type { PluginConfig, SettingSource }

/**
 * Get working directory for a space
 */
export function getWorkingDir(spaceId: string): string {
  console.log(`[Agent] getWorkingDir called with spaceId: ${spaceId}`)

  if (spaceId === 'halo-temp') {
    const artifactsDir = join(getTempSpacePath(), 'artifacts')
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true })
    }
    console.log(`[Agent] Using temp space artifacts dir: ${artifactsDir}`)
    return artifactsDir
  }

  const space = getSpace(spaceId)
  console.log(
    `[Agent] getSpace result:`,
    space ? { id: space.id, name: space.name, path: space.path } : null
  )

  if (space) {
    console.log(`[Agent] Using space path: ${space.path}`)
    return space.path
  }

  console.log(`[Agent] WARNING: Space not found, falling back to temp path`)
  return getTempSpacePath()
}

/**
 * Build plugins configuration for skills loading
 * Supports multi-tier plugins: installed plugins, system, global, app-level, space-level
 *
 * Loading priority (low to high):
 * 0. Installed plugins from ~/.halo/plugins/installed_plugins.json (or ~/.claude/plugins/)
 * 1. ~/.claude/ - system config directory (only when enableSystemSkills: true)
 * 2. globalPaths - user-configured global paths
 * 3. ~/.halo/ - app config directory (loads skills/, commands/, hooks/, agents/)
 * 4. Space paths - space-specific custom paths
 * 5. {workDir}/.claude/ - default space-level path (Claude Code compatible)
 */
export function buildPluginsConfig(workDir: string): PluginConfig[] {
  const plugins: PluginConfig[] = []
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const claudeCodeConfig = config.claudeCode

  // Helper to add plugin if valid and not already added
  const addedPaths = new Set<string>()
  const addIfValid = (pluginPath: string): void => {
    if (addedPaths.has(pluginPath)) return
    if (isValidDirectoryPath(pluginPath, 'Agent')) {
      plugins.push({ type: 'local', path: pluginPath })
      addedPaths.add(pluginPath)
    }
  }

  // Check if plugins are enabled (default: true)
  if (claudeCodeConfig?.plugins?.enabled === false) {
    console.log('[Agent] Plugins disabled by configuration')
    return plugins
  }

  // 0. Load installed plugins from registry (highest priority for marketplace plugins)
  // These are plugins installed via `claude plugins install` command
  const installedPluginPaths = getInstalledPluginPaths()
  for (const pluginPath of installedPluginPaths) {
    addIfValid(pluginPath)
  }

  // Check if space disables global plugins
  const disableGlobal = spaceConfig?.claudeCode?.plugins?.disableGlobal === true

  if (!disableGlobal) {
    // 1. System config directory (optional, default: false)
    // Load ~/.claude/ which contains skills/, commands/, hooks/, agents/
    if (claudeCodeConfig?.enableSystemSkills) {
      const systemConfigPath = join(homedir(), '.claude')
      addIfValid(systemConfigPath)
    }

    // 2. Global custom paths from config.claudeCode.plugins.globalPaths
    const globalPaths = claudeCodeConfig?.plugins?.globalPaths || []
    for (const globalPath of globalPaths) {
      // Resolve relative paths from home directory
      const resolvedPath = globalPath.startsWith('/') ? globalPath : join(homedir(), globalPath)
      addIfValid(resolvedPath)
    }

    // 3. App config directory (default: ~/.halo/)
    // This loads skills/, commands/, hooks/, agents/ from ~/.halo/
    if (claudeCodeConfig?.plugins?.loadDefaultPaths !== false) {
      const haloDir = getHaloDir()
      if (haloDir) {
        // Load ~/.halo/ as a plugin directory (SDK will scan skills/, commands/, etc.)
        addIfValid(haloDir)
      }
    }
  }

  // 5. Space custom paths from space-config.json
  const spacePaths = spaceConfig?.claudeCode?.plugins?.paths || []
  for (const spacePath of spacePaths) {
    // Resolve relative paths from workDir
    const resolvedPath = spacePath.startsWith('/') ? spacePath : join(workDir, spacePath)
    addIfValid(resolvedPath)
  }

  // 6. Default space-level path (unless disabled)
  // {workDir}/.claude/ - Claude Code CLI compatible
  if (spaceConfig?.claudeCode?.plugins?.loadDefaultPath !== false) {
    if (workDir) {
      addIfValid(join(workDir, '.claude'))
    }
  }

  // Single summary log
  if (plugins.length > 0) {
    console.log(`[Agent] Plugins loaded: ${plugins.map((p) => p.path).join(', ')}`)
  }

  return plugins
}

/**
 * Build settingSources configuration
 * Controls which filesystem settings SDK will load (skills, commands, agents, etc.)
 *
 * With CLAUDE_CONFIG_DIR=~/.halo/, the sources map to:
 * - 'user': ~/.halo/ (skills, commands, agents, settings) - via CLAUDE_CONFIG_DIR
 * - 'project': {workDir}/.claude/ (project-level config)
 * - 'local': .claude/settings.local.json
 */
export function buildSettingSources(workDir: string): SettingSource[] {
  const spaceConfig = getSpaceConfig(workDir)

  // Default: enable both 'user' and 'project' sources
  // 'user' now points to ~/.halo/ (via CLAUDE_CONFIG_DIR env var)
  // 'project' points to {workDir}/.claude/ for project-level config
  const sources: SettingSource[] = ['user', 'project']

  // Space-level override: can disable project settings for specific spaces
  if (spaceConfig?.claudeCode?.enableProjectSettings === false) {
    const idx = sources.indexOf('project')
    if (idx !== -1) {
      sources.splice(idx, 1)
    }
  }

  console.log(`[Agent] Setting sources enabled: ${sources.join(', ')}`)
  return sources
}

/**
 * Filter out disabled MCP servers before passing to SDK
 * Merges global MCP servers with space-level MCP servers (space takes precedence)
 */
export function getEnabledMcpServers(
  globalMcpServers: Record<string, any>,
  workDir?: string
): Record<string, any> | null {
  // Get space-level MCP servers
  const spaceConfig = workDir ? getSpaceConfig(workDir) : null
  const spaceMcpServers = spaceConfig?.claudeCode?.mcpServers || {}

  // Merge: space servers override global servers with the same name
  const mergedServers = {
    ...globalMcpServers,
    ...spaceMcpServers
  }

  if (!mergedServers || Object.keys(mergedServers).length === 0) {
    return null
  }

  const enabled: Record<string, any> = {}
  for (const [name, config] of Object.entries(mergedServers)) {
    if (!config.disabled) {
      // Remove the 'disabled' field before passing to SDK (it's a Halo extension)
      const { disabled, ...sdkConfig } = config as any
      enabled[name] = sdkConfig
    }
  }

  return Object.keys(enabled).length > 0 ? enabled : null
}

/**
 * Build system prompt append - minimal context, preserve Claude Code's native behavior
 */
export function buildSystemPromptAppend(workDir: string): string {
  // Get embedded Python path for system prompt
  const pythonDir = getEmbeddedPythonDir()
  const pythonBinDir = process.platform === 'win32' ? pythonDir : join(pythonDir, 'bin')
  const pythonExecutable =
    process.platform === 'win32' ? join(pythonDir, 'python.exe') : join(pythonBinDir, 'python3')

  console.log(`[Agent] System prompt Python executable: ${pythonExecutable}`)

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

/**
 * Tool permission handler type
 */
export type CanUseToolHandler = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<{
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}>

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
  electronPath: string
  aiBrowserEnabled?: boolean
  thinkingEnabled?: boolean
  stderrSuffix?: string // Optional suffix for stderr logs (e.g., "(warm)")
  canUseTool?: CanUseToolHandler
}

/**
 * Build SDK options for V2 Session creation
 * Centralizes configuration to ensure consistency between ensureSessionWarm and sendMessage()
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
    electronPath,
    aiBrowserEnabled,
    thinkingEnabled,
    stderrSuffix = '',
    canUseTool
  } = params

  const sdkOptions: Record<string, any> = {
    model: sdkModel,
    cwd: workDir,
    abortController,
    env: {
      ...process.env,
      // Set CLAUDE_CONFIG_DIR to ~/.halo/ so SDK loads config from there instead of ~/.claude/
      // This provides complete isolation from system Claude Code configuration
      CLAUDE_CONFIG_DIR: getHaloDir(),
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
      // Append AI Browser system prompt if enabled
      append: buildSystemPromptAppend(workDir) + (aiBrowserEnabled ? AI_BROWSER_SYSTEM_PROMPT : '')
    },
    maxTurns: 50,
    allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'acceptEdits' as const,
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],
    // Configure filesystem settings loading
    // With CLAUDE_CONFIG_DIR=~/.halo/, the SDK loads from:
    // - 'user': ~/.halo/ (skills, commands, agents, settings)
    // - 'project': {workDir}/.claude/ (project-level config)
    // Both are enabled by default for full functionality
    settingSources: buildSettingSources(workDir),
    // Load plugins from multi-tier sources (system, global, app, space)
    plugins: buildPluginsConfig(workDir),
    // Load hooks from settings.json, global config, and space config
    hooks: buildHooksConfig(workDir),
    // Extended thinking: enable when user requests it (10240 tokens, same as Claude Code CLI Tab)
    ...(thinkingEnabled ? { maxThinkingTokens: 10240 } : {}),
    // MCP configuration
    // - Pass through enabled user MCP servers (merged with space-level config)
    // - Add AI Browser MCP server if enabled
    ...(() => {
      const enabledMcp = getEnabledMcpServers(config.mcpServers || {}, workDir)
      const mcpServers: Record<string, any> = enabledMcp ? { ...enabledMcp } : {}

      // Add AI Browser as SDK MCP server if enabled
      if (aiBrowserEnabled) {
        mcpServers['ai-browser'] = createAIBrowserMcpServer()
        console.log(`[Agent][${conversationId}] AI Browser MCP server added`)
      }

      return Object.keys(mcpServers).length > 0 ? { mcpServers } : {}
    })()
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
    CLAUDE_CONFIG_DIR: getHaloDir(),
    PATH: getPythonEnhancedPath(),
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
