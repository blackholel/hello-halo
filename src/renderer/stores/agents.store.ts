/**
 * Agents Store - Agents state management
 *
 * Manages the state of agents loaded from various sources:
 * - App-level agents (~/.halo/agents/)
 * - Global custom paths
 * - Space-level agents ({workDir}/.claude/agents/)
 */

import { create } from 'zustand'
import { api } from '../api'

// ============================================
// Types
// ============================================

export interface AgentDefinition {
  name: string
  path: string
  source: 'app' | 'global' | 'space'
  description?: string
}

export interface AgentContent {
  name: string
  content: string
}

interface AgentsState {
  // Data
  agents: AgentDefinition[]
  loadedWorkDir: string | null
  selectedAgent: AgentDefinition | null
  agentContent: AgentContent | null

  // UI State
  isLoading: boolean
  isLoadingContent: boolean
  searchQuery: string
  error: string | null

  // Actions
  loadAgents: (workDir?: string) => Promise<void>
  selectAgent: (agent: AgentDefinition | null) => void
  loadAgentContent: (name: string, workDir?: string) => Promise<AgentContent | null>
  setSearchQuery: (query: string) => void
  createAgent: (workDir: string, name: string, content: string) => Promise<AgentDefinition | null>
  updateAgent: (agentPath: string, content: string) => Promise<boolean>
  deleteAgent: (agentPath: string) => Promise<boolean>
  copyToSpace: (agentName: string, workDir: string) => Promise<AgentDefinition | null>
  clearCache: () => Promise<void>

  // Selectors
  getFilteredAgents: () => AgentDefinition[]
  getAgentsBySource: (source: AgentDefinition['source']) => AgentDefinition[]
  getAgentByName: (name: string) => AgentDefinition | undefined
}

// ============================================
// Store
// ============================================

export const useAgentsStore = create<AgentsState>((set, get) => ({
  // Initial state
  agents: [],
  loadedWorkDir: null,
  selectedAgent: null,
  agentContent: null,
  isLoading: false,
  isLoadingContent: false,
  searchQuery: '',
  error: null,

  // Load agents from all sources
  loadAgents: async (workDir?: string) => {
    try {
      set({ isLoading: true, error: null })

      const response = await api.listAgents(workDir)

      if (response.success && response.data) {
        set({
          agents: response.data as AgentDefinition[],
          loadedWorkDir: workDir ?? null
        })
      } else {
        set({ error: response.error || 'Failed to load agents' })
      }
    } catch (error) {
      console.error('[AgentsStore] Failed to load agents:', error)
      set({ error: 'Failed to load agents' })
    } finally {
      set({ isLoading: false })
    }
  },

  // Select an agent for viewing
  selectAgent: (agent) => {
    set({ selectedAgent: agent, agentContent: null })
  },

  // Load agent content (markdown)
  loadAgentContent: async (name, workDir) => {
    try {
      set({ isLoadingContent: true })

      const response = await api.getAgentContent(name, workDir)

      if (response.success && response.data) {
        const content = response.data as string
        const agentContent: AgentContent = { name, content }
        set({ agentContent })
        return agentContent
      }

      set({ error: response.error || 'Failed to load agent content' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to load agent content:', error)
      set({ error: 'Failed to load agent content' })
      return null
    } finally {
      set({ isLoadingContent: false })
    }
  },

  // Set search query for filtering
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  // Create a new agent in space directory
  createAgent: async (workDir, name, content) => {
    try {
      const response = await api.createAgent(workDir, name, content)

      if (response.success && response.data) {
        const newAgent = response.data as AgentDefinition
        set((state) => ({
          agents: [...state.agents, newAgent]
        }))
        return newAgent
      }

      set({ error: response.error || 'Failed to create agent' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to create agent:', error)
      set({ error: 'Failed to create agent' })
      return null
    }
  },

  // Update an existing agent
  updateAgent: async (agentPath, content) => {
    try {
      const response = await api.updateAgent(agentPath, content)
      if (response.success) {
        const { agents, selectedAgent, loadedWorkDir, loadAgentContent } = get()
        const agent = agents.find(a => a.path === agentPath)
        if (agent && selectedAgent?.path === agentPath) {
          await loadAgentContent(agent.name, loadedWorkDir ?? undefined)
        }
        return true
      }
      set({ error: response.error || 'Failed to update agent' })
      return false
    } catch (error) {
      console.error('[AgentsStore] Failed to update agent:', error)
      set({ error: 'Failed to update agent' })
      return false
    }
  },

  // Delete an agent
  deleteAgent: async (agentPath) => {
    try {
      const response = await api.deleteAgent(agentPath)
      if (response.success) {
        set((state) => ({
          agents: state.agents.filter(a => a.path !== agentPath),
          selectedAgent: state.selectedAgent?.path === agentPath ? null : state.selectedAgent,
          agentContent: state.selectedAgent?.path === agentPath ? null : state.agentContent
        }))
        return true
      }
      set({ error: response.error || 'Failed to delete agent' })
      return false
    } catch (error) {
      console.error('[AgentsStore] Failed to delete agent:', error)
      set({ error: 'Failed to delete agent' })
      return false
    }
  },

  // Copy agent to space
  copyToSpace: async (agentName, workDir) => {
    try {
      const response = await api.copyAgentToSpace(agentName, workDir)
      if (response.success && response.data) {
        const copiedAgent = response.data as AgentDefinition
        set((state) => ({
          agents: state.agents.map(a => a.name === agentName ? copiedAgent : a)
        }))
        return copiedAgent
      }
      set({ error: response.error || 'Failed to copy agent to space' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to copy agent to space:', error)
      set({ error: 'Failed to copy agent to space' })
      return null
    }
  },

  // Clear cache and reload
  clearCache: async () => {
    try {
      await api.clearAgentsCache()
    } catch (error) {
      console.error('[AgentsStore] Failed to clear cache:', error)
    }
  },

  // Get filtered agents
  getFilteredAgents: () => {
    const { agents, searchQuery } = get()
    if (!searchQuery.trim()) return agents

    const query = searchQuery.toLowerCase()
    return agents.filter(agent =>
      agent.name.toLowerCase().includes(query) ||
      agent.description?.toLowerCase().includes(query)
    )
  },

  // Get agents by source
  getAgentsBySource: (source) => {
    const { agents } = get()
    return agents.filter(a => a.source === source)
  },

  // Get agent by name
  getAgentByName: (name) => {
    const { agents } = get()
    return agents.find(a => a.name === name)
  }
}))

let agentsListenersInitialized = false

export function initAgentsStoreListeners(): void {
  if (agentsListenersInitialized) return
  agentsListenersInitialized = true

  api.onAgentsChanged((data) => {
    const payload = data as { workDir?: string | null }
    const { loadedWorkDir, loadAgents } = useAgentsStore.getState()
    if (payload.workDir == null || payload.workDir === loadedWorkDir) {
      loadAgents(loadedWorkDir ?? undefined)
    }
  })
}

export const selectAgents = (state: AgentsState) => state.agents
export const selectSelectedAgent = (state: AgentsState) => state.selectedAgent
export const selectAgentContent = (state: AgentsState) => state.agentContent
export const selectIsLoadingAgents = (state: AgentsState) => state.isLoading
export const selectAgentSearchQuery = (state: AgentsState) => state.searchQuery
export const selectAgentError = (state: AgentsState) => state.error
