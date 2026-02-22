/**
 * Config Service - Manages application configuration
 */

import { app } from 'electron'
import { basename, dirname, join, posix as pathPosix, resolve, win32 as pathWin32 } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { getConfigDir } from '../utils/instance'

// Import analytics config type
import type { AnalyticsConfig } from './analytics/types'

// ============================================================================
// API Config Change Notification (Callback Pattern)
// ============================================================================
// When API config changes (provider/apiKey/apiUrl), subscribers are notified.
// This allows agent.service to invalidate sessions without circular dependency.
// agent.service imports onApiConfigChange (agent → config, existing direction)
// config.service calls registered callbacks (no import from agent)
// ============================================================================

type ApiConfigChangeHandler = () => void
const apiConfigChangeHandlers: ApiConfigChangeHandler[] = []
const CONFIG_SOURCE_MODE_VALUES = ['kite', 'claude'] as const

export type ConfigSourceMode = (typeof CONFIG_SOURCE_MODE_VALUES)[number]

export function normalizeConfigSourceMode(value: unknown): ConfigSourceMode {
  if (typeof value === 'string' && (CONFIG_SOURCE_MODE_VALUES as readonly string[]).includes(value)) {
    return value as ConfigSourceMode
  }
  return 'kite'
}

/**
 * Register a callback to be notified when API config changes.
 * Used by agent.service to invalidate sessions on config change.
 *
 * @returns Unsubscribe function
 */
export function onApiConfigChange(handler: ApiConfigChangeHandler): () => void {
  apiConfigChangeHandlers.push(handler)
  return () => {
    const idx = apiConfigChangeHandlers.indexOf(handler)
    if (idx >= 0) apiConfigChangeHandlers.splice(idx, 1)
  }
}

// Types (shared with renderer)
// Provider types:
// - 'anthropic': Official Anthropic API (api.anthropic.com)
// - 'anthropic-compat': Anthropic-compatible backends (OpenRouter, etc.) - direct connection, no protocol conversion
// - 'openai': OpenAI-compatible backends (GPT, Ollama, vLLM) - requires protocol conversion via Router
// - 'zhipu': ZhipuAI (智谱) - Anthropic-compatible, direct connection
// - 'minimax': MiniMax - Anthropic-compatible, direct connection
// - 'custom': Legacy custom provider (treated as anthropic-compat)
interface KiteConfig {
  api: {
    provider: 'anthropic' | 'anthropic-compat' | 'openai' | 'zhipu' | 'minimax' | 'custom'
    apiKey: string
    apiUrl: string
    model: string
  }
  permissions: {
    fileAccess: 'allow' | 'ask' | 'deny'
    commandExecution: 'allow' | 'ask' | 'deny'
    networkAccess: 'allow' | 'ask' | 'deny'
    trustMode: boolean
  }
  appearance: {
    theme: 'light' | 'dark' | 'system'
  }
  system: {
    autoLaunch: boolean
    minimizeToTray: boolean
  }
  remoteAccess: {
    enabled: boolean
    port: number
    trustedOrigins?: string[]  // Allowed CORS origins (in addition to localhost)
  }
  onboarding: {
    completed: boolean
  }
  // MCP servers configuration (compatible with Cursor / Claude Desktop format)
  mcpServers: Record<string, McpServerConfig>
  isFirstLaunch: boolean
  // Analytics configuration (auto-generated on first launch)
  analytics?: AnalyticsConfig
  // Git Bash configuration (Windows only)
  gitBash?: {
    installed: boolean
    path: string | null
    skipped: boolean
  }
  // Claude Code configuration (plugins, hooks, agents)
  claudeCode?: ClaudeCodeConfig
  // Configuration source mode (runtime lock consumes this on startup)
  configSourceMode: ConfigSourceMode
  extensionTaxonomy?: {
    adminEnabled: boolean
  }
}

// MCP server configuration types
type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig

