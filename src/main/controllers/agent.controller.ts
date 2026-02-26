/**
 * Agent Controller - Unified business logic for agent operations
 * Used by both IPC handlers and HTTP routes
 */

import { BrowserWindow } from 'electron'
import {
  sendMessage as agentSendMessage,
  setAgentMode as agentSetMode,
  stopGeneration as agentStopGeneration,
  handleToolApproval as agentHandleToolApproval,
  handleAskUserQuestionResponse as agentHandleAskUserQuestionResponse,
  isGenerating,
  getActiveSessions,
  getSessionState as agentGetSessionState,
  testMcpConnections as agentTestMcpConnections
} from '../services/agent'
import type { AskUserQuestionAnswerInput, ChatMode } from '../services/agent'

// Image attachment type for multi-modal messages
interface ImageAttachment {
  id: string
  type: 'image'
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  data: string  // Base64 encoded
  name?: string
  size?: number
}

export interface SendMessageRequest {
  spaceId: string
  conversationId: string
  message: string
  resumeSessionId?: string
  modelOverride?: string
  model?: string
  images?: ImageAttachment[]  // Optional images for multi-modal messages
  thinkingEnabled?: boolean   // Enable extended thinking mode
  planEnabled?: boolean
  mode?: ChatMode
  aiBrowserEnabled?: boolean  // Enable AI Browser tools
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

export interface SetModeRequest {
  conversationId: string
  mode: ChatMode
  runId?: string
}

export interface ControllerResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Send a message to the agent
 */
export async function sendMessage(
  mainWindow: BrowserWindow | null,
  request: SendMessageRequest
): Promise<ControllerResponse> {
  try {
    const normalizedModelOverride = request.modelOverride || request.model
    const normalizedRequest = normalizedModelOverride
      ? { ...request, modelOverride: normalizedModelOverride }
      : request
    await agentSendMessage(mainWindow, normalizedRequest)
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

export async function setMode(request: SetModeRequest): Promise<ControllerResponse> {
  try {
    const result = await agentSetMode(request.conversationId, request.mode, request.runId)
    return { success: true, data: result }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Stop generation for a specific conversation or all
 */
export async function stopGeneration(conversationId?: string): Promise<ControllerResponse> {
  try {
    await agentStopGeneration(conversationId)
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Approve tool execution for a conversation
 */
export function approveTool(conversationId: string): ControllerResponse {
  try {
    agentHandleToolApproval(conversationId, true)
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Reject tool execution for a conversation
 */
export function rejectTool(conversationId: string): ControllerResponse {
  try {
    agentHandleToolApproval(conversationId, false)
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Answer AskUserQuestion tool for an active conversation
 */
export async function answerQuestion(
  conversationId: string,
  answer: AskUserQuestionAnswerInput
): Promise<ControllerResponse> {
  try {
    await agentHandleAskUserQuestionResponse(conversationId, answer)
    return { success: true }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Check if a conversation is currently generating
 */
export function checkGenerating(conversationId: string): ControllerResponse<boolean> {
  try {
    return { success: true, data: isGenerating(conversationId) }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Get all active session conversation IDs
 */
export function listActiveSessions(): ControllerResponse<string[]> {
  try {
    return { success: true, data: getActiveSessions() }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Get current session state for recovery after refresh
 */
export function getSessionState(conversationId: string): ControllerResponse {
  try {
    return { success: true, data: agentGetSessionState(conversationId) }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

/**
 * Test MCP server connections
 */
export async function testMcpConnections(mainWindow?: BrowserWindow | null): Promise<ControllerResponse> {
  try {
    const result = await agentTestMcpConnections(mainWindow)
    return result
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}
