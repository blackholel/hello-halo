/**
 * Workflow IPC Handlers
 */

import { ipcMain } from 'electron'
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow
} from '../services/workflow.service'

export function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:list', async (_event, spaceId: string) => {
    try {
      const workflows = listWorkflows(spaceId)
      return { success: true, data: workflows }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('workflow:get', async (_event, spaceId: string, workflowId: string) => {
    try {
      const workflow = getWorkflow(spaceId, workflowId)
      if (!workflow) {
        return { success: false, error: `Workflow not found: ${workflowId}` }
      }
      return { success: true, data: workflow }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('workflow:create', async (_event, spaceId: string, input) => {
    try {
      const workflow = createWorkflow(spaceId, input)
      return { success: true, data: workflow }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('workflow:update', async (_event, spaceId: string, workflowId: string, updates) => {
    try {
      const workflow = updateWorkflow(spaceId, workflowId, updates)
      if (!workflow) {
        return { success: false, error: 'Failed to update workflow' }
      }
      return { success: true, data: workflow }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('workflow:delete', async (_event, spaceId: string, workflowId: string) => {
    try {
      const result = deleteWorkflow(spaceId, workflowId)
      if (!result) {
        return { success: false, error: 'Failed to delete workflow' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
