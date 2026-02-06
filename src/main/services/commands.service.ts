/**
 * Commands Service - Manages Claude Code commands configuration
 *
 * Commands are loaded from:
 * 1. ~/.halo/commands/ - Default app-level commands directory
 * 2. {workDir}/.claude/commands/ - Space-level commands
 *
 * Each command is a markdown file (.md).
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import { getHaloDir } from './config.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'

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

function isValidCommandDir(dirPath: string): boolean {
  return isValidDirectoryPath(dirPath, 'Commands')
}

function getAllowedCommandBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'commands'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveWorkDirForCommandPath(commandPath: string): string | null {
  const normalizedPath = normalizePath(commandPath)
  const allowedBases = getAllowedCommandBaseDirs().map(normalizePath)
  for (const base of allowedBases) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

function extractDescription(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const firstLine = content.split('\n')[0]?.trim()
    if (!firstLine) return undefined

    if (firstLine.startsWith('# ')) {
      return firstLine.slice(2).trim().slice(0, 100)
    }
    if (!firstLine.startsWith('#')) {
      return firstLine.slice(0, 100)
    }
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
  const commands: CommandDefinition[] = []
  if (!isValidCommandDir(dirPath)) return commands

  try {
    const files = readdirSync(dirPath)
    for (const file of files) {
      if (!file.endsWith('.md')) continue

      const filePath = join(dirPath, file)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue

        const name = file.slice(0, -3)
        const description = extractDescription(filePath)

        commands.push({
          name,
          path: filePath,
          source,
          description,
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

function commandKey(command: CommandDefinition): string {
  return command.namespace ? `${command.namespace}:${command.name}` : command.name
}

function mergeCommands(globalCommands: CommandDefinition[], spaceCommands: CommandDefinition[]): CommandDefinition[] {
  const merged = new Map<string, CommandDefinition>()
  for (const command of globalCommands) {
    merged.set(commandKey(command), command)
  }
  for (const command of spaceCommands) {
    merged.set(commandKey(command), command)
  }
  return Array.from(merged.values())
}

function buildGlobalCommands(): CommandDefinition[] {
  const commands: CommandDefinition[] = []
  const seenNames = new Set<string>()

  const addCommands = (newCommands: CommandDefinition[]) => {
    for (const command of newCommands) {
      const key = commandKey(command)
      if (seenNames.has(key)) {
        const idx = commands.findIndex(c => commandKey(c) === key)
        if (idx >= 0) {
          commands.splice(idx, 1)
        }
      }
      commands.push(command)
      seenNames.add(key)
    }
  }

  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    const pluginCommandsPath = join(plugin.installPath, 'commands')
    addCommands(scanCommandDir(pluginCommandsPath, 'plugin', plugin.installPath, plugin.name))
  }

  const haloDir = getHaloDir()
  if (haloDir) {
    const appCommandsPath = join(haloDir, 'commands')
    addCommands(scanCommandDir(appCommandsPath, 'app'))
  }

  return commands
}

function buildSpaceCommands(workDir: string): CommandDefinition[] {
  const spaceCommandsPath = join(workDir, '.claude', 'commands')
  return scanCommandDir(spaceCommandsPath, 'space')
}

export function listCommands(workDir?: string): CommandDefinition[] {
  const globalCommands = globalCommandsCache ?? buildGlobalCommands()
  if (!globalCommandsCache) {
    globalCommandsCache = globalCommands
  }

  if (!workDir) {
    if (globalCommands.length > 0) {
      console.log(`[Commands] Found ${globalCommands.length} commands: ${globalCommands.map(c => commandKey(c)).join(', ')}`)
    }
    return globalCommands
  }

  let spaceCommands = spaceCommandsCache.get(workDir)
  if (!spaceCommands) {
    spaceCommands = buildSpaceCommands(workDir)
    spaceCommandsCache.set(workDir, spaceCommands)
  }

  const commands = mergeCommands(globalCommands, spaceCommands)
  if (commands.length > 0) {
    console.log(`[Commands] Found ${commands.length} commands: ${commands.map(c => commandKey(c)).join(', ')}`)
  }
  return commands
}

function findCommand(commands: CommandDefinition[], name: string): CommandDefinition | undefined {
  if (name.includes(':')) {
    const [namespace, cmdName] = name.split(':', 2)
    return commands.find(c => c.name === cmdName && c.namespace === namespace) ||
           commands.find(c => c.name === cmdName && !c.namespace) ||
           commands.find(c => c.name === cmdName)
  }
  return commands.find(c => c.name === name && !c.namespace) ||
         commands.find(c => c.name === name)
}

export function getCommandContent(
  name: string,
  workDir?: string,
  opts?: { silent?: boolean }
): string | null {
  const commands = listCommands(workDir)
  const command = findCommand(commands, name)

  if (!command) {
    if (!opts?.silent) {
      console.warn(`[Commands] Command not found: ${name}`)
    }
    return null
  }

  try {
    let content = readFileSync(command.path, 'utf-8')
    if (command.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, command.pluginRoot)
    }
    return content
  } catch (error) {
    console.error(`[Commands] Failed to read command ${name}:`, error)
    return null
  }
}

export function clearCommandsCache(): void {
  globalCommandsCache = null
  spaceCommandsCache.clear()
}

export function invalidateCommandsCache(workDir?: string | null): void {
  if (!workDir) {
    globalCommandsCache = null
    return
  }
  spaceCommandsCache.delete(workDir)
}

export function isCommandPathAllowed(commandPath: string): boolean {
  const allowedBases = getAllowedCommandBaseDirs()
  return isPathWithinBasePaths(commandPath, allowedBases)
}
