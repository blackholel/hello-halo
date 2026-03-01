/**
 * Agent Controller - Unified business logic for agent operations
 * Used by both IPC handlers and HTTP routes
 */

import { BrowserWindow } from 'electron'
import {
  sendMessage as agentSendMessage,
  stopGeneration as agentStopGeneration,
  handleToolApproval as agentHandleToolApproval,
  handleAskUserQuestionResponse as agentHandleAskUserQuestionResponse,
  isGenerating,
  getActiveSessions,
  getSessionState as agentGetSessionState,
  testMcpConnections as agentTestMcpConnections
} from '../services/agent'
import type { AskUserQuestionAnswerInput } from '../services/agent'
import type { InvocationContext } from '../../shared/resource-access'

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
  aiBrowserEnabled?: boolean  // Enable AI Browser tools
  planEnabled?: boolean
  invocationContext?: InvocationContext
}

export interface ControllerResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  errorCode?: string
}

function toErrorResponse(error: unknown): ControllerResponse {
  const err = error as Error & { errorCode?: string }
  return {
    success: false,
    error: err?.message || String(error),
    errorCode: typeof err?.errorCode === 'string' ? err.errorCode : undefined
  }
}

/**
 * Send a message to the agent
 */
export async function sendMessage(
  mainWindow: BrowserWindow | null,
  request: SendMessageRequest
): Promise<ControllerResponse> {
  try {
    if (request.invocationContext && request.invocationContext !== 'interactive') {
      console.warn(
        `[AgentController] Ignoring non-interactive invocationContext from external request: ${request.invocationContext}`
      )
    }

    const normalizedModelOverride = request.modelOverride || request.model
    const normalizedRequest = normalizedModelOverride
      ? { ...request, modelOverride: normalizedModelOverride, invocationContext: 'interactive' as InvocationContext }
      : { ...request, invocationContext: 'interactive' as InvocationContext }
    await agentSendMessage(mainWindow, normalizedRequest)
    return { success: true }
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}

/**
 * Send workflow step message with server-derived invocation context.
 */
export async function sendWorkflowStepMessage(
  mainWindow: BrowserWindow | null,
  request: SendMessageRequest
): Promise<ControllerResponse> {
  try {
    const normalizedModelOverride = request.modelOverride || request.model
    const normalizedRequest = normalizedModelOverride
      ? { ...request, modelOverride: normalizedModelOverride, invocationContext: 'workflow-step' as InvocationContext }
      : { ...request, invocationContext: 'workflow-step' as InvocationContext }
    await agentSendMessage(mainWindow, normalizedRequest)
    return { success: true }
  } catch (error: unknown) {
    return toErrorResponse(error)
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
    return toErrorResponse(error)
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
    return toErrorResponse(error)
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
    return toErrorResponse(error)
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
    return toErrorResponse(error)
  }
}

/**
 * Check if a conversation is currently generating
 */
export function checkGenerating(conversationId: string): ControllerResponse<boolean> {
  try {
    return { success: true, data: isGenerating(conversationId) }
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}

/**
 * Get all active session conversation IDs
 */
export function listActiveSessions(): ControllerResponse<string[]> {
  try {
    return { success: true, data: getActiveSessions() }
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}

/**
 * Get current session state for recovery after refresh
 */
export function getSessionState(conversationId: string): ControllerResponse {
  try {
    return { success: true, data: agentGetSessionState(conversationId) }
  } catch (error: unknown) {
    return toErrorResponse(error)
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
    return toErrorResponse(error)
  }
}
