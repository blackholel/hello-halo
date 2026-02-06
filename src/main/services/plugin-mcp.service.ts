/**
 * Plugin MCP Service
 *
 * Handles plugin MCP configuration and per-conversation enablement.
 */

import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { FileCache } from '../utils/file-cache'
import { getEnabledPluginByFullName, listEnabledPlugins, type PluginInfo } from './plugins.service'

// Cache for plugin MCP configs (by file path)
const pluginMcpCache = new FileCache<Record<string, unknown> | null>()

// In-memory per-conversation enabled plugin MCPs
const enabledPluginMcps = new Map<string, Set<string>>()

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const

/**
 * Recursively checks if an object contains dangerous keys that could lead to prototype pollution.
 */
function isSafeFromPrototypePollution(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isSafeFromPrototypePollution(item))
  }

  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.includes(key as any)) {
      return false
    }
    if (!isSafeFromPrototypePollution(obj[key])) {
      return false
    }
  }

  return true
}

function replacePluginRoot(value: unknown, pluginRoot: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePluginRoot(item, pluginRoot))
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      out[key] = replacePluginRoot(val, pluginRoot)
    }
    return out
  }
  return value
}

/**
 * Reads and validates plugin MCP configuration file.
 * Implements prototype pollution protection through string-based and object validation.
 */
function readPluginMcpConfigFile(plugin: PluginInfo): Record<string, unknown> | null {
  const mcpPath = join(plugin.installPath, '.mcp.json')
  return pluginMcpCache.get(mcpPath, () => {
    if (!existsSync(mcpPath)) return null

    try {
      const content = readFileSync(mcpPath, 'utf-8')

      const dangerousKeyPattern = /"(__proto__|constructor|prototype)"\s*:/
      if (dangerousKeyPattern.test(content)) {
        console.warn(`[MCP] Rejected .mcp.json for plugin ${plugin.fullName}: contains dangerous keys`)
        return null
      }

      const parsed = JSON.parse(content)

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`[MCP] Invalid .mcp.json for plugin ${plugin.fullName}: expected object`)
        return null
      }

      if (!isSafeFromPrototypePollution(parsed)) {
        console.warn(`[MCP] Rejected .mcp.json for plugin ${plugin.fullName}: unsafe structure`)
        return null
      }

      return replacePluginRoot(parsed, plugin.installPath) as Record<string, unknown>
    } catch (error) {
      console.error(`[MCP] Failed to read .mcp.json for plugin ${plugin.fullName}:`, error)
      return null
    }
  })
}

export function getPluginMcpConfig(plugin: PluginInfo): Record<string, unknown> | null {
  return readPluginMcpConfigFile(plugin)
}

export function pluginHasMcp(plugin: PluginInfo): boolean {
  const config = getPluginMcpConfig(plugin)
  return !!config && Object.keys(config).length > 0
}

export function enablePluginMcp(conversationId: string, pluginFullName: string): boolean {
  const existing = enabledPluginMcps.get(conversationId) || new Set<string>()
  const before = existing.size
  existing.add(pluginFullName)
  enabledPluginMcps.set(conversationId, existing)
  return existing.size > before
}

export function getEnabledPluginMcpList(conversationId: string): string[] {
  const set = enabledPluginMcps.get(conversationId)
  if (!set || set.size === 0) return []
  return Array.from(set).sort()
}

export function getEnabledPluginMcpHash(conversationId: string): string {
  const list = getEnabledPluginMcpList(conversationId)
  return list.join('|')
}

export function clearEnabledPluginMcps(conversationId: string): void {
  enabledPluginMcps.delete(conversationId)
}

export function buildPluginMcpServers(
  enabledPluginFullNames: string[],
  existingServers: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!enabledPluginFullNames || enabledPluginFullNames.length === 0) {
    return {}
  }

  const servers: Record<string, unknown> = {}
  for (const fullName of enabledPluginFullNames) {
    const plugin = getEnabledPluginByFullName(fullName)
    if (!plugin) continue

    const config = getPluginMcpConfig(plugin)
    if (!config) continue

    for (const [serverName, serverConfig] of Object.entries(config)) {
      if (existingServers[serverName] || servers[serverName]) {
        console.warn(
          `[MCP] Plugin MCP server "${serverName}" from ${plugin.fullName} ignored (name conflict)`
        )
        continue
      }
      servers[serverName] = serverConfig
    }
  }

  return servers
}

export function listEnabledPluginsWithMcp(): PluginInfo[] {
  return listEnabledPlugins().filter((plugin) => pluginHasMcp(plugin))
}
