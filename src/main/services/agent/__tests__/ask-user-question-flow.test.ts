import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAskUserQuestionResponse } from '../message-flow.service'
import type {
  PendingAskUserQuestionContext,
  SessionState
} from '../types'
import { ASK_USER_QUESTION_ERROR_CODES } from '../types'

const sessionManagerMocks = vi.hoisted(() => ({
  getOrCreateV2Session: vi.fn(),
  closeV2Session: vi.fn(),
  getActiveSession: vi.fn(),
  setActiveSession: vi.fn(),
  deleteActiveSession: vi.fn(),
  getV2SessionInfo: vi.fn(),
  getV2SessionsCount: vi.fn(() => 0)
}))

vi.mock('../session.manager', () => ({
  getOrCreateV2Session: sessionManagerMocks.getOrCreateV2Session,
  closeV2Session: sessionManagerMocks.closeV2Session,
  getActiveSession: sessionManagerMocks.getActiveSession,
  setActiveSession: sessionManagerMocks.setActiveSession,
  deleteActiveSession: sessionManagerMocks.deleteActiveSession,
  getV2SessionInfo: sessionManagerMocks.getV2SessionInfo,
  getV2SessionsCount: sessionManagerMocks.getV2SessionsCount
}))

function createPending(
  pendingId: string,
  toolCallId: string,
  runId: string,
  resolve: (decision: unknown) => void
): PendingAskUserQuestionContext {
  return {
    pendingId,
    resolve: resolve as (decision: any) => void,
    inputSnapshot: {
      questions: [
        {
          id: 'q_1',
          question: `Question ${pendingId}`,
          options: [
            { label: 'Yes', description: 'Yes option' },
            { label: 'No', description: 'No option' }
          ]
        }
      ]
    },
    inputFingerprint: `fingerprint-${pendingId}`,
    expectedToolCallId: toolCallId,
    runId,
    createdAt: Date.now(),
    status: 'awaiting_answer',
    mode: 'sdk_allow_updated_input'
  }
}

function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId: 'conv-1',
    runId: 'run-test',
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
    thoughts: [],
    processTrace: [],
    ...overrides
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

describe('AskUserQuestion Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })
  })

  it('routes answer by toolCallId when multiple pending questions exist', async () => {
    const resolveOne = vi.fn()
    const resolveTwo = vi.fn()
    const session = createSessionState({ runId: 'run-1' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-1', resolveOne))
    registerPending(session, createPending('aq_run_2', 'tool-2', 'run-1', resolveTwo))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    await handleAskUserQuestionResponse('conv-1', {
      runId: 'run-1',
      toolCallId: 'tool-2',
      answersByQuestionId: { q_1: ['Yes'] },
      skippedQuestionIds: []
    })

    expect(resolveTwo).toHaveBeenCalledTimes(1)
    expect(resolveOne).not.toHaveBeenCalled()
    expect(session.pendingAskUserQuestionOrder).toEqual(['aq_run_1'])
    expect(session.pendingAskUserQuestionIdByToolCallId.has('tool-2')).toBe(false)
  })

  it('requires toolCallId when multiple pending questions exist', async () => {
    const session = createSessionState({ runId: 'run-2' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-2', vi.fn()))
    registerPending(session, createPending('aq_run_2', 'tool-2', 'run-2', vi.fn()))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        runId: 'run-2',
        toolCallId: '',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.TOOLCALL_REQUIRED_MULTI_PENDING
    })
  })

  it('throws legacy-not-allowed when legacy string is used with multiple pending questions', async () => {
    const session = createSessionState({ runId: 'run-3' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-3', vi.fn()))
    registerPending(session, createPending('aq_run_2', 'tool-2', 'run-3', vi.fn()))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    await expect(
      handleAskUserQuestionResponse('conv-1', 'legacy answer')
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.LEGACY_NOT_ALLOWED
    })
  })

  it('throws run mismatch when payload runId differs from target pending run', async () => {
    const session = createSessionState({ runId: 'run-4' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-4', vi.fn()))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        runId: 'run-5',
        toolCallId: 'tool-1',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.RUN_MISMATCH
    })
  })

  it('treats duplicate submit on same toolCallId as idempotent success', async () => {
    const resolvePending = vi.fn()
    const session = createSessionState({ runId: 'run-6' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-6', resolvePending))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    const payload = {
      runId: 'run-6',
      toolCallId: 'tool-1',
      answersByQuestionId: { q_1: ['Yes'] },
      skippedQuestionIds: []
    } as const

    await handleAskUserQuestionResponse('conv-1', payload)
    await expect(handleAskUserQuestionResponse('conv-1', payload)).resolves.toBeUndefined()
    expect(resolvePending).toHaveBeenCalledTimes(1)
  })

  it('returns target-not-found when toolCallId is not mapped and not resolved', async () => {
    const session = createSessionState({ runId: 'run-7' })
    registerPending(session, createPending('aq_run_1', 'tool-1', 'run-7', vi.fn()))
    sessionManagerMocks.getActiveSession.mockReturnValue(session)

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        runId: 'run-7',
        toolCallId: 'tool-404',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toMatchObject({
      errorCode: ASK_USER_QUESTION_ERROR_CODES.TARGET_NOT_FOUND
    })
  })
})
