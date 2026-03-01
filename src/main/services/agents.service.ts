/**
 * Agents Service - Manages Claude Code agents configuration
 *
 * Agents are loaded from multiple sources:
 * 1. {locked-user-root}/agents/ - Default app-level agents directory
 * 2. config.claudeCode.agents.paths - Custom global paths
 * 3. {workDir}/.claude/agents/ - Space-level agents (Claude Code compatible)
 *
 * Each agent is a markdown file (.md) containing agent instructions.
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getConfig } from './config.service'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'
import { getAllSpacePaths } from './space.service'
import type { ResourceRef, CopyToSpaceOptions, CopyToSpaceResult } from './resource-ref.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'
import { FileCache } from '../utils/file-cache'
import type { SceneTagKey } from '../../shared/scene-taxonomy'
import { parseResourceMetadata, getFrontmatterString, getLocalizedFrontmatterString } from './resource-metadata.service'
import { resolveSceneTags } from './resource-scene-tags.service'
import { buildResourceSceneKey, getSceneTaxonomy } from './scene-taxonomy.service'
import type { ResourceListView, ResourceExposure } from '../../shared/resource-access'
import { filterByResourceExposure, resolveResourceExposure } from './resource-exposure.service'

// ============================================
// Agent Types
// ============================================

export interface AgentDefinition {
  name: string
  displayName?: string
  path: string
  source: 'app' | 'global' | 'space' | 'plugin'
  description?: string
  sceneTags: SceneTagKey[]
  pluginRoot?: string
  namespace?: string
  exposure: ResourceExposure
}

// Cache for agents list (in-memory only)
const DEFAULT_LOCALE_CACHE_KEY = '__default__'
const globalAgentsCacheByLocale = new Map<string, AgentDefinition[]>()
const spaceAgentsCacheByLocale = new Map<string, Map<string, AgentDefinition[]>>()
const contentCache = new FileCache<string>({ maxSize: 200 })

function agentKey(agent: AgentDefinition): string {
  return agent.namespace ? `${agent.namespace}:${agent.name}` : agent.name
}

function getAllowedAgentBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'agents'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function toLocaleCacheKey(locale?: string): string {
  const trimmed = locale?.trim()
  if (!trimmed) return DEFAULT_LOCALE_CACHE_KEY
  return trimmed.toLowerCase()
}

function resolveWorkDirForAgentPath(agentPath: string): string | null {
  const normalizedPath = normalizePath(agentPath)
  for (const base of getAllowedAgentBaseDirs().map(normalizePath)) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

function readAgentMetadata(
  filePath: string,
  name: string,
  source: AgentDefinition['source'],
  namespace?: string,
  workDir?: string,
  locale?: string
): { displayName?: string; description?: string; sceneTags: SceneTagKey[]; exposure?: unknown } {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const metadata = parseResourceMetadata(content)
    const taxonomy = getSceneTaxonomy().config
    const localizedDescription =
      getLocalizedFrontmatterString(metadata.frontmatter, ['description'], locale) ?? metadata.description
    const displayName = getLocalizedFrontmatterString(metadata.frontmatter, ['name', 'title'], locale)
    const exposure = getFrontmatterString(metadata.frontmatter, ['exposure'])
    return {
      displayName,
      description: localizedDescription,
      exposure,
      sceneTags: resolveSceneTags({
        name,
        description: metadata.description,
        content,
        frontmatter: metadata.frontmatter,
        resourceKey: buildResourceSceneKey({
          type: 'agent',
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
    // Ignore read errors
    return { sceneTags: ['office'], exposure: undefined }
  }
}

function scanAgentDir(
  dirPath: string,
  source: AgentDefinition['source'],
  pluginRoot?: string,
  namespace?: string,
  workDir?: string,
  locale?: string
): AgentDefinition[] {
  if (!isValidDirectoryPath(dirPath, 'Agents')) return []

  const agents: AgentDefinition[] = []
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.md')) continue
      const filePath = join(dirPath, file)
      try {
        if (!statSync(filePath).isFile()) continue
        const name = file.slice(0, -3)
        const metadata = readAgentMetadata(filePath, name, source, namespace, workDir, locale)
        agents.push({
          name,
          path: filePath,
          source,
          exposure: resolveResourceExposure({
            type: 'agent',
            source,
            name,
            namespace,
            workDir,
            frontmatterExposure: metadata.exposure
          }),
          description: metadata.description,
          sceneTags: metadata.sceneTags,
          ...(metadata.displayName && { displayName: metadata.displayName }),
          ...(pluginRoot && { pluginRoot }),
          ...(namespace && { namespace })
        })
      } catch {
        // Skip files that can't be stat'd
      }
    }
  } catch (error) {
    console.warn(`[Agents] Failed to scan directory ${dirPath}:`, error)
  }
  return agents
}

function mergeAgents(globalAgents: AgentDefinition[], spaceAgents: AgentDefinition[]): AgentDefinition[] {
  const merged = new Map<string, AgentDefinition>()
  for (const agent of globalAgents) merged.set(agentKey(agent), agent)
  for (const agent of spaceAgents) merged.set(agentKey(agent), agent)
  return Array.from(merged.values())
}

function buildGlobalAgents(locale?: string): AgentDefinition[] {
  const sourceMode = getLockedConfigSourceMode()
  const agents: AgentDefinition[] = []
  const seenNames = new Set<string>()

  const addAgents = (newAgents: AgentDefinition[]): void => {
    for (const agent of newAgents) {
      const key = agentKey(agent)
      if (seenNames.has(key)) {
        const idx = agents.findIndex(a => agentKey(a) === key)
        if (idx >= 0) agents.splice(idx, 1)
      }
      agents.push(agent)
      seenNames.add(key)
    }
  }

  // 0. Enabled plugin agents (lowest priority)
  for (const plugin of listEnabledPlugins()) {
    addAgents(scanAgentDir(join(plugin.installPath, 'agents'), 'plugin', plugin.installPath, plugin.name, undefined, locale))
  }

  // 1. App-level agents ({locked-user-root}/agents/)
  addAgents(scanAgentDir(join(getLockedUserConfigRootDir(), 'agents'), 'app', undefined, undefined, undefined, locale))

  // 2. Kite mode only: global custom paths from config.claudeCode.agents.paths
  if (sourceMode === 'kite') {
    const globalPaths = getConfig().claudeCode?.agents?.paths || []
    for (const globalPath of globalPaths) {
      const resolvedPath = globalPath.startsWith('/')
        ? globalPath
        : join(require('os').homedir(), globalPath)
      addAgents(scanAgentDir(resolvedPath, 'global', undefined, undefined, undefined, locale))
    }
  }

  return agents
}

function buildSpaceAgents(workDir: string, locale?: string): AgentDefinition[] {
  return scanAgentDir(join(workDir, '.claude', 'agents'), 'space', undefined, undefined, workDir, locale)
}

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition | undefined {
  if (name.includes(':')) {
    const [namespace, agentName] = name.split(':', 2)
    return agents.find(a => a.name === agentName && a.namespace === namespace)
  }
  return agents.find(a => a.name === name && !a.namespace)
    ?? agents.find(a => a.name === name)
}

function findAgentByRef(agents: AgentDefinition[], ref: ResourceRef): AgentDefinition | undefined {
  if (ref.path) {
    const byPath = agents.find(agent => agent.path === ref.path)
    if (byPath) return byPath
  }

  return agents.find((agent) => {
    if (agent.name !== ref.name) return false
    if ((ref.namespace || undefined) !== (agent.namespace || undefined)) return false
    if (ref.source && agent.source !== ref.source) return false
    return true
  })
}

function logFound(label: string, items: AgentDefinition[], locale?: string): void {
  if (items.length > 0) {
    const localeSuffix = locale ? ` (locale: ${locale})` : ''
    console.log(`[Agents] Found ${items.length} ${label}${localeSuffix}: ${items.map(agentKey).join(', ')}`)
  }
}

/**
 * List all available agents from all sources
 */