interface McpStdioServerConfig {
  type?: 'stdio'  // Optional, defaults to stdio
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  disabled?: boolean  // Kite extension: temporarily disable this server
}

interface McpHttpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Kite extension: temporarily disable this server
}

interface McpSseServerConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Kite extension: temporarily disable this server
}

// ============================================
// Claude Code Configuration Types
// ============================================

// Re-export shared types for backward compatibility
export type {
  HooksConfig,
  HookDefinition,
  HookCommand,
  PluginsConfig,
  AgentsConfig,
  ClaudeCodeConfig
} from '../../shared/types/claude-code'

import type { ClaudeCodeConfig } from '../../shared/types/claude-code'

// Paths
// Use getConfigDir() from instance utils to support KITE_CONFIG_DIR environment variable
// This enables running multiple Kite instances in parallel (e.g., different git worktrees)
export function getKiteDir(): string {
  return getConfigDir()
}

export function getConfigPath(): string {
  return join(getKiteDir(), 'config.json')
}

export function getTempSpacePath(): string {
  return join(getKiteDir(), 'temp')
}

export function resolveSpacesRootFromConfigDir(
  configDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    const normalizedConfigDir = pathWin32.resolve(configDir)
    const configBaseName = pathWin32.basename(normalizedConfigDir)
    const isDotKiteDir = configBaseName.toLowerCase() === '.kite'

    if (isDotKiteDir) {
      return pathWin32.resolve(pathWin32.join(pathWin32.dirname(normalizedConfigDir), 'kite'))
    }

    return pathWin32.resolve(pathWin32.join(normalizedConfigDir, 'kite'))
  }

  const normalizedConfigDir = pathPosix.resolve(configDir)
  const configBaseName = basename(normalizedConfigDir)
  const isDotKiteDir = configBaseName === '.kite'

  if (isDotKiteDir) {
    return pathPosix.resolve(join(dirname(normalizedConfigDir), 'kite'))
  }

  return pathPosix.resolve(join(normalizedConfigDir, 'kite'))
}

export function getSpacesDir(): string {
  return resolveSpacesRootFromConfigDir(getKiteDir())
}

export function getLegacySpacesDir(
  configDir: string = getKiteDir(),
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    return pathWin32.resolve(pathWin32.join(pathWin32.resolve(configDir), 'spaces'))
  }

  return pathPosix.resolve(pathPosix.join(pathPosix.resolve(configDir), 'spaces'))
}

// Default model (Opus 4.5)
const DEFAULT_MODEL = 'claude-opus-4-5-20251101'

// Default configuration
const DEFAULT_CONFIG: KiteConfig = {
  api: {
    provider: 'anthropic',
    apiKey: '',
    apiUrl: 'https://api.anthropic.com',
    model: DEFAULT_MODEL
  },
  permissions: {
    fileAccess: 'allow',
    commandExecution: 'ask',
    networkAccess: 'allow',
    trustMode: false
  },
  appearance: {
    theme: 'dark'
  },
  system: {
    autoLaunch: false,
    minimizeToTray: false
  },
  remoteAccess: {
    enabled: false,
    port: 3456
  },
  onboarding: {
    completed: false
  },
  mcpServers: {},  // Empty by default
  isFirstLaunch: true,
  configSourceMode: 'kite',
  extensionTaxonomy: {
    adminEnabled: false
  }
}

const BUILTIN_SEED_ENV_KEY = 'KITE_BUILTIN_SEED_DIR'
const DISABLE_BUILTIN_SEED_ENV_KEY = 'KITE_DISABLE_BUILTIN_SEED'
const SEED_STATE_FILE = '.seed-state.json'
const KITE_ROOT_TEMPLATE = '__KITE_ROOT__'
const BUILTIN_SEED_CONFIG_NAMES = new Set([
  'config.json',
  'settings.json',
  'agents',
  'commands',
  'hooks',
  'mcp',
  'rules',
  'skills',
  'contexts',
  'plugins'
])

