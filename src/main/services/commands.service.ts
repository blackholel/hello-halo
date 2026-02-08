/**
 * Commands Service - Manages Claude Code commands configuration
 *
 * Commands are loaded from:
 * 1. ~/.halo/commands/ - Default app-level commands directory
 * 2. {workDir}/.claude/commands/ - Space-level commands
 *
 * Each command is a markdown file (.md).
 */

import { join } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import { getHaloDir } from './config.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'
import { FileCache } from '../utils/file-cache'
import { commandKey } from '../../shared/command-utils'

// ============================================
// Command Types
// ============================================

export interface CommandDefinition {
  name: string
  path: string
  source: 'app' | 'space' | 'plugin'
  description?: string
  pluginRoot?: string
  namespace?: string
}

// Cache for commands list (in-memory only)
let globalCommandsCache: CommandDefinition[] | null = null
const spaceCommandsCache = new Map<string, CommandDefinition[]>()
const contentCache = new FileCache<string>({ maxSize: 200 })

function getAllowedCommandBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'commands'))
}

function extractDescription(filePath: string): string | undefined {
  try {
    const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0]?.trim()
    if (!firstLine) return undefined
    if (firstLine.startsWith('# ')) return firstLine.slice(2).trim().slice(0, 100)
    if (!firstLine.startsWith('#')) return firstLine.slice(0, 100)
  } catch {
    // Ignore read errors
  }
  return undefined
}

function scanCommandDir(
  dirPath: string,
  source: CommandDefinition['source'],
  pluginRoot?: string,
  namespace?: string
): CommandDefinition[] {
  if (!isValidDirectoryPath(dirPath, 'Commands')) return []

  const commands: CommandDefinition[] = []
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.md')) continue
      const filePath = join(dirPath, file)
      try {
        if (!statSync(filePath).isFile()) continue
        commands.push({
          name: file.slice(0, -3),
          path: filePath,
          source,
          description: extractDescription(filePath),
          ...(pluginRoot && { pluginRoot }),
          ...(namespace && { namespace })
        })
      } catch {
        // Skip files that can't be stat'd
      }
    }
  } catch (error) {
    console.warn(`[Commands] Failed to scan directory ${dirPath}:`, error)
  }
  return commands
}

function mergeCommands(globalCommands: CommandDefinition[], spaceCommands: CommandDefinition[]): CommandDefinition[] {
  const merged = new Map<string, CommandDefinition>()
  for (const cmd of globalCommands) merged.set(commandKey(cmd), cmd)
  for (const cmd of spaceCommands) merged.set(commandKey(cmd), cmd)
  return Array.from(merged.values())
}

function buildGlobalCommands(): CommandDefinition[] {
  const commands: CommandDefinition[] = []
  const seenNames = new Set<string>()

  const addCommands = (newCommands: CommandDefinition[]): void => {
    for (const cmd of newCommands) {
      const key = commandKey(cmd)
      if (seenNames.has(key)) {
        const idx = commands.findIndex(c => commandKey(c) === key)
        if (idx >= 0) commands.splice(idx, 1)
      }
      commands.push(cmd)
      seenNames.add(key)
    }
  }

  for (const plugin of listEnabledPlugins()) {
    addCommands(scanCommandDir(join(plugin.installPath, 'commands'), 'plugin', plugin.installPath, plugin.name))
  }

  const haloDir = getHaloDir()
  if (haloDir) {
    addCommands(scanCommandDir(join(haloDir, 'commands'), 'app'))
  }

  return commands
}

function buildSpaceCommands(workDir: string): CommandDefinition[] {
  return scanCommandDir(join(workDir, '.claude', 'commands'), 'space')
}

function findCommand(commands: CommandDefinition[], name: string): CommandDefinition | undefined {
  if (name.includes(':')) {
    const [namespace, cmdName] = name.split(':', 2)
    return commands.find(c => c.name === cmdName && c.namespace === namespace)
      ?? commands.find(c => c.name === cmdName && !c.namespace)
      ?? commands.find(c => c.name === cmdName)
  }
  return commands.find(c => c.name === name && !c.namespace)
    ?? commands.find(c => c.name === name)
}

function logFound(items: CommandDefinition[]): void {
  if (items.length > 0) {
    console.log(`[Commands] Found ${items.length} commands: ${items.map(commandKey).join(', ')}`)
  }
}

export function listCommands(workDir?: string): CommandDefinition[] {
  if (!globalCommandsCache) {
    globalCommandsCache = buildGlobalCommands()
  }

  if (!workDir) {
    logFound(globalCommandsCache)
    return globalCommandsCache
  }

  let spaceCommands = spaceCommandsCache.get(workDir)
  if (!spaceCommands) {
    spaceCommands = buildSpaceCommands(workDir)
    spaceCommandsCache.set(workDir, spaceCommands)
  }

  const commands = mergeCommands(globalCommandsCache, spaceCommands)
  logFound(commands)
  return commands
}

export function getCommandContent(
  name: string,
  workDir?: string,
  opts?: { silent?: boolean }
): string | null {
  const command = findCommand(listCommands(workDir), name)

  if (!command) {
    if (!opts?.silent) console.warn(`[Commands] Command not found: ${name}`)
    return null
  }

  try {
    let content = contentCache.get(command.path, () => readFileSync(command.path, 'utf-8'))
    if (command.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, command.pluginRoot)
    }
    return content
  } catch (error) {
    contentCache.clear(command.path)
    if (isFileNotFoundError(error)) {
      console.debug(`[Commands] Command file not found: ${name}`)
    } else {
      console.warn(`[Commands] Failed to read command ${name}:`, error)
    }
    return null
  }
}

export function clearCommandsCache(): void {
  globalCommandsCache = null
  spaceCommandsCache.clear()
  contentCache.clear()
}

export function invalidateCommandsCache(workDir?: string | null): void {
  if (!workDir) {
    globalCommandsCache = null
    contentCache.clear()
    return
  }
  spaceCommandsCache.delete(workDir)
  contentCache.clearForDir(workDir)
}

export function isCommandPathAllowed(commandPath: string): boolean {
  return isPathWithinBasePaths(commandPath, getAllowedCommandBaseDirs())
}
