/**
 * Commands Service - Manages Claude Code commands configuration
 *
 * Commands are loaded from:
 * 1. ~/.kite/commands/ - Default app-level commands directory
 * 2. {workDir}/.claude/commands/ - Space-level commands
 *
 * Each command is a markdown file (.md).
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getKiteDir } from './config.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError, isWorkDirAllowed } from '../utils/path-validation'
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveWorkDirForCommandPath(commandPath: string): string | null {
  const normalizedPath = normalizePath(commandPath)
  for (const base of getAllowedCommandBaseDirs().map(normalizePath)) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

function extractDescriptionFromContent(content: string): string | undefined {
  const firstLine = content.split('\n')[0]?.trim()
  if (!firstLine) return undefined
  if (firstLine.startsWith('# ')) return firstLine.slice(2).trim().slice(0, 100)
  if (!firstLine.startsWith('#')) return firstLine.slice(0, 100)
  return undefined
}

function extractDescription(filePath: string): string | undefined {
  try {
    return extractDescriptionFromContent(readFileSync(filePath, 'utf-8'))
  } catch {
    return undefined
  }
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

  const kiteDir = getKiteDir()
  if (kiteDir) {
    addCommands(scanCommandDir(join(kiteDir, 'commands'), 'app'))
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

/**
 * Validate that a command path is within allowed directories and exists on disk.
 * Returns false (with a warning log) if validation fails.
 */
function validateCommandPath(commandPath: string, action: string): boolean {
  if (!isPathWithinBasePaths(commandPath, getAllowedCommandBaseDirs())) {
    console.warn(`[Commands] Cannot ${action} command outside of space commands directory: ${commandPath}`)
    return false
  }
  if (!existsSync(commandPath)) {
    console.warn(`[Commands] Command file not found: ${commandPath}`)
    return false
  }
  return true
}

function invalidateCacheForPath(commandPath: string): void {
  const workDir = resolveWorkDirForCommandPath(commandPath)
  if (workDir) {
    invalidateCommandsCache(workDir)
  } else {
    clearCommandsCache()
  }
}

export function createCommand(workDir: string, name: string, content: string): CommandDefinition {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`Invalid command name: ${name}`)
  }

  if (!isWorkDirAllowed(workDir, getAllSpacePaths())) {
    throw new Error(`workDir is not an allowed workspace path: ${workDir}`)
  }

  const commandsDir = join(workDir, '.claude', 'commands')
  const commandPath = join(commandsDir, `${name}.md`)

  mkdirSync(commandsDir, { recursive: true })
  writeFileSync(commandPath, content, 'utf-8')
  invalidateCommandsCache(workDir)

  return {
    name,
    path: commandPath,
    source: 'space',
    description: extractDescriptionFromContent(content)
  }
}

export function updateCommand(commandPath: string, content: string): boolean {
  try {
    if (!validateCommandPath(commandPath, 'update')) return false
    writeFileSync(commandPath, content, 'utf-8')
    invalidateCacheForPath(commandPath)
    return true
  } catch (error) {
    console.error('[Commands] Failed to update command:', error)
    return false
  }
}

export function deleteCommand(commandPath: string): boolean {
  try {
    if (!validateCommandPath(commandPath, 'delete')) return false
    rmSync(commandPath, { force: true })
    invalidateCacheForPath(commandPath)
    return true
  } catch (error) {
    console.error('[Commands] Failed to delete command:', error)
    return false
  }
}

export function copyCommandToSpace(commandName: string, workDir: string): CommandDefinition | null {
  const sourceCommand = findCommand(listCommands(workDir), commandName)
  if (!sourceCommand) {
    console.warn(`[Commands] Source command not found: ${commandName}`)
    return null
  }

  if (sourceCommand.source === 'space') {
    console.warn(`[Commands] Command is already in space: ${commandName}`)
    return sourceCommand
  }

  try {
    const targetDir = join(workDir, '.claude', 'commands')
    const targetPath = join(targetDir, `${sourceCommand.name}.md`)
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(sourceCommand.path, targetPath)
    invalidateCommandsCache(workDir)
    return {
      ...sourceCommand,
      path: targetPath,
      source: 'space'
    }
  } catch (error) {
    console.error('[Commands] Failed to copy command to space:', error)
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