interface SeedInstalledPlugin {
  scope?: 'user' | 'project'
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

interface SeedInstalledPluginsRegistry {
  version?: number
  plugins?: Record<string, SeedInstalledPlugin[]>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isBuiltInSeedDisabled(): boolean {
  const value = process.env[DISABLE_BUILTIN_SEED_ENV_KEY]
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function deepFillMissing<T>(target: T, seedValue: unknown): T {
  if (!isPlainObject(seedValue) || !isPlainObject(target)) {
    return target
  }

  const merged: Record<string, unknown> = { ...target }
  for (const [key, incoming] of Object.entries(seedValue)) {
    const existing = merged[key]
    if (existing === undefined) {
      merged[key] = cloneJsonValue(incoming)
      continue
    }
    if (isPlainObject(existing) && isPlainObject(incoming)) {
      merged[key] = deepFillMissing(existing, incoming)
    }
  }

  return merged as T
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    console.warn(`[Seed] Failed to read JSON: ${path}`, error)
    return null
  }
}

function copyFileIfMissing(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) return
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
}

function copyDirMissingOnly(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirMissingOnly(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      copyFileIfMissing(sourcePath, targetPath)
    }
  }
}

function mergeJsonFileByMissingKeys(sourcePath: string, targetPath: string): void {
  const sourceValue = readJsonFile(sourcePath)
  if (!isPlainObject(sourceValue)) return

  if (!existsSync(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, JSON.stringify(sourceValue, null, 2))
    return
  }

  const targetValue = readJsonFile(targetPath)
  if (!isPlainObject(targetValue)) return

  const merged = deepFillMissing(targetValue, sourceValue)
  writeFileSync(targetPath, JSON.stringify(merged, null, 2))
}

function normalizeInstallPath(pathValue: string, kiteDir: string): string {
  if (!pathValue.startsWith(KITE_ROOT_TEMPLATE)) {
    return pathValue
  }

  const suffix = pathValue.slice(KITE_ROOT_TEMPLATE.length).replace(/^[/\\]+/, '')
  if (!suffix) return kiteDir

  const parts = suffix.split(/[\\/]+/).filter(Boolean)
  return join(kiteDir, ...parts)
}

function mergePluginRegistryWithTemplatePath(sourcePath: string, targetPath: string, kiteDir: string): void {
  const sourceValue = readJsonFile(sourcePath)
  if (!isPlainObject(sourceValue)) return

  const sourceRegistry = sourceValue as SeedInstalledPluginsRegistry
  const sourcePlugins = isPlainObject(sourceRegistry.plugins) ? sourceRegistry.plugins : {}

  const normalizedSeedPlugins: Record<string, SeedInstalledPlugin[]> = {}
  for (const [fullName, installations] of Object.entries(sourcePlugins)) {
    if (!Array.isArray(installations) || installations.length === 0) continue
    const normalizedInstallations = installations
      .filter((installation) => isPlainObject(installation))
      .map((installation) => {
        const installPathValue = typeof installation.installPath === 'string'
          ? normalizeInstallPath(installation.installPath, kiteDir)
          : undefined
        return {
          ...installation,
          ...(installPathValue ? { installPath: installPathValue } : {})
        }
      })
      .filter((installation) => typeof installation.installPath === 'string')

    if (normalizedInstallations.length > 0) {
      normalizedSeedPlugins[fullName] = normalizedInstallations
    }
  }

  if (Object.keys(normalizedSeedPlugins).length === 0) return

  const targetValue = readJsonFile(targetPath)
  const targetRegistry = isPlainObject(targetValue)
    ? (targetValue as SeedInstalledPluginsRegistry)
    : { version: sourceRegistry.version || 2, plugins: {} }
  const targetPlugins = isPlainObject(targetRegistry.plugins) ? { ...targetRegistry.plugins } : {}

  for (const [fullName, installations] of Object.entries(normalizedSeedPlugins)) {
    if (!Object.prototype.hasOwnProperty.call(targetPlugins, fullName)) {
      targetPlugins[fullName] = installations
    }
  }

  const mergedRegistry: SeedInstalledPluginsRegistry = {
    version: typeof targetRegistry.version === 'number'
      ? targetRegistry.version
      : (sourceRegistry.version || 2),
    plugins: targetPlugins
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, JSON.stringify(mergedRegistry, null, 2))
}

