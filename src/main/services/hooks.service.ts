/**
 * Hooks Service - Manages Claude Code hooks configuration
 *
 * Hooks are loaded from multiple sources and merged:
 * - Kite mode:
 *   1. ~/.kite/settings.json (Claude Code compatible format)
 *   2. config.claudeCode.hooks (Kite global config)
 *   3. space-config.json claudeCode.hooks (Space-level config)
 *   4. plugin hooks
 * - Claude mode (strict source):
 *   1. ~/.claude/settings.json
 *   2. plugin hooks
 */

import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getConfig, type HooksConfig } from './config.service'
import { getSpaceConfig } from './space-config.service'
import { FileCache } from '../utils/file-cache'
import { listEnabledPlugins } from './plugins.service'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'

// ============================================
// Kite Settings Types (Claude Code compatible)
// ============================================

interface KiteSettings {
  hooks?: HooksConfig
}

// File cache for settings (mtime-based invalidation)
const settingsCache = new FileCache<KiteSettings | null>()

const HOOK_EVENT_TYPES: (keyof HooksConfig)[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PermissionRequest',
  'Setup'
]

/**
 * Get the path to active settings file based on locked config source mode.
 */
function getSettingsPath(): string {
  return join(getLockedUserConfigRootDir(), 'settings.json')
}

/**
 * Load hooks from active settings.json
 */
function loadUserSettingsHooks(): HooksConfig | undefined {
  const settingsPath = getSettingsPath()

  const settings = settingsCache.get(settingsPath, () => {
    if (!existsSync(settingsPath)) {
      return null
    }

    try {
      const content = readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(content) as KiteSettings
      if (parsed.hooks) {
        console.log('[Hooks] Loaded hooks from settings.json')
      }
      return parsed
    } catch (error) {
      console.error('[Hooks] Failed to read settings.json:', error)
      return null
    }
  })

  return settings?.hooks
}

interface PluginHooksFile {
  hooks?: HooksConfig
  description?: string
}

function replacePluginRootInHooks(hooks: HooksConfig, pluginRoot: string): HooksConfig {
  const replaced: HooksConfig = {}
  for (const eventType of HOOK_EVENT_TYPES) {
    const defs = hooks[eventType]
    if (!defs || defs.length === 0) continue
    replaced[eventType] = defs.map(def => ({
      ...def,
      hooks: def.hooks.map(hook => {
        if (hook.type !== 'command' || !hook.command) return hook
        return {
          ...hook,
          command: hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
        }
      })
    }))
  }
  return replaced
}

function normalizePluginHooks(parsed: unknown): HooksConfig | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  if (obj.hooks && typeof obj.hooks === 'object') {
    return obj.hooks as HooksConfig
  }

  // Fallback: treat as direct HooksConfig if it includes known event keys
  const hasKnownKey = HOOK_EVENT_TYPES.some((key) => key in obj)
  if (hasKnownKey) {
    return obj as HooksConfig
  }
  return undefined
}

function loadPluginHooks(): HooksConfig | undefined {
  const enabledPlugins = listEnabledPlugins()
  let merged: HooksConfig | undefined

  for (const plugin of enabledPlugins) {
    const hooksPath = join(plugin.installPath, 'hooks', 'hooks.json')
    if (!existsSync(hooksPath)) continue
    try {
      const content = readFileSync(hooksPath, 'utf-8')
      const parsed = JSON.parse(content) as PluginHooksFile
      const hooks = normalizePluginHooks(parsed)
      if (!hooks) continue
      const replaced = replacePluginRootInHooks(hooks, plugin.installPath)
      merged = mergeHooksConfigs(merged, replaced)
    } catch (error) {
      console.error(`[Hooks] Failed to read plugin hooks: ${hooksPath}:`, error)
    }
  }

  return merged
}

/**
 * Clear settings cache
 */
export function clearSettingsCache(): void {
  settingsCache.clear()
}

