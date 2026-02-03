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

import { join } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getConfig, getHaloDir } from './config.service'
import { getSpaceConfig } from './space-config.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath } from '../utils/path-validation'

// ============================================
// Agent Types
// ============================================

export interface AgentDefinition {
  name: string           // Agent name (filename without .md)
  path: string           // Full path to agent file
  source: 'app' | 'global' | 'space'  // Where the agent was loaded from
  description?: string   // First line of agent content (if available)
}

// Cache for agents list
let agentsCache: { agents: AgentDefinition[]; workDir: string | null; timestamp: number } | null = null
const CACHE_TTL_MS = 5000  // 5 seconds cache

/**
 * Validate agent path (not a symlink, is a directory)
 */
function isValidAgentDir(dirPath: string): boolean {
  return isValidDirectoryPath(dirPath, 'Agents')
}

function getAllowedAgentBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'agents'))
}

/**
 * Scan a directory for agent files (.md)
 */
function scanAgentDir(dirPath: string, source: AgentDefinition['source']): AgentDefinition[] {
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
          description
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

/**
 * List all available agents from all sources
 *
 * @param workDir - Optional workspace directory for space-level agents
 * @returns Array of agent definitions
 */
export function listAgents(workDir?: string): AgentDefinition[] {
  // Check cache
  if (agentsCache &&
      agentsCache.workDir === (workDir || null) &&
      Date.now() - agentsCache.timestamp < CACHE_TTL_MS) {
    return agentsCache.agents
  }

  const agents: AgentDefinition[] = []
  const seenNames = new Set<string>()
  const config = getConfig()

  // Helper to add agents without duplicates (later sources override earlier)
  const addAgents = (newAgents: AgentDefinition[]) => {
    for (const agent of newAgents) {
      // Remove existing agent with same name (later source wins)
      if (seenNames.has(agent.name)) {
        const idx = agents.findIndex(a => a.name === agent.name)
        if (idx >= 0) {
          agents.splice(idx, 1)
        }
      }
      agents.push(agent)
      seenNames.add(agent.name)
    }
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

  // 3. Space-level agents ({workDir}/.claude/agents/)
  if (workDir) {
    const spaceAgentsPath = join(workDir, '.claude', 'agents')
    addAgents(scanAgentDir(spaceAgentsPath, 'space'))
  }

  // Update cache
  agentsCache = {
    agents,
    workDir: workDir || null,
    timestamp: Date.now()
  }

  if (agents.length > 0) {
    console.log(`[Agents] Found ${agents.length} agents: ${agents.map(a => a.name).join(', ')}`)
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
  const agent = agents.find(a => a.name === name)

  if (!agent) {
    console.warn(`[Agents] Agent not found: ${name}`)
    return null
  }

  try {
    const content = readFileSync(agent.path, 'utf-8')
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
  return agents.find(a => a.name === name) || null
}

/**
 * Clear agents cache
 * Call this when agent files are modified
 */
export function clearAgentsCache(): void {
  agentsCache = null
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

  clearAgentsCache()

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
    clearAgentsCache()
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
    clearAgentsCache()
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
    clearAgentsCache()
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
