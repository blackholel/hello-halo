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
import { getSpaceConfig, type SpaceToolkit } from '../space-config.service'
import { buildHooksConfig } from '../hooks.service'
import { listEnabledPlugins } from '../plugins.service'
import { getEmbeddedPythonDir, getPythonEnhancedPath } from '../python.service'
import { isValidDirectoryPath } from '../../utils/path-validation'
import { getSpace } from '../space.service'
import { getSpaceToolkit } from '../toolkit.service'
import { createAIBrowserMcpServer, AI_BROWSER_SYSTEM_PROMPT } from '../ai-browser'
import { SKILLS_LAZY_SYSTEM_PROMPT } from '../skills-mcp-server'
import { buildPluginMcpServers } from '../plugin-mcp.service'
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
 * Toolkit-aware lazy-load decision.
 * When toolkit is configured (non-null), lazy-load is forced.
 */
export function getEffectiveSkillsLazyLoad(
  workDir: string,
  config?: ReturnType<typeof getConfig>
): {
  configLazyLoad: boolean
  effectiveLazyLoad: boolean
  toolkit: SpaceToolkit | null
} {
  const resolvedConfig = config ?? getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const configLazyLoad = getConfigSkillsLazyLoad(resolvedConfig, spaceConfig)
  const toolkit = getSpaceToolkit(workDir)
  const effectiveLazyLoad = configLazyLoad || toolkit !== null
  return { configLazyLoad, effectiveLazyLoad, toolkit }
}

/**
 * Build plugins configuration for skills loading.
 * Loading priority: installed plugins → system → global → app → space → workDir/.claude/
 */
export function buildPluginsConfig(workDir: string): PluginConfig[] {
  const plugins: PluginConfig[] = []
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const claudeCodeConfig = config.claudeCode
  const { configLazyLoad, effectiveLazyLoad, toolkit } = getEffectiveSkillsLazyLoad(workDir, config)

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

  if (effectiveLazyLoad) {
    if (!configLazyLoad && toolkit) {
      console.log('[Agent] Toolkit allowlist active: forcing skills lazy-load and skipping plugin directories')
    } else {
      console.log('[Agent] Skills lazy-load enabled: skipping plugin directories for Claude Code')
    }
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
 * Build settingSources configuration.
 * Controls which filesystem settings SDK will load.
 */
export function buildSettingSources(workDir: string): SettingSource[] {
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const { configLazyLoad, effectiveLazyLoad, toolkit } = getEffectiveSkillsLazyLoad(workDir, config)

  if (effectiveLazyLoad) {
    if (!configLazyLoad && toolkit) {
      console.log('[Agent] Toolkit allowlist active: forcing settingSources=local only')
    } else {
      console.log('[Agent] Skills lazy-load enabled: settingSources=local only')
    }
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
    if (!config.disabled) {
      const { disabled, ...sdkConfig } = config as any
      enabled[name] = sdkConfig
    }
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
 * Build system prompt append with Python environment instructions
 */
function formatToolkitList(items: Array<{ name: string; namespace?: string }>): string {
  if (items.length === 0) return '[]'
  const sorted = [...items]
    .map(item => item.namespace ? `${item.namespace}:${item.name}` : item.name)
    .sort((a, b) => a.localeCompare(b))
  return `[${sorted.join(', ')}]`
}

export function buildSystemPromptAppend(workDir: string, toolkit?: SpaceToolkit | null): string {
  const pythonDir = getEmbeddedPythonDir()
  const pythonBinDir = process.platform === 'win32' ? pythonDir : join(pythonDir, 'bin')
  const pythonExecutable =
    process.platform === 'win32' ? join(pythonDir, 'python.exe') : join(pythonBinDir, 'python3')

  console.log(`[Agent] System prompt Python executable: ${pythonExecutable}`)

  const base = `
You are Halo, an AI assistant that helps users accomplish real work.
All created files will be saved in the user's workspace. Current workspace: ${workDir}.

## Built-in Python Environment
This application has a built-in Python 3.11.9 environment. Always use the full path: ${pythonExecutable}

Examples:
- Check version: \`${pythonExecutable} --version\`
- Run script: \`${pythonExecutable} script.py\`
- Install package: \`${pythonExecutable} -m pip install package_name\`
`

  if (!toolkit) {
    return base
  }

  const toolkitAppend = `

## Space Toolkit Allowlist
Available skills in this space: ${formatToolkitList(toolkit.skills)}
Available agents in this space: ${formatToolkitList(toolkit.agents)}
Available commands in this space: ${formatToolkitList(toolkit.commands)}
Do NOT use resources outside this list.
`

  return `${base}${toolkitAppend}`
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
    electronPath,
    aiBrowserEnabled,
    thinkingEnabled,
    stderrSuffix = '',
    canUseTool,
    enabledPluginMcps
  } = params

  const spaceConfig = getSpaceConfig(workDir)
  const { effectiveLazyLoad, toolkit } = getEffectiveSkillsLazyLoad(workDir, config)

  const configDir = (() => {
    if (effectiveLazyLoad) {
      const isolated = join(getTempSpacePath(), 'claude-config')
      if (!existsSync(isolated)) {
        mkdirSync(isolated, { recursive: true })
      }
      return isolated
    }
    return getHaloDir()
  })()

  const sdkOptions: Record<string, any> = {
    model: sdkModel,
    cwd: workDir,
    abortController,
    env: {
      ...process.env,
      // Set CLAUDE_CONFIG_DIR to control which Claude Code config directory is used.
      // In lazy skills mode, use an isolated empty config dir to avoid preloading skills/plugins/hooks.
      CLAUDE_CONFIG_DIR: configDir,
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
      append: [
        buildSystemPromptAppend(workDir, toolkit),
        aiBrowserEnabled ? AI_BROWSER_SYSTEM_PROMPT : '',
        effectiveLazyLoad ? SKILLS_LAZY_SYSTEM_PROMPT : ''
      ].filter(Boolean).join('\n')
    },
    maxTurns: 50,
    allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'acceptEdits' as const,
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],
    settingSources: buildSettingSources(workDir),
    plugins: buildPluginsConfig(workDir),
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

  // MiniMax Anthropic-compatible backends can reject tool schemas; disable tools to keep chat usable.
  if (config.api.provider === 'minimax') {
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