function listAgentsUnfiltered(workDir?: string, locale?: string): AgentDefinition[] {
  const localeKey = toLocaleCacheKey(locale)
  let globalAgents = globalAgentsCacheByLocale.get(localeKey)
  if (!globalAgents) {
    globalAgents = buildGlobalAgents(locale)
    globalAgentsCacheByLocale.set(localeKey, globalAgents)
  }

  if (!workDir) {
    return globalAgents
  }

  let spaceCache = spaceAgentsCacheByLocale.get(workDir)
  if (!spaceCache) {
    spaceCache = new Map<string, AgentDefinition[]>()
    spaceAgentsCacheByLocale.set(workDir, spaceCache)
  }

  let spaceAgents = spaceCache.get(localeKey)
  if (!spaceAgents) {
    spaceAgents = buildSpaceAgents(workDir, locale)
    spaceCache.set(localeKey, spaceAgents)
  }

  const agents = mergeAgents(globalAgents, spaceAgents)
  return agents
}

export function listAgents(workDir: string | undefined, view: ResourceListView, locale?: string): AgentDefinition[] {
  const agents = filterByResourceExposure(listAgentsUnfiltered(workDir, locale), view)
  logFound('agents', agents, locale)
  return agents
}

export function listSpaceAgents(workDir: string): AgentDefinition[] {
  return listAgentsUnfiltered(workDir).filter(agent => agent.source === 'space')
}

