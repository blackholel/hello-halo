/**
 * Plugins Service - Manages installed plugins from plugin registries
 *
 * This service reads installed plugins from both ~/.halo/ and ~/.claude/ registries
 * and provides their paths to the SDK for loading skills, commands, hooks, and agents.
 *
 * Registry loading order (Halo takes precedence for deduplication):
 * 1. ~/.halo/plugins/installed_plugins.json
 * 2. ~/.claude/plugins/installed_plugins.json
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, statSync } from 'fs'
import { getHaloDir } from './config.service'
import { isValidDirectoryPath } from '../utils/path-validation'
import { FileCache } from '../utils/file-cache'

// ============================================
// Plugin Types
// ============================================

interface InstalledPlugin {
  scope: 'user' | 'project'
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  gitCommitSha?: string
}

interface InstalledPluginsRegistry {
  version: number
  plugins: Record<string, InstalledPlugin[]>
}

export interface PluginInfo {
  name: string
  marketplace: string
  fullName: string
  version: string
  installPath: string
  scope: 'user' | 'project'
}

// Cache for installed plugins
let pluginsCache: { plugins: PluginInfo[]; mtime: number } | null = null

// Cache for enabled plugins settings
const enabledPluginsCache = new FileCache<Record<string, boolean> | null>()

interface EnabledPluginsSettings {
  enabledPlugins?: Record<string, boolean>
}

function getSettingsPathInHalo(): string {
  return join(getHaloDir(), 'settings.json')
}

function getSettingsPathInClaude(): string {
  return join(homedir(), '.claude', 'settings.json')
}

function loadEnabledPluginsFromSettings(settingsPath: string): Record<string, boolean> | null {
  return enabledPluginsCache.get(settingsPath, () => {
    if (!existsSync(settingsPath)) return null
    try {
      const content = readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(content) as EnabledPluginsSettings
      if (!parsed.enabledPlugins) return null
      return parsed.enabledPlugins
    } catch (error) {
      console.error(`[Plugins] Failed to read enabledPlugins from ${settingsPath}:`, error)
      return null
    }
  })
}

function getMergedEnabledPlugins(): { map: Record<string, boolean>; hasConfig: boolean } {
  const haloEnabled = loadEnabledPluginsFromSettings(getSettingsPathInHalo()) || {}
  const claudeEnabled = loadEnabledPluginsFromSettings(getSettingsPathInClaude()) || {}
  const merged = { ...claudeEnabled, ...haloEnabled }
  const hasConfig = Object.keys(merged).length > 0
  return { map: merged, hasConfig }
}

/**
 * Get all registry paths that exist
 */
function getInstalledPluginsPaths(): string[] {
  const paths: string[] = []

  const haloPath = join(getHaloDir(), 'plugins', 'installed_plugins.json')
  if (existsSync(haloPath)) {
    paths.push(haloPath)
  }

  const claudePath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(claudePath)) {
    paths.push(claudePath)
  }

  return paths
}

/**
 * Load plugins from a single registry file
 */
function loadPluginsFromRegistry(registryPath: string): PluginInfo[] {
  try {
    const content = readFileSync(registryPath, 'utf-8')
    const registry = JSON.parse(content) as InstalledPluginsRegistry
    const plugins: PluginInfo[] = []

    for (const [fullName, installations] of Object.entries(registry.plugins)) {
      const [name, marketplace] = fullName.split('@')
      if (!name || !marketplace) {
        console.warn(`[Plugins] Invalid plugin name format: ${fullName}`)
        continue
      }

      const installation = installations[0]
      if (!installation) continue

      if (!isValidDirectoryPath(installation.installPath, 'Plugins')) {
        console.warn(`[Plugins] Plugin path not valid: ${installation.installPath}`)
        continue
      }

      plugins.push({
        name,
        marketplace,
        fullName,
        version: installation.version,
        installPath: installation.installPath,
        scope: installation.scope
      })
    }

    return plugins
  } catch (error) {
    console.error(`[Plugins] Failed to load registry ${registryPath}:`, error)
    return []
  }
}

/**
 * Calculate combined mtime for all registry files
 */
