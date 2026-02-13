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

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildQuestionId(seed: string, index: number): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)

  return normalized ? `q_${normalized}` : `q_${index + 1}`
}

export function normalizeAskUserQuestionInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    const question = toNonEmptyString(input.question) || 'Please provide your choice.'
    return {
      questions: [
        {
          id: 'q_1',
          header: 'Question',
          question,
          options: [
            { label: 'Continue', description: 'Proceed with this option' },
            { label: 'Cancel', description: 'Stop and reconsider' }
          ]
        }
      ]
    }
  }

  const questions = rawQuestions
    .map((rawQuestion, questionIndex) => {
      if (!rawQuestion || typeof rawQuestion !== 'object') return null
      const record = rawQuestion as Record<string, unknown>

      const questionText =
        toNonEmptyString(record.question) ||
        toNonEmptyString(record.prompt) ||
        toNonEmptyString(record.message) ||
        toNonEmptyString(record.text) ||
        `Question ${questionIndex + 1}`

      const header = toNonEmptyString(record.header) || `Question ${questionIndex + 1}`
      const id =
        toNonEmptyString(record.id) ||
        buildQuestionId(toNonEmptyString(record.header) || questionText, questionIndex)

      const rawOptions = record.options || record.choices || record.selectOptions
      const options = Array.isArray(rawOptions)
        ? rawOptions
            .map((rawOption) => {
              if (typeof rawOption === 'string') {
                const label = rawOption.trim()
                if (!label) return null
                return {
                  label,
                  description: `Select ${label}`
                }
              }

              if (!rawOption || typeof rawOption !== 'object') return null
              const optionRecord = rawOption as Record<string, unknown>
              const label =
                toNonEmptyString(optionRecord.label) ||
                toNonEmptyString(optionRecord.text) ||
                toNonEmptyString(optionRecord.title) ||
                toNonEmptyString(optionRecord.value)
              if (!label) return null
              const description =
                toNonEmptyString(optionRecord.description) ||
                toNonEmptyString(optionRecord.desc) ||
                `Select ${label}`

              return { label, description }
            })
            .filter((option): option is { label: string; description: string } => option !== null)
        : []

      if (options.length === 0) {
        options.push(
          { label: 'Yes', description: 'Select Yes' },
          { label: 'No', description: 'Select No' }
        )
      }

      // Extract multiSelect field (supports both camelCase and snake_case)
      const multiSelect = record.multiSelect === true || record.multi_select === true

      return {
        id,
        header,
        question: questionText,
        options,
        multiSelect
      }
    })
    .filter((item): item is { id: string; header: string; question: string; options: Array<{ label: string; description: string }>; multiSelect: boolean } => item !== null)

  if (questions.length === 0) {
    return {
      questions: [
        {
          id: 'q_1',
          header: 'Question',
          question: 'Please provide your choice.',
          options: [
            { label: 'Continue', description: 'Proceed with this option' },
            { label: 'Cancel', description: 'Stop and reconsider' }
          ]
        }
      ]
    }
  }

  return { questions }
}

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

    if (toolName === 'AskUserQuestion') {
      // Wait for user response using session-specific resolver.
      // Tool-call UI is sent from message-flow with the real tool_use.id.
      const session = getActiveSession(conversationId)
      if (!session) {
        return { behavior: 'deny' as const, message: 'Session not found' }
      }

      if (session.pendingAskUserQuestionResolve) {
        return {
          behavior: 'deny' as const,
          message: 'Another AskUserQuestion is already pending'
        }
      }

        return new Promise((resolve) => {
          session.pendingAskUserQuestionResolve = (answer: string) => {
            // AskUserQuestion is handled by Halo UI; the actual answer is delivered
            // through session.send(answer) to avoid duplicate semantic channels.
            resolve({
              behavior: 'deny' as const,
              message: 'AskUserQuestion handled by Halo UI. Continue with the latest user message answer.'
            })
          }
        })
      }

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
        const session = getActiveSession(conversationId)
        if (!session) {
          return { behavior: 'deny' as const, message: 'Session not found' }
        }

        // Send permission request to renderer with session IDs
        const toolCallId = `tool-${session.runId}-${Date.now()}`
        const toolCall: ToolCall = {
          id: toolCallId,
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
          {
            runId: session.runId,
            toolCallId,
            ...(toolCall as unknown as Record<string, unknown>)
          }
        )

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