function listAgentsForRefLookup(workDir: string): AgentDefinition[] {
  let globalAgents = globalAgentsCacheByLocale.get(DEFAULT_LOCALE_CACHE_KEY)
  if (!globalAgents) {
    globalAgents = buildGlobalAgents()
    globalAgentsCacheByLocale.set(DEFAULT_LOCALE_CACHE_KEY, globalAgents)
  }

  let spaceCache = spaceAgentsCacheByLocale.get(workDir)
  if (!spaceCache) {
    spaceCache = new Map<string, AgentDefinition[]>()
    spaceAgentsCacheByLocale.set(workDir, spaceCache)
  }

  let spaceAgents = spaceCache.get(DEFAULT_LOCALE_CACHE_KEY)
  if (!spaceAgents) {
    spaceAgents = buildSpaceAgents(workDir)
    spaceCache.set(DEFAULT_LOCALE_CACHE_KEY, spaceAgents)
  }

  // Keep source-distinct entries for by-ref copy lookup; do not merge by key.
  return [...spaceAgents, ...globalAgents]
}

/**
 * Get agent content by name
 */
export function getAgentContent(name: string, workDir?: string): string | null {
  const agent = findAgent(listAgentsUnfiltered(workDir), name)
  if (!agent) {
    console.warn(`[Agents] Agent not found: ${name}`)
    return null
  }

  try {
    let content = contentCache.get(agent.path, () => readFileSync(agent.path, 'utf-8'))
    if (agent.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, agent.pluginRoot)
    }
    return content
  } catch (error) {
    contentCache.clear(agent.path)
    if (isFileNotFoundError(error)) {
      console.debug(`[Agents] Agent file not found: ${name}`)
    } else {
      console.warn(`[Agents] Failed to read agent ${name}:`, error)
    }
    return null
  }
}

/**
 * Get agent definition by name
 */
export function getAgent(name: string, workDir?: string): AgentDefinition | null {
  return findAgent(listAgentsUnfiltered(workDir), name) ?? null
}

/**
 * Clear agents cache
 * Call this when agent files are modified
 */
export function clearAgentsCache(): void {
  globalAgentsCacheByLocale.clear()
  spaceAgentsCacheByLocale.clear()
  contentCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateAgentsCache(workDir?: string | null): void {
  if (!workDir) {
    globalAgentsCacheByLocale.clear()
    contentCache.clear()
    return
  }
  spaceAgentsCacheByLocale.delete(workDir)
  contentCache.clearForDir(workDir)
}

// ============================================
// Agent CRUD (space-level)
// ============================================

/**
 * Create a new agent in the space directory
 *
 * @param workDir - Workspace directory
 * @param name - Agent name (filename without .md)
 * @param content - Agent markdown content
 */
export function createAgent(workDir: string, name: string, content: string): AgentDefinition {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`Invalid agent name: ${name}`)
  }

  const agentDir = join(workDir, '.claude', 'agents')
  const agentPath = join(agentDir, `${name}.md`)

  mkdirSync(agentDir, { recursive: true })
  writeFileSync(agentPath, content, 'utf-8')
  invalidateAgentsCache(workDir)

  const metadata = parseResourceMetadata(content)
  const description = metadata.description
  const displayName = getLocalizedFrontmatterString(metadata.frontmatter, ['name', 'title'])
  const taxonomy = getSceneTaxonomy().config
  const exposure = resolveResourceExposure({
    type: 'agent',
    source: 'space',
    workDir,
    name,
    frontmatterExposure: getFrontmatterString(metadata.frontmatter, ['exposure'])
  })
  const sceneTags = resolveSceneTags({
    name,
    description,
    content,
    frontmatter: metadata.frontmatter,
    resourceKey: buildResourceSceneKey({
      type: 'agent',
      source: 'space',
      workDir,
      name
    }),
    definitions: taxonomy.definitions,
    resourceOverrides: taxonomy.resourceOverrides
  })

  return {
    name,
    path: agentPath,
    source: 'space',
    exposure,
    description,
    sceneTags,
    ...(displayName && { displayName })
  }
}

