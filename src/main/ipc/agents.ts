/**
 * Agents IPC Handlers
 *
 * Handles IPC communication for agents management between renderer and main process.
 */

import { ipcMain } from 'electron'
import {
  listAgents,
  getAgentContent,
  clearAgentsCache,
  createAgent,
  updateAgent,
  deleteAgent,
  copyAgentToSpace
} from '../services/agents.service'

export function registerAgentsHandlers(): void {
  // List all available agents
  ipcMain.handle('agents:list', async (_event, workDir?: string) => {
    try {
      const agents = listAgents(workDir)
      return { success: true, data: agents }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get agent content by name
  ipcMain.handle('agents:get-content', async (_event, name: string, workDir?: string) => {
    try {
      const content = getAgentContent(name, workDir)
      if (!content) {
        return { success: false, error: `Agent not found: ${name}` }
      }
      return { success: true, data: content }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Clear agents cache
  ipcMain.handle('agents:clear-cache', async () => {
    try {
      clearAgentsCache()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Create a new agent in space directory
  ipcMain.handle('agents:create', async (_event, workDir: string, name: string, content: string) => {
    try {
      const agent = createAgent(workDir, name, content)
      return { success: true, data: agent }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update an existing agent
  ipcMain.handle('agents:update', async (_event, agentPath: string, content: string) => {
    try {
      const result = updateAgent(agentPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Delete an agent
  ipcMain.handle('agents:delete', async (_event, agentPath: string) => {
    try {
      const result = deleteAgent(agentPath)
      if (!result) {
        return { success: false, error: 'Failed to delete agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Copy agent to space
  ipcMain.handle('agents:copy-to-space', async (_event, agentName: string, workDir: string) => {
    try {
      const agent = copyAgentToSpace(agentName, workDir)
      if (!agent) {
        return { success: false, error: `Failed to copy agent: ${agentName}` }
      }
      return { success: true, data: agent }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
