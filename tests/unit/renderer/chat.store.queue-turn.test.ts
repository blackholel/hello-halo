import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCompleteEvent } from '../../../src/renderer/types'

const mockSendMessage = vi.fn()
const mockSendWorkflowStepMessage = vi.fn()
const mockGuideMessage = vi.fn()
const mockStopGeneration = vi.fn()
const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockDeleteConversation = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    sendWorkflowStepMessage: (...args: unknown[]) => mockSendWorkflowStepMessage(...args),
    guideMessage: (...args: unknown[]) => mockGuideMessage(...args),
    stopGeneration: (...args: unknown[]) => mockStopGeneration(...args),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    listChangeSets: (...args: unknown[]) => mockListChangeSets(...args),
    deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args)
  }
}))

vi.mock('../../../src/renderer/services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: () => false,
    getTabCount: () => 0,
    getTabs: () => [],
    getActiveTabId: () => null,
    getActiveTab: () => null
  }
}))

import { useChatStore } from '../../../src/renderer/stores/chat.store'

function seedConversation(spaceId: string, conversationId: string): void {
  const now = new Date().toISOString()
  useChatStore.setState({
    currentSpaceId: spaceId,
    spaceStates: new Map([
      [
        spaceId,
        {
          conversations: [
            {
              id: conversationId,
              spaceId,
              title: 'Queue Test',
              createdAt: now,
              updatedAt: now,
              messageCount: 0,
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
          spaceId,
          title: 'Queue Test',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: []
        }
      ]
    ])
  })
}

describe('Chat Store - queued turn flow', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockSendMessage.mockReset()
    mockSendWorkflowStepMessage.mockReset()
    mockGuideMessage.mockReset()
    mockStopGeneration.mockReset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockDeleteConversation.mockReset()

    mockSendMessage.mockResolvedValue({ success: true })
    mockSendWorkflowStepMessage.mockResolvedValue({ success: true })
    mockGuideMessage.mockResolvedValue({ success: true, data: { delivery: 'session_send' } })
    mockStopGeneration.mockResolvedValue({ success: true })
    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockDeleteConversation.mockResolvedValue({ success: true })
  })

  it('queues turn while generating and flushes on terminal complete', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-basic'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-1',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'queued message',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-1',
      reason: 'completed'
    } as AgentCompleteEvent)

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('does not flush when pending AskUserQuestion exists', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-pending-ask'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-ask',
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId,
      conversationId,
      runId: 'run-ask',
      id: 'tool-ask-1',
      name: 'AskUserQuestion',
      status: 'waiting_approval',
      input: { question: 'Need answer?' }
    } as any)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'message after ask pending',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-ask',
      reason: 'completed'
    } as AgentCompleteEvent)

    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
  })

  it('queues when generation stopped but AskUserQuestion is still pending', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-pending-after-complete'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-pending-after-complete',
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId,
      conversationId,
      runId: 'run-pending-after-complete',
      id: 'tool-ask-2',
      name: 'AskUserQuestion',
      status: 'waiting_approval',
      input: { question: 'Need answer first?' }
    } as any)

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-pending-after-complete',
      reason: 'completed'
    } as AgentCompleteEvent)

    const session = useChatStore.getState().sessions.get(conversationId)
    expect(session?.isGenerating).toBe(false)
    expect(session?.askUserQuestionOrder.length).toBe(1)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'must stay queued',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
  })

  it('keeps head in queue when request returns success:false', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-fail'
    seedConversation(spaceId, conversationId)

    mockSendMessage.mockResolvedValueOnce({ success: false, error: 'transport denied' })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'will fail',
      aiBrowserEnabled: true,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
    expect(useChatStore.getState().getQueueError(conversationId)).toContain('transport denied')
  })

  it('uses queued aiBrowserEnabled snapshot during flush', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-ai-browser-snapshot'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-snapshot',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'snapshot message',
      aiBrowserEnabled: true,
      mode: 'code'
    })

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-snapshot',
      reason: 'completed'
    } as AgentCompleteEvent)

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ aiBrowserEnabled: true })
    )
  })

  it('flushes queued turn after stopGeneration if gate is open', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-stop'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-stop',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'queued before stop',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    await useChatStore.getState().stopGeneration(conversationId)

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('flushes queued turn after stopGeneration even when approval gate was pending', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-stop-pending-approval'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-stop-approval',
      startedAt: new Date().toISOString()
    })

    useChatStore.getState().handleAgentToolCall({
      spaceId,
      conversationId,
      runId: 'run-stop-approval',
      id: 'tool-approval-1',
      name: 'WriteFile',
      status: 'waiting_approval',
      requiresApproval: true,
      input: {}
    } as any)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'queued before stop with approval pending',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    await useChatStore.getState().stopGeneration(conversationId)

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('waits for async reload completion before flushing queue in handleAgentComplete', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-reload-order'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-reload-order',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'queued while running',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    let resolveConversationReload: ((value: { success: false }) => void) | null = null
    mockGetConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConversationReload = resolve as (value: { success: false }) => void
        })
    )
    mockListChangeSets.mockResolvedValueOnce({ success: false })

    const completePromise = useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-reload-order',
      reason: 'completed'
    } as AgentCompleteEvent)

    await Promise.resolve()
    expect(mockSendMessage).toHaveBeenCalledTimes(0)

    resolveConversationReload?.({ success: false })
    await completePromise

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('prevents queue flush reentry with queueDispatching guard', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-dispatching-guard'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-dispatching-guard',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'queued once',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    useChatStore.setState((state) => {
      const sessions = new Map(state.sessions)
      const current = sessions.get(conversationId)
      if (!current) return {}
      sessions.set(conversationId, {
        ...current,
        isGenerating: false,
        isStreaming: false,
        isThinking: false
      })
      return { sessions }
    })

    let resolveSend: ((value: { success: true }) => void) | null = null
    mockSendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve as (value: { success: true }) => void
        })
    )

    const flushA = useChatStore.getState().flushQueuedTurns(conversationId, 'submit')
    const flushB = useChatStore.getState().flushQueuedTurns(conversationId, 'submit')

    await Promise.resolve()
    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    resolveSend?.({ success: true })
    await Promise.all([flushA, flushB])
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('dispatches guided turn immediately during running state', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-guide-while-running'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-while-running',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'guided later',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const guidedTurnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(guidedTurnId).toBeTruthy()

    const sendResult = await useChatStore.getState().sendQueuedTurn(conversationId, guidedTurnId as string)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
    expect(mockGuideMessage).toHaveBeenCalledTimes(1)
    expect(mockGuideMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        spaceId,
        conversationId,
        message: 'guided later',
        runId: 'run-guide-while-running',
        clientMessageId: expect.any(String)
      })
    )
    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    const conversation = useChatStore.getState().conversationCache.get(conversationId)
    expect(conversation?.messages[conversation.messages.length - 1]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: 'guided later',
        guidedMeta: {
          runId: 'run-guide-while-running'
        }
      })
    )
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
    expect((useChatStore.getState().queuedTurnsByConversation.get(conversationId) || []).length).toBe(0)
    expect(sendResult).toEqual(
      expect.objectContaining({
        accepted: true,
        guided: true,
        fallbackToNewRun: false,
        delivery: 'session_send'
      })
    )
  })

  it('restores queue head when guided dispatch fails', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-fail-restore'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-fail',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'guide failed item',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()

    mockGuideMessage.mockResolvedValueOnce({ success: false, error: 'guide failed' })
    const sendResult = await useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)

    expect(mockGuideMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
    expect(useChatStore.getState().getQueuedTurns(conversationId)[0]?.id).toBe(turnId)
    expect(useChatStore.getState().getQueueError(conversationId)).toContain('guide failed')
    expect(sendResult).toEqual(
      expect.objectContaining({
        accepted: false,
        guided: false,
        fallbackToNewRun: false
      })
    )
  })

  it('does not restore in-flight queued turn after user clears queue', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-fail-after-clear'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-fail-after-clear',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'clear while guiding',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()

    let resolveGuide: ((value: { success: false; error: string }) => void) | null = null
    mockGuideMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGuide = resolve as (value: { success: false; error: string }) => void
        })
    )

    const sending = useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)
    await Promise.resolve()

    useChatStore.getState().clearConversationQueue(conversationId)
    resolveGuide?.({ success: false, error: 'guide failed after clear' })
    await sending

    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
  })

  it('falls back to opening a new run when guided dispatch reports no active session', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-fallback-new-run'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-fallback',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'fallback new run',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()

    mockGuideMessage.mockResolvedValueOnce({
      success: false,
      error: 'No active session found',
      errorCode: 'ASK_USER_QUESTION_NO_ACTIVE_SESSION'
    })
    mockSendMessage.mockResolvedValueOnce({ success: true })

    const sendResult = await useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)

    expect(mockGuideMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
    expect(sendResult).toEqual(
      expect.objectContaining({
        accepted: true,
        guided: false,
        fallbackToNewRun: true
      })
    )
  })

  it('falls back to opening a new run when guided dispatch reports run mismatch', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-fallback-run-mismatch'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-mismatch',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'fallback mismatch',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()

    mockGuideMessage.mockResolvedValueOnce({
      success: false,
      error: 'Run mismatch',
      errorCode: 'ASK_USER_QUESTION_RUN_MISMATCH'
    })
    mockSendMessage.mockResolvedValueOnce({ success: true })

    const sendResult = await useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)

    expect(mockGuideMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
    expect(sendResult).toEqual(
      expect.objectContaining({
        accepted: true,
        guided: false,
        fallbackToNewRun: true
      })
    )
  })

  it('keeps original queue order when guided dispatch fails for a middle item', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-fail-middle-order'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-middle-order',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'first queued',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'second queued',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'third queued',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const queueBefore = useChatStore.getState().getQueuedTurns(conversationId)
    expect(queueBefore).toHaveLength(3)
    const middleTurnId = queueBefore[1]?.id
    expect(middleTurnId).toBeTruthy()

    mockGuideMessage.mockResolvedValueOnce({ success: false, error: 'middle failed' })
    await useChatStore.getState().sendQueuedTurn(conversationId, middleTurnId as string)

    const queueAfter = useChatStore.getState().getQueuedTurns(conversationId)
    expect(queueAfter).toHaveLength(3)
    expect(queueAfter.map((item) => item.id)).toEqual(queueBefore.map((item) => item.id))
  })

  it('keeps attachment guided turn queued with explicit error', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-guide-attachments'
    seedConversation(spaceId, conversationId)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-guide-attachments',
      startedAt: new Date().toISOString()
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'has image',
      images: [
        {
          id: 'img-1',
          type: 'image',
          mediaType: 'image/png',
          data: 'fake-base64'
        }
      ],
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()

    await useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)

    expect(mockGuideMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
    expect(useChatStore.getState().getQueueError(conversationId)).toMatch(/text only|仅支持文本/i)
  })

  it('dispatches queued turn via normal send when gate is open', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-queue-guide-idle'
    seedConversation(spaceId, conversationId)

    mockSendMessage.mockResolvedValueOnce({ success: false, error: 'first send failed' })
    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'retry-by-guide',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    const turnId = useChatStore.getState().getQueuedTurns(conversationId)[0]?.id
    expect(turnId).toBeTruthy()
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)

    mockSendMessage.mockResolvedValueOnce({ success: true })
    await useChatStore.getState().sendQueuedTurn(conversationId, turnId as string)

    expect(mockSendMessage).toHaveBeenCalledTimes(2)
    expect(mockGuideMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(0)
    expect((useChatStore.getState().queuedTurnsByConversation.get(conversationId) || []).length).toBe(0)
  })

  it('clears queue on deleteConversation/reset/resetSpace', async () => {
    const spaceId = 'space-1'
    const conversationA = 'conv-a'
    const conversationB = 'conv-b'
    const now = new Date().toISOString()

    useChatStore.setState({
      currentSpaceId: spaceId,
      spaceStates: new Map([
        [
          spaceId,
          {
            conversations: [
              { id: conversationA, spaceId, title: 'A', createdAt: now, updatedAt: now, messageCount: 0, preview: '' },
              { id: conversationB, spaceId, title: 'B', createdAt: now, updatedAt: now, messageCount: 0, preview: '' }
            ],
            currentConversationId: conversationA
          }
        ]
      ])
    })

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId: conversationA,
      runId: 'run-a',
      startedAt: now
    })
    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId: conversationB,
      runId: 'run-b',
      startedAt: now
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId: conversationA,
      content: 'queued A',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId: conversationB,
      content: 'queued B',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(useChatStore.getState().getQueueCount(conversationA)).toBe(1)
    expect(useChatStore.getState().getQueueCount(conversationB)).toBe(1)

    await useChatStore.getState().deleteConversation(spaceId, conversationA)
    expect(mockDeleteConversation).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueCount(conversationA)).toBe(0)

    useChatStore.getState().resetSpace(spaceId)
    expect(useChatStore.getState().getQueueCount(conversationB)).toBe(0)

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId: conversationA,
      runId: 'run-a2',
      startedAt: now
    })

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId: conversationA,
      content: 'queued A2',
      aiBrowserEnabled: false,
      mode: 'code'
    })
    expect(useChatStore.getState().getQueueCount(conversationA)).toBe(1)

    useChatStore.getState().reset()
    expect(useChatStore.getState().getQueueCount(conversationA)).toBe(0)
  })
})