function getCombinedMtime(paths: string[]): number {
  let combinedMtime = 0
  for (const path of paths) {
    try {
      combinedMtime += statSync(path).mtimeMs
    } catch {
      // Ignore stat errors
    }
  }
  return combinedMtime
}

/**
 * Load installed plugins from all registries
 */
export function loadInstalledPlugins(): PluginInfo[] {
  const registryPaths = getInstalledPluginsPaths()
  if (registryPaths.length === 0) {
    return []
  }

  // Check cache
  const currentMtime = getCombinedMtime(registryPaths)
  if (pluginsCache && pluginsCache.mtime === currentMtime) {
    return pluginsCache.plugins
  }

  const allPlugins: PluginInfo[] = []
  const seenFullNames = new Set<string>()
  const seenPaths = new Set<string>()

  for (const registryPath of registryPaths) {
    const plugins = loadPluginsFromRegistry(registryPath)
    for (const plugin of plugins) {
      if (seenFullNames.has(plugin.fullName) || seenPaths.has(plugin.installPath)) {
        continue
      }
      allPlugins.push(plugin)
      seenFullNames.add(plugin.fullName)
      seenPaths.add(plugin.installPath)
    }
  }

  pluginsCache = { plugins: allPlugins, mtime: currentMtime }

  if (allPlugins.length > 0) {
    console.log(`[Plugins] Loaded ${allPlugins.length} installed plugins: ${allPlugins.map(p => p.name).join(', ')}`)
  }

  return allPlugins
}

/**
 * Get enabled plugin full names from settings.json (Halo + Claude)
 * - Halo settings take precedence over Claude settings.
 * - If no enabledPlugins configured, default to all installed plugins.
 */
export function getEnabledPluginFullNames(): Set<string> {
  const { map, hasConfig } = getMergedEnabledPlugins()
  const installed = loadInstalledPlugins()

  if (!hasConfig) {
    return new Set(installed.map(p => p.fullName))
  }

  const enabled = Object.entries(map)
    .filter(([, value]) => value === true)
    .map(([name]) => name)

  return new Set(enabled)
}

/**
 * List enabled plugins (filtered from installed plugins)
 */
export function listEnabledPlugins(): PluginInfo[] {
  const installed = loadInstalledPlugins()
  const enabledSet = getEnabledPluginFullNames()

  if (enabledSet.size === 0) {
    return []
  }

  const enabled = installed.filter((plugin) => enabledSet.has(plugin.fullName))

  const missing = Array.from(enabledSet).filter(
    (fullName) => !installed.some((plugin) => plugin.fullName === fullName)
  )
  if (missing.length > 0) {
    console.warn(`[Plugins] Enabled plugins not installed: ${missing.join(', ')}`)
  }

  return enabled
}

/**
 * Find an enabled plugin by input (fullName or short name)
 */
export function findEnabledPluginByInput(input: string): PluginInfo | null {
  const name = input.trim()
  if (!name) return null

  const enabled = listEnabledPlugins()
  const lower = name.toLowerCase()

  if (lower.includes('@')) {
    return enabled.find((p) => p.fullName.toLowerCase() === lower) || null
  }

  const matches = enabled.filter((p) => p.name.toLowerCase() === lower)
  if (matches.length > 1) {
    console.warn(`[Plugins] Multiple enabled plugins match "${name}", using "${matches[0].fullName}"`)
  }
  return matches[0] || null
}

/**
 * Get an enabled plugin by full name
 */
export function getEnabledPluginByFullName(fullName: string): PluginInfo | null {
  const enabled = listEnabledPlugins()
  return enabled.find((p) => p.fullName === fullName) || null
}

/**
 * Get plugin paths for SDK configuration
 */
export function getInstalledPluginPaths(): string[] {
  return loadInstalledPlugins().map(p => p.installPath)
}

/**
 * Get a specific plugin by name
 */
export function getPlugin(name: string): PluginInfo | null {
  return loadInstalledPlugins().find(p => p.name === name) || null
}

/**
 * Get plugins by marketplace
 */
export function getPluginsByMarketplace(marketplace: string): PluginInfo[] {
  return loadInstalledPlugins().filter(p => p.marketplace === marketplace)
}

/**
 * Clear plugins cache
 */
export function clearPluginsCache(): void {
  pluginsCache = null
  enabledPluginsCache.clear()
}
