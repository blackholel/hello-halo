import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../types'

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

import { handleAskUserQuestionResponse } from '../message-flow.service'

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
    pendingPermissionResolve: null,
    pendingAskUserQuestionResolve: null,
    thoughts: [],
    ...overrides
  }
}

describe('AskUserQuestion Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when answer is empty', async () => {
    await expect(handleAskUserQuestionResponse('conv-1', '   ')).rejects.toThrow(
      'Answer cannot be empty'
    )
  })

  it('throws when no pending AskUserQuestion resolver exists', async () => {
    const send = vi.fn()

    sessionManagerMocks.getActiveSession.mockReturnValue(createSessionState())
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send }
    })

    await expect(handleAskUserQuestionResponse('conv-1', 'yes')).rejects.toThrow(
      'No pending AskUserQuestion found for this conversation'
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('resolves pending AskUserQuestion and forwards trimmed answer to session.send', async () => {
    const resolvePendingQuestion = vi.fn()
    const send = vi.fn()
    const session = createSessionState({
      pendingAskUserQuestionResolve: resolvePendingQuestion
    })

    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send }
    })

    await handleAskUserQuestionResponse('conv-1', '  option-a  ')

    expect(resolvePendingQuestion).toHaveBeenCalledWith('option-a')
    expect(send).toHaveBeenCalledWith('option-a')
    expect(session.pendingAskUserQuestionResolve).toBeNull()
  })
})
