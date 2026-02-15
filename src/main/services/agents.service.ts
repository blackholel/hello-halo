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
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'
import { FileCache } from '../utils/file-cache'

// ============================================
// Agent Types
// ============================================

export interface AgentDefinition {
  name: string
  path: string
  source: 'app' | 'global' | 'space' | 'plugin'
  description?: string
  pluginRoot?: string
  namespace?: string
}

// Cache for agents list (in-memory only)
let globalAgentsCache: AgentDefinition[] | null = null
const spaceAgentsCache = new Map<string, AgentDefinition[]>()
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

function resolveWorkDirForAgentPath(agentPath: string): string | null {
  const normalizedPath = normalizePath(agentPath)
  for (const base of getAllowedAgentBaseDirs().map(normalizePath)) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
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

function scanAgentDir(
  dirPath: string,
  source: AgentDefinition['source'],
  pluginRoot?: string,
  namespace?: string
): AgentDefinition[] {
  if (!isValidDirectoryPath(dirPath, 'Agents')) return []

  const agents: AgentDefinition[] = []
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.md')) continue
      const filePath = join(dirPath, file)
      try {
        if (!statSync(filePath).isFile()) continue
        agents.push({
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

function buildGlobalAgents(): AgentDefinition[] {
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
    addAgents(scanAgentDir(join(plugin.installPath, 'agents'), 'plugin', plugin.installPath, plugin.name))
  }

  // 1. App-level agents ({locked-user-root}/agents/)
  addAgents(scanAgentDir(join(getLockedUserConfigRootDir(), 'agents'), 'app'))

  // 2. Kite mode only: global custom paths from config.claudeCode.agents.paths
  if (sourceMode === 'kite') {
    const globalPaths = getConfig().claudeCode?.agents?.paths || []
    for (const globalPath of globalPaths) {
      const resolvedPath = globalPath.startsWith('/')
        ? globalPath
        : join(require('os').homedir(), globalPath)
      addAgents(scanAgentDir(resolvedPath, 'global'))
    }
  }

  return agents
}

function buildSpaceAgents(workDir: string): AgentDefinition[] {
  return scanAgentDir(join(workDir, '.claude', 'agents'), 'space')
}

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition | undefined {
  if (name.includes(':')) {
    const [namespace, agentName] = name.split(':', 2)
    return agents.find(a => a.name === agentName && a.namespace === namespace)
  }
  return agents.find(a => a.name === name && !a.namespace)
    ?? agents.find(a => a.name === name)
}

function logFound(label: string, items: AgentDefinition[]): void {
  if (items.length > 0) {
    console.log(`[Agents] Found ${items.length} ${label}: ${items.map(agentKey).join(', ')}`)
  }
}

/**
 * List all available agents from all sources
 */
export function listAgents(workDir?: string): AgentDefinition[] {
  if (!globalAgentsCache) {
    globalAgentsCache = buildGlobalAgents()
  }

  if (!workDir) {
    logFound('agents', globalAgentsCache)
    return globalAgentsCache
  }

  let spaceAgents = spaceAgentsCache.get(workDir)
  if (!spaceAgents) {
    spaceAgents = buildSpaceAgents(workDir)
    spaceAgentsCache.set(workDir, spaceAgents)
  }

  const agents = mergeAgents(globalAgentsCache, spaceAgents)
  logFound('agents', agents)
  return agents
}

/**
 * Get agent content by name
 */
export function getAgentContent(name: string, workDir?: string): string | null {
  const agent = findAgent(listAgents(workDir), name)
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
  return findAgent(listAgents(workDir), name) ?? null
}

/**
 * Clear agents cache
 * Call this when agent files are modified
 */
export function clearAgentsCache(): void {
  globalAgentsCache = null
  spaceAgentsCache.clear()
  contentCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateAgentsCache(workDir?: string | null): void {
  if (!workDir) {
    globalAgentsCache = null
    contentCache.clear()
    return
  }
  spaceAgentsCache.delete(workDir)
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

  const firstLine = content.split('\n')[0]?.trim()
  const description = firstLine?.startsWith('# ')
    ? firstLine.slice(2).trim().slice(0, 100)
    : firstLine?.slice(0, 100)

  return { name, path: agentPath, source: 'space', description }
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
    const normalizedPath = agentPath.replace(/\\/g, '/')
    if (!normalizedPath.includes('/agents/') && !normalizedPath.includes('/.claude/agents/')) {
      console.warn(`[Agents] Cannot delete agent outside of agents directory: ${agentPath}`)
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
  const agents = listAgents(workDir)
  const sourceAgent = agents.find(a => a.name === agentName)

  if (!sourceAgent) {
    console.warn(`[Agents] Source agent not found: ${agentName}`)
    return null
  }

  if (sourceAgent.source === 'space') {
    console.warn(`[Agents] Agent already in space: ${agentName}`)
    return sourceAgent
  }

  try {
    const targetDir = join(workDir, '.claude', 'agents')
    const targetPath = join(targetDir, `${agentName}.md`)
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(sourceAgent.path, targetPath)
    invalidateAgentsCache(workDir)
    return {
      ...sourceAgent,
      path: targetPath,
      source: 'space'
    }
  } catch (error) {
    console.error('[Agents] Failed to copy agent to space:', error)
    return null
  }
}
