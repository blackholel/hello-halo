/**
 * Space Config Service - Manages space-level configuration
 *
 * Space configuration is stored at {workDir}/.kite/space-config.json
 * It allows per-project customization of plugins, hooks, MCP servers, etc.
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { HooksConfig, ClaudeCodeConfig } from './config.service'
import { mergeHooksConfigs } from './hooks.service'
import { FileCache } from '../utils/file-cache'

// ============================================
// Space Configuration Types
// ============================================

export interface SpacePluginsConfig {
  paths?: string[]
  disableGlobal?: boolean
  loadDefaultPath?: boolean
}

export interface SpaceMcpServerConfig {
  type?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
  disabled?: boolean
}

export interface SpaceClaudeCodeConfig {
  plugins?: SpacePluginsConfig
  hooks?: HooksConfig
  mcpServers?: Record<string, SpaceMcpServerConfig>
  hooksEnabled?: boolean
  mcpEnabled?: boolean
  skillsLazyLoad?: boolean
  enableProjectSettings?: boolean
}

export interface SpaceResourcePolicy {
  version: number
  mode: 'strict-space-only' | 'legacy'
  // Deprecated: kept for backward-compatible config parsing only.
  // Hooks runtime enablement is controlled by claudeCode.hooksEnabled.
  allowHooks?: boolean
  allowMcp?: boolean
  allowPluginMcpDirective?: boolean
  allowedSources?: Array<'space'>
}

export interface SpaceToolkit {
  skills: import('./agent/types').DirectiveRef[]
  commands: import('./agent/types').DirectiveRef[]
  agents: import('./agent/types').DirectiveRef[]
}

export interface SpaceConfig {
  claudeCode?: SpaceClaudeCodeConfig
  toolkit?: SpaceToolkit
  resourcePolicy?: SpaceResourcePolicy
}

// File cache for space configs (mtime-based invalidation)
const spaceConfigCache = new FileCache<SpaceConfig | null>()

/**
 * Get space configuration for a workspace directory
 */
export function getSpaceConfig(workDir: string): SpaceConfig | null {
  if (!workDir) return null

  const configPath = join(workDir, '.kite', 'space-config.json')

  return spaceConfigCache.get(configPath, () => {
    if (!existsSync(configPath)) {
      return null
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(content) as SpaceConfig
      console.log(`[SpaceConfig] Loaded space config from: ${configPath}`)
      return config
    } catch (error) {
      console.error(`[SpaceConfig] Failed to read space config:`, error)
      return null
    }
  })
}

/**
 * Clear space config cache for a workspace
 */
export function clearSpaceConfigCache(workDir?: string): void {
  if (workDir) {
    const configPath = join(workDir, '.kite', 'space-config.json')
    spaceConfigCache.clear(configPath)
  } else {
    spaceConfigCache.clear()
  }
}

/**
 * Merge global and space-level Claude Code configurations
 * Space config takes precedence over global config
 */
export function mergeClaudeCodeConfigs(
  global: ClaudeCodeConfig | undefined,
  space: SpaceClaudeCodeConfig | undefined
): ClaudeCodeConfig {
  if (!global && !space) {
    return {}
  }

  if (!space) {
    return global || {}
  }

  if (!global) {
    return {
      plugins: space.plugins ? {
        globalPaths: space.plugins.paths,
        loadDefaultPaths: space.plugins.loadDefaultPath
      } : undefined,
      hooks: space.hooks
    }
  }

  // Merge plugins config
  const mergedPlugins = {
    enabled: global.plugins?.enabled,
    globalPaths: global.plugins?.globalPaths,
    loadDefaultPaths: global.plugins?.loadDefaultPaths,
    ...(space.plugins?.loadDefaultPath !== undefined && {
      loadDefaultPaths: space.plugins.loadDefaultPath
    })
  }

  // Merge hooks config (space hooks are added after global hooks)
  const mergedHooks = mergeHooksConfigs(global.hooks, space.hooks)

  return {
    ...global,
    plugins: mergedPlugins,
    hooks: mergedHooks
  }
}

/**
 * Merge MCP servers from global and space configs
 * Space servers override global servers with the same name
 */
export function mergeMcpServers(
  global: Record<string, unknown> | undefined,
  space: Record<string, SpaceMcpServerConfig> | undefined
): Record<string, unknown> {
  if (!global && !space) return {}
  if (!space) return global || {}
  if (!global) return space

  return {
    ...global,
    ...space
  }
}

/**
 * Update space configuration atomically.
 * The updater receives the current config and returns the new config.
 * Returns the updated config, or null on failure.
 */
export function updateSpaceConfig(
  workDir: string,
  updater: (config: SpaceConfig) => SpaceConfig
): SpaceConfig | null {
  if (!workDir) return null

  const configDir = join(workDir, '.kite')
  const configPath = join(configDir, 'space-config.json')

  try {
    const current = getSpaceConfig(workDir) ?? {}
    const updated = updater(current)

    mkdirSync(configDir, { recursive: true })
    writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')

    // Invalidate cache so next read picks up the new value
    spaceConfigCache.clear(configPath)

    console.log(`[SpaceConfig] Updated space config: ${configPath}`)
    return updated
  } catch (error) {
    console.error(`[SpaceConfig] Failed to update space config:`, error)
    return null
  }
}