function injectPluginsSeed(sourcePluginsDir: string, targetPluginsDir: string, kiteDir: string): void {
  const sourceCacheDir = join(sourcePluginsDir, 'cache')
  if (isDirectory(sourceCacheDir)) {
    copyDirMissingOnly(sourceCacheDir, join(targetPluginsDir, 'cache'))
  }

  const sourceRegistryPath = join(sourcePluginsDir, 'installed_plugins.json')
  if (existsSync(sourceRegistryPath)) {
    mergePluginRegistryWithTemplatePath(
      sourceRegistryPath,
      join(targetPluginsDir, 'installed_plugins.json'),
      kiteDir
    )
  }
}

function getSeedStatePath(kiteDir: string): string {
  return join(kiteDir, SEED_STATE_FILE)
}

function shouldInjectBuiltInSeed(kiteDir: string, seedDir: string | null): boolean {
  if (isBuiltInSeedDisabled()) {
    console.log('[Seed] Injection disabled by KITE_DISABLE_BUILTIN_SEED')
    return false
  }
  if (!seedDir) return false
  if (!isDirectory(seedDir)) return false
  if (existsSync(getSeedStatePath(kiteDir))) return false
  return true
}

function getDevSeedCandidates(): string[] {
  const candidates: string[] = []
  try {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : null
    if (appPath) {
      candidates.push(join(appPath, '../resources/default-kite-config'))
    }
  } catch {
    // Ignore app path errors in tests/dev environments
  }

  candidates.push(
    join(__dirname, '../../resources/default-kite-config'),
    join(process.cwd(), 'build/default-kite-config'),
    join(process.cwd(), 'resources/default-kite-config')
  )
  return candidates
}

export function resolveSeedDir(): string | null {
  const envSeedPath = process.env[BUILTIN_SEED_ENV_KEY]
  const packagedSeedPath = typeof process.resourcesPath === 'string'
    ? join(process.resourcesPath, 'default-kite-config')
    : null
  const candidates = [
    ...(envSeedPath ? [envSeedPath] : []),
    ...(packagedSeedPath ? [packagedSeedPath] : []),
    ...getDevSeedCandidates()
  ]

  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      console.log(`[Seed] Using built-in seed dir: ${candidate}`)
      return candidate
    }
  }

  return null
}

function injectBuiltInSeed(seedDir: string, kiteDir: string): boolean {
  let hasSeedEntries = false
  for (const entryName of BUILTIN_SEED_CONFIG_NAMES) {
    const sourcePath = join(seedDir, entryName)
    if (!existsSync(sourcePath)) continue
    hasSeedEntries = true
    const targetPath = join(kiteDir, entryName)

    if (entryName === 'config.json' || entryName === 'settings.json') {
      mergeJsonFileByMissingKeys(sourcePath, targetPath)
      continue
    }

    if (entryName === 'plugins' && isDirectory(sourcePath)) {
      injectPluginsSeed(sourcePath, targetPath, kiteDir)
      continue
    }

    if (isDirectory(sourcePath)) {
      copyDirMissingOnly(sourcePath, targetPath)
      continue
    }

    copyFileIfMissing(sourcePath, targetPath)
  }

  if (!hasSeedEntries) {
    return false
  }

  const seedState = {
    schemaVersion: 1,
    appVersion: app.getVersion(),
    injectedAt: new Date().toISOString()
  }
  writeFileSync(getSeedStatePath(kiteDir), JSON.stringify(seedState, null, 2))
  return true
}

