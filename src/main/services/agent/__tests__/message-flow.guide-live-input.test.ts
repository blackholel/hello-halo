import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASK_USER_QUESTION_ERROR_CODES, type PendingAskUserQuestionContext, type SessionState } from '../types'
import { guideLiveInput, sendMessage } from '../message-flow.service'

const sessionManagerMocks = vi.hoisted(() => ({
  acquireSessionWithResumeFallback: vi.fn(),
  closeV2Session: vi.fn(),
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
  deleteActiveSession: vi.fn(),
  getV2SessionInfo: vi.fn(),
  getV2SessionConversationIds: vi.fn(() => []),
  getV2SessionsCount: vi.fn(() => 0),
  setSessionMode: vi.fn(),
  touchV2Session: vi.fn()
}))

const conversationServiceMocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  clearSessionId: vi.fn(),
  saveSessionId: vi.fn(),
  addMessage: vi.fn(),
  updateLastMessage: vi.fn(),
  insertUserMessageBeforeTrailingAssistant: vi.fn()
}))

const changeSetMocks = vi.hoisted(() => ({
  beginChangeSet: vi.fn(),
  clearPendingChangeSet: vi.fn(),
  finalizeChangeSet: vi.fn(),
  trackChangeFile: vi.fn()
}))

vi.mock('../session.manager', () => ({
  acquireSessionWithResumeFallback: sessionManagerMocks.acquireSessionWithResumeFallback,
  closeV2Session: sessionManagerMocks.closeV2Session,
  getActiveSession: sessionManagerMocks.getActiveSession,
  setActiveSession: sessionManagerMocks.setActiveSession,
  deleteActiveSession: sessionManagerMocks.deleteActiveSession,
  getV2SessionInfo: sessionManagerMocks.getV2SessionInfo,
  getV2SessionConversationIds: sessionManagerMocks.getV2SessionConversationIds,
  getV2SessionsCount: sessionManagerMocks.getV2SessionsCount,
  setSessionMode: sessionManagerMocks.setSessionMode,
  touchV2Session: sessionManagerMocks.touchV2Session
}))

vi.mock('../../conversation.service', () => ({
  getConversation: conversationServiceMocks.getConversation,
  clearSessionId: conversationServiceMocks.clearSessionId,
  saveSessionId: conversationServiceMocks.saveSessionId,
  addMessage: conversationServiceMocks.addMessage,
  updateLastMessage: conversationServiceMocks.updateLastMessage,
  insertUserMessageBeforeTrailingAssistant: conversationServiceMocks.insertUserMessageBeforeTrailingAssistant
}))

vi.mock('../../change-set.service', () => ({
  beginChangeSet: changeSetMocks.beginChangeSet,
  clearPendingChangeSet: changeSetMocks.clearPendingChangeSet,
  finalizeChangeSet: changeSetMocks.finalizeChangeSet,
  trackChangeFile: changeSetMocks.trackChangeFile
}))

vi.mock('../ai-setup-guard', () => ({
  assertAiProfileConfigured: vi.fn(() => {
    const error = new Error('AI profile not configured') as Error & { errorCode?: string }
    error.errorCode = 'AI_PROFILE_NOT_CONFIGURED'
    throw error
  })
}))

function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId: 'conv-1',
    runId: 'run-1',
    mode: 'code',
    startedAt: Date.now(),
    latestAssistantContent: '',
    lifecycle: 'running',
    terminalReason: null,
    terminalAt: null,
    finalized: false,
    toolCallSeq: 0,
    toolsById: new Map(),
    askUserQuestionModeByToolCallId: new Map(),
    pendingPermissionResolve: null,
    pendingAskUserQuestionsById: new Map(),
    pendingAskUserQuestionOrder: [],
    pendingAskUserQuestionIdByToolCallId: new Map(),
    unmatchedAskUserQuestionToolCalls: new Map(),
    askUserQuestionSeq: 0,
    recentlyResolvedAskUserQuestionByToolCallId: new Map(),
    askUserQuestionUsedInRun: false,
    textClarificationFallbackUsedInConversation: false,
    textClarificationDetectedInRun: false,
    thoughts: [],
    processTrace: [],
    ...overrides
  }
}

