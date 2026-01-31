/**
 * Hooks Service - Manages Claude Code hooks configuration
 *
 * Hooks are loaded from multiple sources and merged:
 * 1. ~/.halo/settings.json (Claude Code compatible format)
 * 2. config.claudeCode.hooks (Halo global config)
 * 3. space-config.json claudeCode.hooks (Space-level config)
 */

import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getConfig, getHaloDir, type HooksConfig } from './config.service'
import { getSpaceConfig } from './space-config.service'
import { FileCache } from '../utils/file-cache'

// ============================================
// Halo Settings Types (Claude Code compatible)
// ============================================

interface HaloSettings {
  hooks?: HooksConfig
}

// File cache for settings (mtime-based invalidation)
const settingsCache = new FileCache<HaloSettings | null>()

/**
 * Get the path to Halo settings file
 */
function getSettingsPath(): string {
  return join(getHaloDir(), 'settings.json')
}

/**
 * Load hooks from ~/.halo/settings.json
 */
function loadHaloSettingsHooks(): HooksConfig | undefined {
  const settingsPath = getSettingsPath()

  const settings = settingsCache.get(settingsPath, () => {
    if (!existsSync(settingsPath)) {
      return null
    }

    try {
      const content = readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(content) as HaloSettings
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
  const eventTypes: (keyof HooksConfig)[] = [
    'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'UserPromptSubmit'
  ]

  for (const config of configs) {
    if (!config) continue

    for (const eventType of eventTypes) {
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
  const settingsHooks = loadHaloSettingsHooks()
  const config = getConfig()
  const globalHooks = config.claudeCode?.hooks
  const spaceConfig = getSpaceConfig(workDir)
  const spaceHooks = spaceConfig?.claudeCode?.hooks

  const mergedHooks = mergeHooksConfigs(settingsHooks, globalHooks, spaceHooks)

  if (mergedHooks) {
    const hookCounts = Object.entries(mergedHooks)
      .map(([type, hooks]) => `${type}: ${hooks?.length || 0}`)
      .join(', ')
    console.log(`[Hooks] Merged hooks: ${hookCounts}`)
  }

  return mergedHooks
}

/**
 * Convert Halo hooks config to SDK format
 */
export function convertToSdkHooksFormat(hooks: HooksConfig | undefined): Record<string, unknown> | undefined {
  if (!hooks) return undefined

  const sdkHooks: Record<string, unknown> = {}
  const eventTypes: (keyof HooksConfig)[] = [
    'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'UserPromptSubmit'
  ]

  for (const eventType of eventTypes) {
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
  const settingsHooks = loadHaloSettingsHooks()
  const config = getConfig()
  const globalHooks = config.claudeCode?.hooks
  const spaceHooks = workDir ? getSpaceConfig(workDir)?.claudeCode?.hooks : undefined
  const merged = mergeHooksConfigs(settingsHooks, globalHooks, spaceHooks)

  return {
    settings: settingsHooks,
    global: globalHooks,
    space: spaceHooks,
    merged
  }
}