/**
 * Update an existing agent's content
 *
 * @param agentPath - Full path to the agent file
 * @param content - New markdown content
 */
export function updateAgent(agentPath: string, content: string): boolean {
  try {
    const allowedBases = getAllowedAgentBaseDirs()
    if (!isPathWithinBasePaths(agentPath, allowedBases)) {
      console.warn(`[Agents] Cannot update agent outside of space agents directory: ${agentPath}`)
      return false
    }

    if (!existsSync(agentPath)) {
      console.warn(`[Agents] Agent file not found: ${agentPath}`)
      return false
    }
    writeFileSync(agentPath, content, 'utf-8')
    const workDir = resolveWorkDirForAgentPath(agentPath)
    if (workDir) {
      invalidateAgentsCache(workDir)
    } else {
      clearAgentsCache()
    }
    return true
  } catch (error) {
    console.error('[Agents] Failed to update agent:', error)
    return false
  }
}

/**
 * Delete an agent
 *
 * @param agentPath - Full path to the agent file
 */
export function deleteAgent(agentPath: string): boolean {
  try {
    const allowedBases = getAllowedAgentBaseDirs()
    if (!isPathWithinBasePaths(agentPath, allowedBases)) {
      console.warn(`[Agents] Cannot delete agent outside of space agents directory: ${agentPath}`)
      return false
    }
    if (!existsSync(agentPath)) {
      console.warn(`[Agents] Agent file not found: ${agentPath}`)
      return false
    }
    rmSync(agentPath, { force: true })
    const workDir = resolveWorkDirForAgentPath(agentPath)
    if (workDir) {
      invalidateAgentsCache(workDir)
    } else {
      clearAgentsCache()
    }
    return true
  } catch (error) {
    console.error('[Agents] Failed to delete agent:', error)
    return false
  }
}

/**
 * Copy an agent to the space directory
 *
 * @param agentName - Agent name (without .md)
 * @param workDir - Target workspace directory
 */
export function copyAgentToSpace(agentName: string, workDir: string): AgentDefinition | null {
  const result = copyAgentToSpaceByRef({ type: 'agent', name: agentName }, workDir)
  return result.status === 'copied' ? (result.data ?? null) : null
}

export function copyAgentToSpaceByRef(
  ref: ResourceRef,
  workDir: string,
  options?: CopyToSpaceOptions
): CopyToSpaceResult<AgentDefinition> {
  const sourceAgent = findAgentByRef(listAgentsForRefLookup(workDir), ref)
  if (!sourceAgent) {
    console.warn(`[Agents] Source agent not found: ${ref.name}`)
    return { status: 'not_found' }
  }

  const targetDir = join(workDir, '.claude', 'agents')
  const targetPath = join(targetDir, `${sourceAgent.name}.md`)

  if (sourceAgent.source === 'space' && sourceAgent.path === targetPath) {
    return { status: 'copied', data: sourceAgent }
  }

  if (existsSync(targetPath) && !options?.overwrite) {
    return { status: 'conflict', existingPath: targetPath }
  }

  try {
    if (existsSync(targetPath) && options?.overwrite) {
      rmSync(targetPath, { force: true })
    }
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(sourceAgent.path, targetPath)
    invalidateAgentsCache(workDir)
    return {
      status: 'copied',
      data: { ...sourceAgent, path: targetPath, source: 'space' }
    }
  } catch (error) {
    console.error('[Agents] Failed to copy agent to space:', error)
    return { status: 'not_found', error: (error as Error).message }
  }
}
