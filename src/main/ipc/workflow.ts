/**
 * Workflow IPC Handlers
 */

import { BrowserWindow, ipcMain } from 'electron'
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow
} from '../services/workflow.service'
import { sendMessage } from '../services/agent'
import type { InvocationContext } from '../../shared/resource-access'

interface WorkflowStepSendRequest {
  spaceId: string
  conversationId: string
  message: string
  resumeSessionId?: string
  modelOverride?: string
  model?: string
  thinkingEnabled?: boolean
  aiBrowserEnabled?: boolean
  planEnabled?: boolean
  images?: Array<{
    id: string
    type: 'image'
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
    name?: string
    size?: number
  }>
  canvasContext?: {
    isOpen: boolean
    tabCount: number
    activeTab: { type: string; title: string; url?: string; path?: string } | null
    tabs: Array<{ type: string; title: string; url?: string; path?: string; isActive: boolean }>
  }
  fileContexts?: Array<{
    id: string
    type: 'file-context'
    path: string
    name: string
    extension: string
  }>
}

export function registerWorkflowHandlers(mainWindow: BrowserWindow | null): void {
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

  ipcMain.handle('workflow:send-step-message', async (_event, request: WorkflowStepSendRequest) => {
    try {
      const normalizedModelOverride = request.modelOverride || request.model
      const normalizedRequest = normalizedModelOverride
        ? { ...request, modelOverride: normalizedModelOverride, invocationContext: 'workflow-step' as InvocationContext }
        : { ...request, invocationContext: 'workflow-step' as InvocationContext }
      await sendMessage(mainWindow, normalizedRequest)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
