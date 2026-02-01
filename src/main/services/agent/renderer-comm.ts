/**
 * Renderer Communication
 *
 * Unified communication with renderer process and WebSocket clients.
 * Manages the mainWindow reference for IPC communication.
 */

import { BrowserWindow } from 'electron'
import { resolve } from 'path'
import { broadcastToWebSocket } from '../../http/websocket'
import { getConfig } from '../config.service'
import { isAIBrowserTool } from '../ai-browser'
import type { ToolCall, SessionState } from './types'

// Current main window reference for IPC communication
let currentMainWindow: BrowserWindow | null = null

/**
 * Set the main window reference
 */
export function setMainWindow(window: BrowserWindow | null): void {
  currentMainWindow = window
}

/**
 * Get the current main window reference
 */
export function getMainWindow(): BrowserWindow | null {
  return currentMainWindow
}

/**
 * Send event to renderer with session identifiers
 * Also broadcasts to WebSocket for remote clients
 */
export function sendToRenderer(
  channel: string,
  spaceId: string,
  conversationId: string,
  data: Record<string, unknown>
): void {
  // Always include spaceId and conversationId in event data
  const eventData = { ...data, spaceId, conversationId }

  // 1. Send to Electron renderer via IPC
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.send(channel, eventData)
    console.log(`[Agent] Sent to renderer: ${channel}`, JSON.stringify(eventData).substring(0, 200))
  }

  // 2. Broadcast to remote WebSocket clients
  try {
    broadcastToWebSocket(channel, eventData)
  } catch (error) {
    // WebSocket module might not be initialized yet, ignore
  }
}

/**
 * Create tool permission handler for a specific session
 */
export function createCanUseTool(
  workDir: string,
  spaceId: string,
  conversationId: string,
  getActiveSession: (convId: string) => SessionState | undefined
): (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<{
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}> {
  const config = getConfig()
  const absoluteWorkDir = resolve(workDir)

  console.log(`[Agent] Creating canUseTool with workDir: ${absoluteWorkDir}`)

  return async (
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal }
  ) => {
    console.log(
      `[Agent] canUseTool called - Tool: ${toolName}, Input:`,
      JSON.stringify(input).substring(0, 200)
    )

    // Check file path tools - restrict to working directory
    const fileTools = ['Read', 'Write', 'Edit', 'Grep', 'Glob']
    if (fileTools.includes(toolName)) {
      const pathParam = (input.file_path || input.path) as string | undefined

      if (pathParam) {
        const absolutePath = resolve(pathParam)
        const sep = require('path').sep
        const isWithinWorkDir =
          absolutePath.startsWith(absoluteWorkDir + sep) || absolutePath === absoluteWorkDir

        if (!isWithinWorkDir) {
          console.log(`[Agent] Security: Blocked access to: ${pathParam}`)
          return {
            behavior: 'deny' as const,
            message: `Can only access files within the current space: ${workDir}`
          }
        }
      }
    }

    // Check Bash commands based on permission settings
    if (toolName === 'Bash') {
      const permission = config.permissions.commandExecution

      if (permission === 'deny') {
        return {
          behavior: 'deny' as const,
          message: 'Command execution is disabled'
        }
      }

      if (permission === 'ask' && !config.permissions.trustMode) {
        // Send permission request to renderer with session IDs
        const toolCall: ToolCall = {
          id: `tool-${Date.now()}`,
          name: toolName,
          status: 'waiting_approval',
          input,
          requiresApproval: true,
          description: `Execute command: ${input.command}`
        }

        sendToRenderer(
          'agent:tool-call',
          spaceId,
          conversationId,
          toolCall as unknown as Record<string, unknown>
        )

        // Wait for user response using session-specific resolver
        const session = getActiveSession(conversationId)
        if (!session) {
          return { behavior: 'deny' as const, message: 'Session not found' }
        }

        return new Promise((resolve) => {
          session.pendingPermissionResolve = (approved: boolean) => {
            if (approved) {
              resolve({ behavior: 'allow' as const })
            } else {
              resolve({
                behavior: 'deny' as const,
                message: 'User rejected command execution'
              })
            }
          }
        })
      }
    }

    // AI Browser tools are always allowed (they run in sandboxed browser context)
    if (isAIBrowserTool(toolName)) {
      console.log(`[Agent] AI Browser tool allowed: ${toolName}`)
      return { behavior: 'allow' as const }
    }

    // Default: allow
    return { behavior: 'allow' as const }
  }
}