/**
 * Merge multiple hooks configurations
 * Later sources take precedence (hooks are appended, not replaced)
 */
export function mergeHooksConfigs(...configs: (HooksConfig | undefined)[]): HooksConfig | undefined {
  const merged: HooksConfig = {}

  for (const config of configs) {
    if (!config) continue

    for (const eventType of HOOK_EVENT_TYPES) {
      const hooks = config[eventType]
      if (hooks && hooks.length > 0) {
        if (!merged[eventType]) {
          merged[eventType] = []
        }
        merged[eventType]!.push(...hooks)
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Build hooks configuration for SDK
 * Merges hooks from all sources in priority order
 */
export function buildHooksConfig(workDir: string): HooksConfig | undefined {
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const policy = getSpaceResourcePolicy(workDir)
  if (isStrictSpaceOnlyPolicy(policy) && policy.allowHooks !== true) {
    console.log('[Hooks] Strict space-only mode: hooks disabled')
    return undefined
  }
  const hooksDisabled =
    config.claudeCode?.hooksEnabled === false ||
    spaceConfig?.claudeCode?.hooksEnabled === false

  if (hooksDisabled) {
    console.log('[Hooks] Disabled by configuration')
    return undefined
  }

  const settingsHooks = loadUserSettingsHooks()
  const pluginHooks = loadPluginHooks()
  const sourceMode = getLockedConfigSourceMode()
  const globalHooks = sourceMode === 'kite' ? config.claudeCode?.hooks : undefined
  const spaceHooks = sourceMode === 'kite' ? spaceConfig?.claudeCode?.hooks : undefined
  const mergedHooks = sourceMode === 'claude'
    ? mergeHooksConfigs(settingsHooks, pluginHooks)
    : mergeHooksConfigs(settingsHooks, globalHooks, spaceHooks, pluginHooks)

  if (mergedHooks) {
    const hookCounts = Object.entries(mergedHooks)
      .map(([type, hooks]) => `${type}: ${hooks?.length || 0}`)
      .join(', ')
    console.log(`[Hooks] Merged hooks: ${hookCounts}`)
  }

  return mergedHooks
}

/**
 * Convert Kite hooks config to SDK format
 */
export function convertToSdkHooksFormat(hooks: HooksConfig | undefined): Record<string, unknown> | undefined {
  if (!hooks) return undefined

  const sdkHooks: Record<string, unknown> = {}

  for (const eventType of HOOK_EVENT_TYPES) {
    const hookDefs = hooks[eventType]
    if (hookDefs && hookDefs.length > 0) {
      sdkHooks[eventType] = hookDefs.map(def => ({
        matcher: def.matcher,
        hooks: def.hooks.map(hook => ({
          type: hook.type,
          command: hook.command,
          ...(hook.timeout && { timeout: hook.timeout })
        }))
      }))
    }
  }

  return Object.keys(sdkHooks).length > 0 ? sdkHooks : undefined
}

/**
 * Get all configured hooks for display/debugging
 */
export function getAllHooks(workDir?: string): {
  settings: HooksConfig | undefined
  global: HooksConfig | undefined
  space: HooksConfig | undefined
  merged: HooksConfig | undefined
} {
  const settingsHooks = loadUserSettingsHooks()
  const sourceMode = getLockedConfigSourceMode()
  const config = getConfig()
  const globalHooks = sourceMode === 'kite' ? config.claudeCode?.hooks : undefined
  const spaceHooks = sourceMode === 'kite' && workDir ? getSpaceConfig(workDir)?.claudeCode?.hooks : undefined
  const pluginHooks = loadPluginHooks()
  const merged = sourceMode === 'claude'
    ? mergeHooksConfigs(settingsHooks, pluginHooks)
    : mergeHooksConfigs(settingsHooks, globalHooks, spaceHooks, pluginHooks)

  return {
    settings: settingsHooks,
    global: globalHooks,
    space: spaceHooks,
    merged
  }
}
