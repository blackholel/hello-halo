import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventBase, AskUserQuestionAnswerPayload, ToolCall } from '../../types'

const mockAnswerQuestion = vi.fn()
const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockStopGeneration = vi.fn()

vi.mock('../../api', () => ({
  api: {
    answerQuestion: (...args: unknown[]) => mockAnswerQuestion(...args),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    listChangeSets: (...args: unknown[]) => mockListChangeSets(...args),
    stopGeneration: (...args: unknown[]) => mockStopGeneration(...args)
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
  } as unknown as AgentEventBase & ToolCall)
}

function createAskUserQuestionPayload(toolCallId = 'tool-ask-1'): AskUserQuestionAnswerPayload {
  return {
    toolCallId,
    answersByQuestionId: {
      q_1: ['Yes']
    },
    skippedQuestionIds: []
  }
}

function getAskUserQuestionByStatus(
  conversationId: string,
  status: 'pending' | 'failed'
): ToolCall | null {
  const session = useChatStore.getState().getSession(conversationId)
  const activeId = session.activeAskUserQuestionId
  if (activeId) {
    const activeItem = session.askUserQuestionsById[activeId]
    if (activeItem?.status === status) {
      return activeItem.toolCall
    }
  }

  for (const id of session.askUserQuestionOrder) {
    const item = session.askUserQuestionsById[id]
    if (item?.status === status) {
      return item.toolCall
    }
  }

  return null
}

describe('Chat Store - AskUserQuestion Flow', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockAnswerQuestion.mockReset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockStopGeneration.mockReset()
    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockStopGeneration.mockResolvedValue({ success: true })
  })

  it('clears pending and failed question on successful answer', async () => {
    const conversationId = 'conv-success'
    seedPendingAskUserQuestion(conversationId)

    mockAnswerQuestion.mockResolvedValue({ success: true })
    await useChatStore.getState().answerQuestion(conversationId, createAskUserQuestionPayload())
    expect(mockAnswerQuestion).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        toolCallId: 'tool-ask-1',
        answersByQuestionId: { q_1: ['Yes'] }
      })
    )

    const session = useChatStore.getState().getSession(conversationId)
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(getAskUserQuestionByStatus(conversationId, 'failed')).toBeNull()
    expect(session.askUserQuestionOrder).toEqual([])
  })

  it('injects active runId into AskUserQuestion answer payload', async () => {
    const conversationId = 'conv-with-run'
    const runId = 'run-ask-1'
    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })
    seedPendingAskUserQuestion(conversationId, 'tool-run-aware')

    mockAnswerQuestion.mockResolvedValue({ success: true })
    await useChatStore.getState().answerQuestion(conversationId, {
      toolCallId: 'tool-run-aware',
      answersByQuestionId: { q_1: ['Yes'] },
      skippedQuestionIds: []
    })

    expect(mockAnswerQuestion).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        toolCallId: 'tool-run-aware',
        runId
      })
    )
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
    await useChatStore.getState().answerQuestion(conversationId, createAskUserQuestionPayload())

    const session = useChatStore.getState().getSession(conversationId)
    const failedAskUserQuestion = getAskUserQuestionByStatus(conversationId, 'failed')
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(failedAskUserQuestion?.status).toBe('error')
    expect(failedAskUserQuestion?.error).toBe('No active session found')
    expect(session.isGenerating).toBe(false)
    expect(session.isStreaming).toBe(false)
  })

  it('keeps pending question and rethrows on transport error', async () => {
    const conversationId = 'conv-transport-fail'
    seedPendingAskUserQuestion(conversationId, 'tool-transport')

    mockAnswerQuestion.mockRejectedValue(new Error('Network unavailable'))

    await expect(
      useChatStore.getState().answerQuestion(
        conversationId,
        createAskUserQuestionPayload('tool-transport')
      )
    ).rejects.toThrow('Network unavailable')

    const pendingAskUserQuestion = getAskUserQuestionByStatus(conversationId, 'pending')
    expect(pendingAskUserQuestion?.id).toBe('tool-transport')
    expect(getAskUserQuestionByStatus(conversationId, 'failed')).toBeNull()
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
    const failedAskUserQuestion = getAskUserQuestionByStatus(conversationId, 'failed')
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(failedAskUserQuestion?.status).toBe('error')
    expect(failedAskUserQuestion?.error).toBe('Tool failed')

    seedPendingAskUserQuestion(conversationId, 'tool-match-success')
    useChatStore.getState().handleAgentToolResult({
      spaceId: 'space-1',
      conversationId,
      toolId: 'tool-match-success',
      result: 'ok',
      isError: false
    })

    session = useChatStore.getState().getSession(conversationId)
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(getAskUserQuestionByStatus(conversationId, 'failed')).toBeNull()
    expect(session.askUserQuestionOrder).toEqual([])
  })

  it('handles out-of-order tool_result before tool_call and converges status', () => {
    const conversationId = 'conv-out-of-order'
    const runId = 'run-ooo'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolResult({
      spaceId: 'space-1',
      conversationId,
      runId,
      toolCallId: 'tool-1',
      result: 'ok',
      isError: false
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId: 'space-1',
      conversationId,
      runId,
      id: 'tool-1',
      name: 'Read',
      status: 'running',
      input: { file_path: '/tmp/a.txt' }
    } as unknown as AgentEventBase & ToolCall)

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.toolStatusById['tool-1']).toBe('success')
    expect(session.orphanToolResults['tool-1']).toBeUndefined()
  })

  it('does not reopen AskUserQuestion pending state when terminal result arrived first', () => {
    const conversationId = 'conv-out-of-order-ask'
    const runId = 'run-ooo-ask'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolResult({
      spaceId: 'space-1',
      conversationId,
      runId,
      toolCallId: 'tool-ask',
      result: 'User answered: option-a',
      isError: false
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId: 'space-1',
      conversationId,
      runId,
      id: 'tool-ask',
      name: 'AskUserQuestion',
      status: 'waiting_approval',
      input: {
        question: 'Pick one',
        options: ['A', 'B']
      }
    } as unknown as AgentEventBase & ToolCall)

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.toolStatusById['tool-ask']).toBe('success')
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(getAskUserQuestionByStatus(conversationId, 'failed')).toBeNull()
  })

  it('drops stale events from previous run after new run starts', () => {
    const conversationId = 'conv-multi-run'
    const runA = 'run-a'
    const runB = 'run-b'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId: runA,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId: runB,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentThought({
      spaceId: 'space-1',
      conversationId,
      runId: runA,
      thought: {
        id: 'stale-thought',
        type: 'thinking',
        content: 'old',
        timestamp: new Date().toISOString()
      }
    })

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.activeRunId).toBe(runB)
    expect(session.thoughts.find(t => t.id === 'stale-thought')).toBeUndefined()
  })

  it('terminal completion cancels remaining running tools and closes generating state', async () => {
    const conversationId = 'conv-terminal'
    const runId = 'run-terminal'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId: 'space-1',
      conversationId,
      runId,
      id: 'tool-running',
      name: 'Edit',
      status: 'running',
      input: { file_path: '/tmp/a.txt' }
    } as unknown as AgentEventBase & ToolCall)

    await useChatStore.getState().handleAgentComplete({
      spaceId: 'space-1',
      conversationId,
      runId,
      reason: 'stopped'
    })

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.isGenerating).toBe(false)
    expect(session.isThinking).toBe(false)
    expect(session.toolStatusById['tool-running']).toBe('cancelled')
    expect(session.lifecycle).toBe('stopped')
  })

  it('ignores late thought after stop and keeps terminal state', async () => {
    const conversationId = 'conv-stop-late'
    const runId = 'run-stop-late'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().stopGeneration(conversationId)

    useChatStore.getState().handleAgentThought({
      spaceId: 'space-1',
      conversationId,
      runId,
      thought: {
        id: 'late-thought',
        type: 'thinking',
        content: 'late',
        timestamp: new Date().toISOString()
      }
    })

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.isGenerating).toBe(false)
    expect(session.lifecycle).toBe('stopped')
    expect(session.thoughts.find(t => t.id === 'late-thought')).toBeUndefined()
  })

  it('closes generation on no_text terminal event', async () => {
    const conversationId = 'conv-no-text'
    const runId = 'run-no-text'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().handleAgentComplete({
      spaceId: 'space-1',
      conversationId,
      runId,
      reason: 'no_text'
    })

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.isGenerating).toBe(false)
    expect(session.lifecycle).toBe('completed')
    expect(session.terminalReason).toBe('no_text')
  })

  it('supports AskUserQuestion state machine via agent:process tool_call/tool_result', () => {
    const conversationId = 'conv-process-ask'
    const runId = 'run-process-ask'

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentProcess({
      type: 'process',
      spaceId: 'space-1',
      conversationId,
      runId,
      kind: 'tool_call',
      payload: {
        toolCallId: 'tool-ask-process',
        id: 'tool-ask-process',
        name: 'AskUserQuestion',
        status: 'waiting_approval',
        input: {
          question: 'Pick one'
        }
      }
    })

    let session = useChatStore.getState().getSession(conversationId)
    expect(getAskUserQuestionByStatus(conversationId, 'pending')?.id).toBe('tool-ask-process')

    useChatStore.getState().handleAgentProcess({
      type: 'process',
      spaceId: 'space-1',
      conversationId,
      runId,
      kind: 'tool_result',
      payload: {
        toolCallId: 'tool-ask-process',
        result: 'ok',
        isError: false
      }
    })

    session = useChatStore.getState().getSession(conversationId)
    expect(getAskUserQuestionByStatus(conversationId, 'pending')).toBeNull()
    expect(getAskUserQuestionByStatus(conversationId, 'failed')).toBeNull()
    expect(session.askUserQuestionOrder).toEqual([])
  })

  it('uses complete.finalContent as fallback when conversation reload fails', async () => {
    const conversationId = 'conv-final-content-fallback'
    const runId = 'run-final-content-fallback'
    const finalContent = 'final answer from complete fallback'
    const now = new Date().toISOString()

    useChatStore.setState({
      currentSpaceId: 'space-1',
      spaceStates: new Map([
        [
          'space-1',
          {
            conversations: [
              {
                id: conversationId,
                spaceId: 'space-1',
                title: 'Fallback',
                createdAt: now,
                updatedAt: now,
                messageCount: 2,
                preview: ''
              }
            ],
            currentConversationId: conversationId
          }
        ]
      ]),
      conversationCache: new Map([
        [
          conversationId,
          {
            id: conversationId,
            spaceId: 'space-1',
            title: 'Fallback',
            createdAt: now,
            updatedAt: now,
            messageCount: 2,
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'question',
                timestamp: now
              },
              {
                id: 'assistant-1',
                role: 'assistant',
                content: '',
                timestamp: now
              }
            ]
          }
        ]
      ])
    })

    useChatStore.getState().handleAgentRunStart({
      spaceId: 'space-1',
      conversationId,
      runId,
      startedAt: now
    })

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId: 'space-1',
      conversationId,
      runId,
      reason: 'completed',
      finalContent
    })

    const cachedConversation = useChatStore.getState().getCachedConversation(conversationId)
    const lastMessage = cachedConversation?.messages[cachedConversation.messages.length - 1]
    expect(lastMessage?.role).toBe('assistant')
    expect(lastMessage?.content).toBe(finalContent)

    const session = useChatStore.getState().getSession(conversationId)
    expect(session.isGenerating).toBe(false)
    expect(session.isStreaming).toBe(false)
  })
})