// Initialize app directories
export async function initializeApp(): Promise<void> {
  const kiteDir = getKiteDir()
  const tempDir = getTempSpacePath()
  const spacesDir = getSpacesDir()
  const tempArtifactsDir = join(tempDir, 'artifacts')
  const tempConversationsDir = join(tempDir, 'conversations')

  // Create directories if they don't exist
  const dirs = [kiteDir, tempDir, spacesDir, tempArtifactsDir, tempConversationsDir]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const seedDir = resolveSeedDir()
  if (shouldInjectBuiltInSeed(kiteDir, seedDir) && seedDir) {
    try {
      const injected = injectBuiltInSeed(seedDir, kiteDir)
      if (injected) {
        console.log('[Seed] Built-in seed injection complete')
      } else {
        console.log('[Seed] Built-in seed injection skipped (no seed entries)')
      }
    } catch (error) {
      console.error('[Seed] Built-in seed injection failed:', error)
    }
  }

  // Create default config if it doesn't exist
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
  }
}

// Get configuration
export function getConfig(): KiteConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    // Deep merge to ensure all nested defaults are applied
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      api: { ...DEFAULT_CONFIG.api, ...parsed.api },
      permissions: { ...DEFAULT_CONFIG.permissions, ...parsed.permissions },
      appearance: { ...DEFAULT_CONFIG.appearance, ...parsed.appearance },
      system: { ...DEFAULT_CONFIG.system, ...parsed.system },
      onboarding: { ...DEFAULT_CONFIG.onboarding, ...parsed.onboarding },
      // mcpServers is a flat map, just use parsed value or default
      mcpServers: parsed.mcpServers || DEFAULT_CONFIG.mcpServers,
      // analytics: keep as-is (managed by analytics.service.ts)
      analytics: parsed.analytics,
      configSourceMode: normalizeConfigSourceMode(parsed.configSourceMode),
      extensionTaxonomy: {
        ...DEFAULT_CONFIG.extensionTaxonomy,
        ...(parsed.extensionTaxonomy || {})
      }
    }
  } catch (error) {
    console.error('Failed to read config:', error)
    return DEFAULT_CONFIG
  }
}

// Save configuration
export function saveConfig(config: Partial<KiteConfig>): KiteConfig {
  const currentConfig = getConfig()
  const newConfig = { ...currentConfig, ...config }
  const rawUpdates = config as Record<string, unknown>

  // Deep merge for nested objects
  if (config.api) {
    newConfig.api = { ...currentConfig.api, ...config.api }
  }
  if (config.permissions) {
    newConfig.permissions = { ...currentConfig.permissions, ...config.permissions }
  }
  if (config.appearance) {
    newConfig.appearance = { ...currentConfig.appearance, ...config.appearance }
  }
  if (config.system) {
    newConfig.system = { ...currentConfig.system, ...config.system }
  }
  if (config.onboarding) {
    newConfig.onboarding = { ...currentConfig.onboarding, ...config.onboarding }
  }
  if (rawUpdates.configSourceMode !== undefined) {
    newConfig.configSourceMode = normalizeConfigSourceMode(rawUpdates.configSourceMode)
  }
  if ((config as any).extensionTaxonomy !== undefined) {
    newConfig.extensionTaxonomy = {
      ...currentConfig.extensionTaxonomy,
      ...(config as any).extensionTaxonomy
    }
  }
  // mcpServers: replace entirely when provided (not merged)
  if (config.mcpServers !== undefined) {
    newConfig.mcpServers = config.mcpServers
  }
  // analytics: replace entirely when provided (managed by analytics.service.ts)
  if (config.analytics !== undefined) {
    newConfig.analytics = config.analytics
  }
  // gitBash: replace entirely when provided (Windows only)
  if ((config as any).gitBash !== undefined) {
    (newConfig as any).gitBash = (config as any).gitBash
  }

  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2))

  // Detect API config changes and notify subscribers
  // This allows agent.service to invalidate sessions when API config changes
  if (config.api) {
    const apiChanged =
      config.api.provider !== currentConfig.api.provider ||
      config.api.apiKey !== currentConfig.api.apiKey ||
      config.api.apiUrl !== currentConfig.api.apiUrl

    if (apiChanged && apiConfigChangeHandlers.length > 0) {
      console.log('[Config] API config changed, notifying subscribers...')
      // Use setTimeout to avoid blocking the save operation
      // and ensure all handlers are called asynchronously
      setTimeout(() => {
        apiConfigChangeHandlers.forEach(handler => {
          try {
            handler()
          } catch (e) {
            console.error('[Config] Error in API config change handler:', e)
          }
        })
      }, 0)
    }
  }

  return newConfig
}

