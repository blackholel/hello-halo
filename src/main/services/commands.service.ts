/**
 * Commands Service - Manages Claude Code commands configuration
 *
 * Commands are loaded from:
 * 1. {locked-user-root}/commands/ - Default app-level commands directory
 * 2. {workDir}/.claude/commands/ - Space-level commands
 *
 * Each command is a markdown file (.md).
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getLockedUserConfigRootDir } from './config-source-mode.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError, isWorkDirAllowed } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'
import { FileCache } from '../utils/file-cache'
import type { ResourceRef, CopyToSpaceOptions, CopyToSpaceResult } from './resource-ref.service'
import { commandKey } from '../../shared/command-utils'
import type { SceneTagKey } from '../../shared/scene-taxonomy'
import {
  parseResourceMetadata,
  getFrontmatterString,
  getFrontmatterStringArray,
  getLocalizedFrontmatterString
} from './resource-metadata.service'
import { resolveSceneTags } from './resource-scene-tags.service'
import { buildResourceSceneKey, getSceneTaxonomy } from './scene-taxonomy.service'
import type { ResourceListView, ResourceExposure } from '../../shared/resource-access'
import { filterByResourceExposure, resolveResourceExposure } from './resource-exposure.service'

// ============================================
// Command Types
// ============================================

export interface CommandDefinition {
  name: string
  displayName?: string
  path: string
  source: 'app' | 'space' | 'plugin'
  description?: string
  sceneTags: SceneTagKey[]
  pluginRoot?: string
  namespace?: string
  exposure: ResourceExposure
  requiresSkills?: string[]
  requiresAgents?: string[]
}

// Cache for commands list (in-memory only)
const DEFAULT_LOCALE_CACHE_KEY = '__default__'
const globalCommandsCacheByLocale = new Map<string, CommandDefinition[]>()
const spaceCommandsCacheByLocale = new Map<string, Map<string, CommandDefinition[]>>()
const contentCache = new FileCache<string>({ maxSize: 200 })

function getAllowedCommandBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'commands'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function toLocaleCacheKey(locale?: string): string {
  const trimmed = locale?.trim()
  if (!trimmed) return DEFAULT_LOCALE_CACHE_KEY
  return trimmed.toLowerCase()
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

function readCommandMetadata(
  filePath: string,
  name: string,
  source: CommandDefinition['source'],
  namespace?: string,
  workDir?: string,
  locale?: string
): {
  displayName?: string
  description?: string
  sceneTags: SceneTagKey[]
  exposure?: unknown
  requiresSkills?: string[]
  requiresAgents?: string[]
} {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const metadata = parseResourceMetadata(content)
    const taxonomy = getSceneTaxonomy().config
    const localizedDescription =
      getLocalizedFrontmatterString(metadata.frontmatter, ['description'], locale) ?? metadata.description
    const displayName = getLocalizedFrontmatterString(metadata.frontmatter, ['name', 'title'], locale)
    const exposure = getFrontmatterString(metadata.frontmatter, ['exposure'])
    const requiresSkills = getFrontmatterStringArray(metadata.frontmatter, ['requires_skills'])
    const requiresAgents = getFrontmatterStringArray(metadata.frontmatter, ['requires_agents'])
    return {
      displayName,
      description: localizedDescription,
      exposure,
      requiresSkills,
      requiresAgents,
      sceneTags: resolveSceneTags({
        name,
        description: metadata.description,
        content,
        frontmatter: metadata.frontmatter,
        resourceKey: buildResourceSceneKey({
          type: 'command',
          source,
          workDir,
          namespace,
          name
        }),
        definitions: taxonomy.definitions,
        resourceOverrides: taxonomy.resourceOverrides
      })
    }
  } catch {
    return { sceneTags: ['office'], exposure: undefined, requiresSkills: undefined, requiresAgents: undefined }
  }
}

function scanCommandDir(
  dirPath: string,
  source: CommandDefinition['source'],
  pluginRoot?: string,
  namespace?: string,
  workDir?: string,
  locale?: string
): CommandDefinition[] {
  if (!isValidDirectoryPath(dirPath, 'Commands')) return []

  const commands: CommandDefinition[] = []
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.md')) continue
      const filePath = join(dirPath, file)
      try {
        if (!statSync(filePath).isFile()) continue
        const name = file.slice(0, -3)
        const metadata = readCommandMetadata(filePath, name, source, namespace, workDir, locale)
        commands.push({
          name,
          path: filePath,
          source,
          exposure: resolveResourceExposure({
            type: 'command',
            source,
            name,
            namespace,
            workDir,
            frontmatterExposure: metadata.exposure
          }),
          description: metadata.description,
          sceneTags: metadata.sceneTags,
          ...(metadata.requiresSkills && { requiresSkills: metadata.requiresSkills }),
          ...(metadata.requiresAgents && { requiresAgents: metadata.requiresAgents }),
          ...(metadata.displayName && { displayName: metadata.displayName }),
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

function buildGlobalCommands(locale?: string): CommandDefinition[] {
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
    addCommands(scanCommandDir(join(plugin.installPath, 'commands'), 'plugin', plugin.installPath, plugin.name, undefined, locale))
  }

  addCommands(scanCommandDir(join(getLockedUserConfigRootDir(), 'commands'), 'app', undefined, undefined, undefined, locale))

  return commands
}

function buildSpaceCommands(workDir: string, locale?: string): CommandDefinition[] {
  return scanCommandDir(join(workDir, '.claude', 'commands'), 'space', undefined, undefined, workDir, locale)
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

function findCommandByRef(commands: CommandDefinition[], ref: ResourceRef): CommandDefinition | undefined {
  if (ref.path) {
    const byPath = commands.find(command => command.path === ref.path)
    if (byPath) return byPath
  }

  return commands.find((command) => {
    if (command.name !== ref.name) return false
    if ((ref.namespace || undefined) !== (command.namespace || undefined)) return false
    if (ref.source && command.source !== ref.source) return false
    return true
  })
}

function logFound(items: CommandDefinition[], locale?: string): void {
  if (items.length > 0) {
    const localeSuffix = locale ? ` (locale: ${locale})` : ''
    console.log(`[Commands] Found ${items.length} commands${localeSuffix}: ${items.map(commandKey).join(', ')}`)
  }
}

function listCommandsUnfiltered(workDir?: string, locale?: string): CommandDefinition[] {
  const localeKey = toLocaleCacheKey(locale)
  let globalCommands = globalCommandsCacheByLocale.get(localeKey)
  if (!globalCommands) {
    globalCommands = buildGlobalCommands(locale)
    globalCommandsCacheByLocale.set(localeKey, globalCommands)
  }

  if (!workDir) {
    return globalCommands
  }

  let spaceCache = spaceCommandsCacheByLocale.get(workDir)
  if (!spaceCache) {
    spaceCache = new Map<string, CommandDefinition[]>()
    spaceCommandsCacheByLocale.set(workDir, spaceCache)
  }

  let spaceCommands = spaceCache.get(localeKey)
  if (!spaceCommands) {
    spaceCommands = buildSpaceCommands(workDir, locale)
    spaceCache.set(localeKey, spaceCommands)
  }

  const commands = mergeCommands(globalCommands, spaceCommands)
  return commands
}

export function listCommands(workDir: string | undefined, view: ResourceListView, locale?: string): CommandDefinition[] {
  const commands = filterByResourceExposure(listCommandsUnfiltered(workDir, locale), view)
  logFound(commands, locale)
  return commands
}

export function listSpaceCommands(workDir: string): CommandDefinition[] {
  return listCommandsUnfiltered(workDir).filter(command => command.source === 'space')
}

function listCommandsForRefLookup(workDir: string): CommandDefinition[] {
  let globalCommands = globalCommandsCacheByLocale.get(DEFAULT_LOCALE_CACHE_KEY)
  if (!globalCommands) {
    globalCommands = buildGlobalCommands()
    globalCommandsCacheByLocale.set(DEFAULT_LOCALE_CACHE_KEY, globalCommands)
  }

  let spaceCache = spaceCommandsCacheByLocale.get(workDir)
  if (!spaceCache) {
    spaceCache = new Map<string, CommandDefinition[]>()
    spaceCommandsCacheByLocale.set(workDir, spaceCache)
  }

  let spaceCommands = spaceCache.get(DEFAULT_LOCALE_CACHE_KEY)
  if (!spaceCommands) {
    spaceCommands = buildSpaceCommands(workDir)
    spaceCache.set(DEFAULT_LOCALE_CACHE_KEY, spaceCommands)
  }

  // Keep source-distinct entries for by-ref copy lookup; do not merge by key.
  return [...spaceCommands, ...globalCommands]
}

export function getCommand(name: string, workDir?: string): CommandDefinition | null {
  return findCommand(listCommandsUnfiltered(workDir), name) ?? null
}

export function getCommandContent(
  name: string,
  workDir?: string,
  opts?: { silent?: boolean; locale?: string; executionMode?: 'display' | 'execute' }
): string | null {
  const executionMode = opts?.executionMode === 'execute' ? 'execute' : 'display'
  const localeSuffix = opts?.locale ? ` (locale: ${opts.locale})` : ''
  const command = findCommand(listCommandsUnfiltered(workDir), name)

  if (!command) {
    if (!opts?.silent) console.warn(`[Commands] Command not found: ${name}${localeSuffix} [mode=${executionMode}]`)
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
      console.warn(`[Commands] Failed to read command ${name}${localeSuffix} [mode=${executionMode}]:`, error)
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
  const metadata = parseResourceMetadata(content)
  const displayName = getLocalizedFrontmatterString(metadata.frontmatter, ['name', 'title'])

  const taxonomy = getSceneTaxonomy().config
  const requiresSkills = getFrontmatterStringArray(metadata.frontmatter, ['requires_skills'])
  const requiresAgents = getFrontmatterStringArray(metadata.frontmatter, ['requires_agents'])
  const exposure = resolveResourceExposure({
    type: 'command',
    source: 'space',
    workDir,
    name,
    frontmatterExposure: getFrontmatterString(metadata.frontmatter, ['exposure'])
  })
  return {
    name,
    path: commandPath,
    source: 'space',
    exposure,
    description: metadata.description,
    ...(requiresSkills && { requiresSkills }),
    ...(requiresAgents && { requiresAgents }),
    ...(displayName && { displayName }),
    sceneTags: resolveSceneTags({
      name,
      description: metadata.description,
      content,
      frontmatter: metadata.frontmatter,
      resourceKey: buildResourceSceneKey({
        type: 'command',
        source: 'space',
        workDir,
        name
      }),
      definitions: taxonomy.definitions,
      resourceOverrides: taxonomy.resourceOverrides
    })
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
  const result = copyCommandToSpaceByRef({ type: 'command', name: commandName }, workDir)
  return result.status === 'copied' ? (result.data ?? null) : null
}

export function copyCommandToSpaceByRef(
  ref: ResourceRef,
  workDir: string,
  options?: CopyToSpaceOptions
): CopyToSpaceResult<CommandDefinition> {
  const sourceCommand = findCommandByRef(listCommandsForRefLookup(workDir), ref)
  if (!sourceCommand) {
    console.warn(`[Commands] Source command not found: ${ref.name}`)
    return { status: 'not_found' }
  }

  const targetDir = join(workDir, '.claude', 'commands')
  const targetPath = join(targetDir, `${sourceCommand.name}.md`)

  if (sourceCommand.source === 'space' && sourceCommand.path === targetPath) {
    return { status: 'copied', data: sourceCommand }
  }

  if (existsSync(targetPath) && !options?.overwrite) {
    return { status: 'conflict', existingPath: targetPath }
  }

  try {
    if (existsSync(targetPath) && options?.overwrite) {
      rmSync(targetPath, { force: true })
    }
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(sourceCommand.path, targetPath)
    invalidateCommandsCache(workDir)
    return {
      status: 'copied',
      data: { ...sourceCommand, path: targetPath, source: 'space' }
    }
  } catch (error) {
    console.error('[Commands] Failed to copy command to space:', error)
    return { status: 'not_found', error: (error as Error).message }
  }
}

export function clearCommandsCache(): void {
  globalCommandsCacheByLocale.clear()
  spaceCommandsCacheByLocale.clear()
  contentCache.clear()
}

export function invalidateCommandsCache(workDir?: string | null): void {
  if (!workDir) {
    globalCommandsCacheByLocale.clear()
    contentCache.clear()
    return
  }
  spaceCommandsCacheByLocale.delete(workDir)
  contentCache.clearForDir(workDir)
}

export function isCommandPathAllowed(commandPath: string): boolean {
  return isPathWithinBasePaths(commandPath, getAllowedCommandBaseDirs())
}