function createPending(
  pendingId: string,
  runId: string,
  resolve: (decision: unknown) => void,
  expectedToolCallId: string | null = 'tool-ask-1'
): PendingAskUserQuestionContext {
  return {
    pendingId,
    resolve: resolve as (decision: any) => void,
    inputSnapshot: {
      questions: [
        {
          id: 'q_1',
          question: 'Need input',
          options: [
            { label: 'A', description: 'A' },
            { label: 'B', description: 'B' }
          ]
        }
      ]
    },
    inputFingerprint: `fp-${pendingId}`,
    expectedToolCallId,
    runId,
    createdAt: Date.now(),
    status: 'awaiting_answer',
    mode: 'sdk_allow_updated_input'
  }
}

function registerPending(session: SessionState, pending: PendingAskUserQuestionContext): void {
  session.pendingAskUserQuestionsById.set(pending.pendingId, pending)
  session.pendingAskUserQuestionOrder.push(pending.pendingId)
  if (pending.expectedToolCallId) {
    session.pendingAskUserQuestionIdByToolCallId.set(pending.expectedToolCallId, pending.pendingId)
    session.askUserQuestionModeByToolCallId.set(pending.expectedToolCallId, pending.mode)
  }
}

describe('message-flow guideLiveInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionManagerMocks.setSessionMode.mockResolvedValue({ applied: false })
  })

  it('injects live update by session.send in running state without opening a new run', async () => {
    const send = vi.fn()
    const session = createSessionState()
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    const result = await guideLiveInput({
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '请立刻改成 B 方案'
    })

    expect(result.delivery).toBe('session_send')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toContain('<live-user-update>')
    expect(send.mock.calls[0]?.[0]).toContain('请立刻改成 B 方案')
    expect(conversationServiceMocks.insertUserMessageBeforeTrailingAssistant).toHaveBeenCalledTimes(1)
  })

  it('rejects when sdk session.send fails so renderer can show real failure feedback', async () => {
    const send = vi.fn().mockRejectedValue(new Error('transport write failed'))
    const session = createSessionState()
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    await expect(
      guideLiveInput({
        spaceId: 'space-1',
        conversationId: 'conv-1',
        message: 'please adjust current execution'
      })
    ).rejects.toThrow('transport write failed')
    expect(conversationServiceMocks.insertUserMessageBeforeTrailingAssistant).toHaveBeenCalledTimes(0)
  })

  it('auto-rejects pending tool approval before live injection', async () => {
    const send = vi.fn()
    const approvalResolver = vi.fn()
    const session = createSessionState({
      pendingPermissionResolve: approvalResolver
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    await guideLiveInput({
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '继续，但禁止执行这个工具'
    })

    expect(approvalResolver).toHaveBeenCalledWith(false)
    expect(session.pendingPermissionResolve).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('answers pending AskUserQuestion with updated input instead of session.send', async () => {
    const send = vi.fn()
    const resolvePending = vi.fn()
    const session = createSessionState({ runId: 'run-ask' })
    registerPending(session, createPending('pending-1', 'run-ask', resolvePending, 'tool-ask-1'))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    const result = await guideLiveInput({
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '把标题换成新版'
    })

    expect(result.delivery).toBe('ask_user_question_answer')
    expect(resolvePending).toHaveBeenCalledTimes(1)
    const decision = resolvePending.mock.calls[0]?.[0] as { behavior: string; updatedInput?: { answers?: Record<string, string> } }
    expect(decision.behavior).toBe('allow')
    expect(Object.values(decision.updatedInput?.answers || {})).toContain('把标题换成新版')
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('returns NO_ACTIVE_SESSION when active session is missing', async () => {
    sessionManagerMocks.getActiveSession.mockReturnValue(null)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue(null)

    await expect(
      guideLiveInput({
        spaceId: 'space-1',
        conversationId: 'conv-1',
        message: 'test'
      })
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.NO_ACTIVE_SESSION
    })
  })

  it('returns RUN_MISMATCH when provided runId differs from active run', async () => {
    const send = vi.fn()
    const session = createSessionState({ runId: 'run-active' })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    await expect(
      guideLiveInput({
        spaceId: 'space-1',
        conversationId: 'conv-1',
        message: 'should reject stale guide',
        runId: 'run-stale'
      } as any)
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.RUN_MISMATCH
    })
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('returns NO_ACTIVE_SESSION when lifecycle is not running', async () => {
    const send = vi.fn()
    const session = createSessionState({ lifecycle: 'terminal', terminalReason: 'completed' })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    await expect(
      guideLiveInput({
        spaceId: 'space-1',
        conversationId: 'conv-1',
        message: 'late guide'
      })
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.NO_ACTIVE_SESSION
    })
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('persists guided message using session.spaceId with guided meta', async () => {
    const send = vi.fn()
    const session = createSessionState({ spaceId: 'space-from-session', runId: 'run-keep' })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    await guideLiveInput({
      spaceId: 'space-from-request',
      conversationId: 'conv-1',
      message: 'persist with session scope',
      runId: 'run-keep',
      clientMessageId: 'client-guided-1'
    } as any)

    expect(conversationServiceMocks.insertUserMessageBeforeTrailingAssistant).toHaveBeenCalledWith(
      'space-from-session',
      'conv-1',
      expect.objectContaining({
        role: 'user',
        content: 'persist with session scope',
        guidedMeta: {
          runId: 'run-keep',
          clientMessageId: 'client-guided-1'
        }
      })
    )
  })

  it('falls back to session.send when AskUserQuestion answer path becomes unavailable', async () => {
    const send = vi.fn()
    const resolveOne = vi.fn()
    const resolveTwo = vi.fn()
    const session = createSessionState({ runId: 'run-race' })
    registerPending(session, createPending('pending-1', 'run-race', resolveOne, null))
    registerPending(session, createPending('pending-2', 'run-race', resolveTwo, null))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: { send } })

    const result = await guideLiveInput({
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: 'fallback please'
    })

    expect(result.delivery).toBe('session_send')
    expect(send).toHaveBeenCalledTimes(1)
    expect(resolveOne).toHaveBeenCalledTimes(0)
    expect(resolveTwo).toHaveBeenCalledTimes(0)
  })
})

describe('message-flow sendMessage space/conversation mismatch guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws SPACE_CONVERSATION_MISMATCH before creating session when conversation is missing', async () => {
    conversationServiceMocks.getConversation.mockReturnValueOnce(null)

    await expect(
      sendMessage(null, {
        spaceId: 'space-1',
        conversationId: 'conv-missing',
        message: 'test missing conversation'
      })
    ).rejects.toMatchObject({
      errorCode: 'SPACE_CONVERSATION_MISMATCH'
    })

    expect(sessionManagerMocks.setActiveSession).toHaveBeenCalledTimes(0)
    expect(changeSetMocks.beginChangeSet).toHaveBeenCalledTimes(0)
    expect(conversationServiceMocks.addMessage).toHaveBeenCalledTimes(0)
  })

  it('throws CONVERSATION_SPACE_MISMATCH before creating session when conversation belongs to another space', async () => {
    conversationServiceMocks.getConversation.mockReturnValueOnce({
      id: 'conv-wrong-space',
      spaceId: 'space-other'
    })

    await expect(
      sendMessage(null, {
        spaceId: 'space-1',
        conversationId: 'conv-wrong-space',
        message: 'test wrong mapping'
      })
    ).rejects.toMatchObject({
      errorCode: 'CONVERSATION_SPACE_MISMATCH'
    })

    expect(sessionManagerMocks.setActiveSession).toHaveBeenCalledTimes(0)
    expect(changeSetMocks.beginChangeSet).toHaveBeenCalledTimes(0)
    expect(conversationServiceMocks.addMessage).toHaveBeenCalledTimes(0)
  })
})