// Validate API connection
export async function validateApiConnection(
  apiKey: string,
  apiUrl: string,
  provider: string
): Promise<{ valid: boolean; message?: string; model?: string }> {
  try {
    const trimSlash = (s: string) => s.replace(/\/+$/, '')
    const normalizeOpenAIV1Base = (input: string) => {
      // Accept:
      // - https://host
      // - https://host/v1
      // - https://host/v1/chat/completions
      // - https://host/chat/completions
      let base = trimSlash(input)
      // If user pasted full chat/completions endpoint, strip it
      if (base.endsWith('/chat/completions')) {
        base = base.slice(0, -'/chat/completions'.length)
        base = trimSlash(base)
      }
      // If already contains /v1 anywhere, normalize to ".../v1"
      const v1Idx = base.indexOf('/v1')
      if (v1Idx >= 0) {
        base = base.slice(0, v1Idx + 3) // include "/v1"
        base = trimSlash(base)
        return base
      }
      return `${base}/v1`
    }

    // OpenAI compatible validation: GET /v1/models (does not depend on user-selected model)
    if (provider === 'openai') {
      const baseV1 = normalizeOpenAIV1Base(apiUrl)
      const modelsUrl = `${baseV1}/models`

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })

      if (response.ok) {
        const data: any = await response.json().catch(() => ({}))
        const modelId =
          data?.data?.[0]?.id ||
          data?.model ||
          undefined
        return { valid: true, model: modelId }
      }

      const errorText = await response.text().catch(() => '')
      return {
        valid: false,
        message: errorText || `HTTP ${response.status}`
      }
    }

    // Anthropic compatible validation: POST /v1/messages
    const base = trimSlash(apiUrl)
    const messagesUrl = `${base}/v1/messages`
    const response = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    })

    if (response.ok) {
      const data = await response.json()
      return {
        valid: true,
        model: data.model || DEFAULT_MODEL
      }
    } else {
      const error = await response.json().catch(() => ({}))
      return {
        valid: false,
        message: error.error?.message || `HTTP ${response.status}`
      }
    }
  } catch (error: unknown) {
    const err = error as Error
    return {
      valid: false,
      message: err.message || 'Connection failed'
    }
  }
}

/**
 * Set auto launch on system startup
 */
export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // Start minimized
    // On macOS, also set to open at login for all users (requires admin)
    // path: process.execPath, // Optional: specify executable path
  })

  // Save to config
  saveConfig({ system: { autoLaunch: enabled, minimizeToTray: getConfig().system.minimizeToTray } })
  console.log(`[Config] Auto launch set to: ${enabled}`)
}

/**
 * Get current auto launch status
 */
export function getAutoLaunch(): boolean {
  const settings = app.getLoginItemSettings()
  return settings.openAtLogin
}

/**
 * Set minimize to tray behavior
 */
export function setMinimizeToTray(enabled: boolean): void {
  saveConfig({ system: { autoLaunch: getConfig().system.autoLaunch, minimizeToTray: enabled } })
  console.log(`[Config] Minimize to tray set to: ${enabled}`)
}

/**
 * Get minimize to tray setting
 */
export function getMinimizeToTray(): boolean {
  return getConfig().system.minimizeToTray
}
