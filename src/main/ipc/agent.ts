/**
 * Agent IPC Handlers
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  sendMessage,
  stopGeneration,
  handleToolApproval,
  handleAskUserQuestionResponse,
  getSessionState,
  ensureSessionWarm,
  testMcpConnections,
  reconnectMcpServer,
  toggleMcpServer
} from '../services/agent'
import type { AskUserQuestionAnswerInput } from '../services/agent'

let mainWindow: BrowserWindow | null = null

export function registerAgentHandlers(window: BrowserWindow | null): void {
  mainWindow = window

  // Send message to agent (with optional images for multi-modal, optional thinking mode)
  ipcMain.handle(
    'agent:send-message',
    async (
      _event,
      request: {
        spaceId: string
        conversationId: string
        message: string
        resumeSessionId?: string
        modelOverride?: string
        model?: string
        images?: Array<{
          id: string
          type: 'image'
          mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          data: string
          name?: string
          size?: number
        }>
        thinkingEnabled?: boolean  // Enable extended thinking mode
        planEnabled?: boolean  // Enable plan mode (no tool execution)
        aiBrowserEnabled?: boolean  // Enable AI Browser tools
        canvasContext?: {
          isOpen: boolean
          tabCount: number
          activeTab: { type: string; title: string; url?: string; path?: string } | null
          tabs: Array<{ type: string; title: string; url?: string; path?: string; isActive: boolean }>
        }
        fileContexts?: Array<{  // File contexts for context injection
          id: string
          type: 'file-context'
          path: string
          name: string
          extension: string
        }>
      }
    ) => {
      try {
        const normalizedModelOverride = request.modelOverride || request.model
        const normalizedRequest = normalizedModelOverride
          ? { ...request, modelOverride: normalizedModelOverride }
          : request
        await sendMessage(mainWindow, normalizedRequest)
        return { success: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Stop generation for a specific conversation (or all if not specified)
  ipcMain.handle('agent:stop', async (_event, conversationId?: string) => {
    try {
      await stopGeneration(conversationId)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Approve tool execution for a specific conversation
  ipcMain.handle('agent:approve-tool', async (_event, conversationId: string) => {
    try {
      handleToolApproval(conversationId, true)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Reject tool execution for a specific conversation
  ipcMain.handle('agent:reject-tool', async (_event, conversationId: string) => {
    try {
      handleToolApproval(conversationId, false)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Answer AskUserQuestion for a specific conversation
  ipcMain.handle('agent:answer-question', async (_event, conversationId: string, answer: AskUserQuestionAnswerInput) => {
    try {
      await handleAskUserQuestionResponse(conversationId, answer)
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get current session state for recovery after refresh
  ipcMain.handle('agent:get-session-state', async (_event, conversationId: string) => {
    try {
      const state = getSessionState(conversationId)
      return { success: true, data: state }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Warm up V2 session - call when switching conversations to prepare for faster message sending
  ipcMain.handle('agent:ensure-session-warm', async (_event, spaceId: string, conversationId: string) => {
    try {
      // Async initialization, non-blocking IPC call
      ensureSessionWarm(spaceId, conversationId).catch((error: unknown) => {
        console.error('[IPC] ensureSessionWarm error:', error)
      })
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Test MCP server connections
  ipcMain.handle('agent:test-mcp', async () => {
    try {
      const result = await testMcpConnections(mainWindow)
      return result
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, servers: [], error: err.message }
    }
  })

  // Reconnect a failed MCP server
  ipcMain.handle('agent:reconnect-mcp', async (_event, conversationId: string, serverName: string) => {
    try {
      const result = await reconnectMcpServer(conversationId, serverName)
      return result
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Toggle (enable/disable) an MCP server
  ipcMain.handle('agent:toggle-mcp', async (_event, conversationId: string, serverName: string, enabled: boolean) => {
    try {
      const result = await toggleMcpServer(conversationId, serverName, enabled)
      return result
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
