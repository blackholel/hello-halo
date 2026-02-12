import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCall } from '../../types'

const mockAnswerQuestion = vi.fn()

vi.mock('../../api', () => ({
  api: {
    answerQuestion: (...args: unknown[]) => mockAnswerQuestion(...args)
  }
}))

vi.mock('../../services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: () => false,
    getTabCount: () => 0,
    getTabs: () => [],
    getActiveTabId: () => null,
    getActiveTab: () => null
  }
}))

import { useChatStore } from '../chat.store'

function seedPendingAskUserQuestion(conversationId: string, toolCallId = 'tool-ask-1'): void {
  useChatStore.getState().handleAgentToolCall({
    spaceId: 'space-1',
    conversationId,
    id: toolCallId,
    name: 'AskUserQuestion',
    status: 'waiting_approval',
    input: {
      question: 'Pick an option'
    }
  } as unknown as { conversationId: string } & ToolCall)
}

describe('Chat Store - AskUserQuestion Flow', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockAnswerQuestion.mockReset()
  })

  it('clears pending and failed question on successful answer', async () => {
    const conversationId = 'conv-success'
    seedPendingAskUserQuestion(conversationId)

    mockAnswerQuestion.mockResolvedValue({ success: true })
    await useChatStore.getState().answerQuestion(conversationId, 'Yes')

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.pendingAskUserQuestion).toBeNull()
    expect(session.failedAskUserQuestion).toBeNull()
  })

  it('moves pending question to failed state when API returns success:false', async () => {
    const conversationId = 'conv-semantic-fail'
    seedPendingAskUserQuestion(conversationId)

    const sessionsBefore = new Map(useChatStore.getState().sessions)
    const currentSession = sessionsBefore.get(conversationId)
    if (!currentSession) {
      throw new Error('Test setup failed: session missing')
    }
    sessionsBefore.set(conversationId, {
      ...currentSession,
      isGenerating: true,
      isStreaming: true
    })
    useChatStore.setState({ sessions: sessionsBefore })

    mockAnswerQuestion.mockResolvedValue({ success: false, error: 'No active session found' })
    await useChatStore.getState().answerQuestion(conversationId, 'Yes')

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.pendingAskUserQuestion).toBeNull()
    expect(session.failedAskUserQuestion?.status).toBe('error')
    expect(session.failedAskUserQuestion?.error).toBe('No active session found')
    expect(session.isGenerating).toBe(false)
    expect(session.isStreaming).toBe(false)
  })

  it('keeps pending question and rethrows on transport error', async () => {
    const conversationId = 'conv-transport-fail'
    seedPendingAskUserQuestion(conversationId, 'tool-transport')

    mockAnswerQuestion.mockRejectedValue(new Error('Network unavailable'))

    await expect(
      useChatStore.getState().answerQuestion(conversationId, 'Yes')
    ).rejects.toThrow('Network unavailable')

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.pendingAskUserQuestion?.id).toBe('tool-transport')
    expect(session.failedAskUserQuestion).toBeNull()
  })

  it('updates pending AskUserQuestion state from matching tool_result', () => {
    const conversationId = 'conv-tool-result'
    seedPendingAskUserQuestion(conversationId, 'tool-match')

    useChatStore.getState().handleAgentToolResult({
      spaceId: 'space-1',
      conversationId,
      toolId: 'tool-match',
      result: 'Tool failed',
      isError: true
    })

    let session = useChatStore.getState().getSession(conversationId)
    expect(session.pendingAskUserQuestion).toBeNull()
    expect(session.failedAskUserQuestion?.status).toBe('error')
    expect(session.failedAskUserQuestion?.error).toBe('Tool failed')

    seedPendingAskUserQuestion(conversationId, 'tool-match-success')
    useChatStore.getState().handleAgentToolResult({
      spaceId: 'space-1',
      conversationId,
      toolId: 'tool-match-success',
      result: 'ok',
      isError: false
    })

    session = useChatStore.getState().getSession(conversationId)
    expect(session.pendingAskUserQuestion).toBeNull()
    expect(session.failedAskUserQuestion).toBeNull()
  })
})
