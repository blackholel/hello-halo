/**
 * Agents Service - Manages Claude Code agents configuration
 *
 * Agents are loaded from multiple sources:
 * 1. ~/.halo/agents/ - Default app-level agents directory
 * 2. config.claudeCode.agents.paths - Custom global paths
 * 3. {workDir}/.claude/agents/ - Space-level agents (Claude Code compatible)
 *
 * Each agent is a markdown file (.md) containing agent instructions.
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getConfig, getHaloDir } from './config.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath } from '../utils/path-validation'
import { listEnabledPlugins } from './plugins.service'

// ============================================
// Agent Types
// ============================================

export interface AgentDefinition {
  name: string           // Agent name (filename without .md)
  path: string           // Full path to agent file
  source: 'app' | 'global' | 'space' | 'plugin'  // Where the agent was loaded from
  description?: string   // First line of agent content (if available)
  pluginRoot?: string    // Plugin root path (for plugin agents)
  namespace?: string     // Plugin namespace
}

// Cache for agents list (in-memory only)
let globalAgentsCache: AgentDefinition[] | null = null
const spaceAgentsCache = new Map<string, AgentDefinition[]>()

/**
 * Validate agent path (not a symlink, is a directory)
 */
function isValidAgentDir(dirPath: string): boolean {
  return isValidDirectoryPath(dirPath, 'Agents')
}

function getAllowedAgentBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'agents'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveWorkDirForAgentPath(agentPath: string): string | null {
  const normalizedPath = normalizePath(agentPath)
  const allowedBases = getAllowedAgentBaseDirs().map(normalizePath)
  for (const base of allowedBases) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

/**
 * Scan a directory for agent files (.md)
 */
function scanAgentDir(
  dirPath: string,
  source: AgentDefinition['source'],
  pluginRoot?: string,
  namespace?: string
): AgentDefinition[] {
  const agents: AgentDefinition[] = []

  if (!isValidAgentDir(dirPath)) {
    return agents
  }

  try {
    const files = readdirSync(dirPath)
    for (const file of files) {
      if (!file.endsWith('.md')) continue

      const filePath = join(dirPath, file)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue

        const name = file.slice(0, -3)  // Remove .md extension

        // Try to read first line for description
        let description: string | undefined
        try {
          const content = readFileSync(filePath, 'utf-8')
          const firstLine = content.split('\n')[0]?.trim()
          if (firstLine && !firstLine.startsWith('#')) {
            description = firstLine.slice(0, 100)  // Limit description length
          } else if (firstLine?.startsWith('# ')) {
            description = firstLine.slice(2).trim().slice(0, 100)
          }
        } catch {
          // Ignore read errors for description
        }

        agents.push({
          name,
          path: filePath,
          source,
          description,
          ...(pluginRoot ? { pluginRoot } : {}),
          ...(namespace ? { namespace } : {})
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
  const agentKey = (agent: AgentDefinition) =>
    agent.namespace ? `${agent.namespace}:${agent.name}` : agent.name
  for (const agent of globalAgents) {
    merged.set(agentKey(agent), agent)
  }
  for (const agent of spaceAgents) {
    merged.set(agentKey(agent), agent)
  }
  return Array.from(merged.values())
}

function buildGlobalAgents(): AgentDefinition[] {
  const agents: AgentDefinition[] = []
  const seenNames = new Set<string>()
  const config = getConfig()

  const addAgents = (newAgents: AgentDefinition[]) => {
    for (const agent of newAgents) {
      const key = agent.namespace ? `${agent.namespace}:${agent.name}` : agent.name
      if (seenNames.has(key)) {
        const idx = agents.findIndex(a => (a.namespace ? `${a.namespace}:${a.name}` : a.name) === key)
        if (idx >= 0) {
          agents.splice(idx, 1)
        }
      }
      agents.push(agent)
      seenNames.add(key)
    }
  }

  // 0. Enabled plugin agents (lowest priority)
  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    const pluginAgentsPath = join(plugin.installPath, 'agents')
    addAgents(scanAgentDir(pluginAgentsPath, 'plugin', plugin.installPath, plugin.name))
  }

  // 1. App-level agents (~/.halo/agents/)
  const haloDir = getHaloDir()
  if (haloDir) {
    const appAgentsPath = join(haloDir, 'agents')
    addAgents(scanAgentDir(appAgentsPath, 'app'))
  }

  // 2. Global custom paths from config.claudeCode.agents.paths
  const globalPaths = config.claudeCode?.agents?.paths || []
  for (const globalPath of globalPaths) {
    const resolvedPath = globalPath.startsWith('/')
      ? globalPath
      : join(require('os').homedir(), globalPath)
    addAgents(scanAgentDir(resolvedPath, 'global'))
  }

  return agents
}

function buildSpaceAgents(workDir: string): AgentDefinition[] {
  const spaceAgentsPath = join(workDir, '.claude', 'agents')
  return scanAgentDir(spaceAgentsPath, 'space')
}

/**
 * List all available agents from all sources
 *
 * @param workDir - Optional workspace directory for space-level agents
 * @returns Array of agent definitions
 */
export function listAgents(workDir?: string): AgentDefinition[] {
  const globalAgents = globalAgentsCache ?? buildGlobalAgents()
  if (!globalAgentsCache) {
    globalAgentsCache = globalAgents
  }

  if (!workDir) {
    if (globalAgents.length > 0) {
      console.log(
        `[Agents] Found ${globalAgents.length} agents: ${globalAgents
          .map(a => (a.namespace ? `${a.namespace}:${a.name}` : a.name))
          .join(', ')}`
      )
    }
    return globalAgents
  }

  let spaceAgents = spaceAgentsCache.get(workDir)
  if (!spaceAgents) {
    spaceAgents = buildSpaceAgents(workDir)
    spaceAgentsCache.set(workDir, spaceAgents)
  }

  const agents = mergeAgents(globalAgents, spaceAgents)
  if (agents.length > 0) {
    console.log(
      `[Agents] Found ${agents.length} agents: ${agents
        .map(a => (a.namespace ? `${a.namespace}:${a.name}` : a.name))
        .join(', ')}`
    )
  }

  return agents
}

/**
 * Get agent content by name
 *
 * @param name - Agent name (without .md extension)
 * @param workDir - Optional workspace directory for space-level agents
 * @returns Agent content or null if not found
 */
export function getAgentContent(name: string, workDir?: string): string | null {
  const agents = listAgents(workDir)
  let agent: AgentDefinition | undefined

  if (name.includes(':')) {
    const [namespace, agentName] = name.split(':', 2)
    agent = agents.find(a => a.name === agentName && a.namespace === namespace)
  } else {
    agent = agents.find(a => a.name === name && !a.namespace)
    if (!agent) {
      agent = agents.find(a => a.name === name)
    }
  }

  if (!agent) {
    console.warn(`[Agents] Agent not found: ${name}`)
    return null
  }

  try {
    let content = readFileSync(agent.path, 'utf-8')
    if (agent.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, agent.pluginRoot)
    }
    return content
  } catch (error) {
    console.error(`[Agents] Failed to read agent ${name}:`, error)
    return null
  }
}

/**
 * Get agent definition by name
 *
 * @param name - Agent name (without .md extension)
 * @param workDir - Optional workspace directory for space-level agents
 * @returns Agent definition or null if not found
 */
export function getAgent(name: string, workDir?: string): AgentDefinition | null {
  const agents = listAgents(workDir)
  if (name.includes(':')) {
    const [namespace, agentName] = name.split(':', 2)
    return agents.find(a => a.name === agentName && a.namespace === namespace) || null
  }
  return agents.find(a => a.name === name && !a.namespace) || agents.find(a => a.name === name) || null
}

/**
 * Clear agents cache
 * Call this when agent files are modified
 */
export function clearAgentsCache(): void {
  globalAgentsCache = null
  spaceAgentsCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateAgentsCache(workDir?: string | null): void {
  if (!workDir) {
    globalAgentsCache = null
    return
  }
  spaceAgentsCache.delete(workDir)
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

  const description = content.split('\n')[0]?.trim()
  return {
    name,
    path: agentPath,
    source: 'space',
    description: description?.startsWith('# ') ? description.slice(2).trim().slice(0, 100) : description?.slice(0, 100)
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
