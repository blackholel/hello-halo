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
    askUserQuestionModeByToolCallId: new Map(),
    pendingPermissionResolve: null,
    pendingAskUserQuestion: null,
    thoughts: [],
    ...overrides
  }
}

describe('AskUserQuestion Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when answer is empty', async () => {
    const session = createSessionState({
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [{ id: 'q_1', question: 'Pick one' }]
        },
        expectedToolCallId: null,
        runId: 'run-test',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(handleAskUserQuestionResponse('conv-1', '   ')).rejects.toThrow('Answer cannot be empty')
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

  it('resolves pending AskUserQuestion with allow + updatedInput', async () => {
    const resolvePendingQuestion = vi.fn<(decision: unknown) => void>()
    const send = vi.fn()
    const session = createSessionState({
      pendingAskUserQuestion: {
        resolve: resolvePendingQuestion,
        inputSnapshot: {
          questions: [
            {
              id: 'q_1',
              question: 'Pick one',
              options: [{ label: 'A', description: 'Option A' }]
            }
          ]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-test',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })

    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send }
    })

    await handleAskUserQuestionResponse('conv-1', {
      toolCallId: 'tool-ask-1',
      runId: 'run-test',
      answersByQuestionId: {
        q_1: ['option-a']
      },
      skippedQuestionIds: []
    })

    expect(resolvePendingQuestion).toHaveBeenCalledWith({
      behavior: 'allow',
      updatedInput: {
        questions: [
          {
            id: 'q_1',
            header: 'Question 1',
            question: 'Pick one',
            options: [{ label: 'A', description: 'Option A' }],
            multiSelect: false
          }
        ],
        answers: {
          'Pick one': 'option-a'
        },
        skippedQuestionIds: []
      }
    })
    expect(send).not.toHaveBeenCalled()
    expect(session.pendingAskUserQuestion).toBeNull()
  })

  it('throws when runId does not match pending AskUserQuestion run', async () => {
    const session = createSessionState({
      runId: 'run-a',
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [{ id: 'q_1', question: 'Pick one' }]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-a',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        toolCallId: 'tool-ask-1',
        runId: 'run-b',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toThrow('Run mismatch for AskUserQuestion response')
  })

  it('throws when runId is missing in structured AskUserQuestion payload', async () => {
    const session = createSessionState({
      runId: 'run-a',
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [{ id: 'q_1', question: 'Pick one' }]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-a',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        toolCallId: 'tool-ask-1',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toThrow('AskUserQuestion response must include runId')
  })

  it('throws when toolCallId does not match expected AskUserQuestion tool call', async () => {
    const session = createSessionState({
      runId: 'run-a',
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [{ id: 'q_1', question: 'Pick one' }]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-a',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        toolCallId: 'tool-ask-2',
        runId: 'run-a',
        answersByQuestionId: { q_1: ['Yes'] },
        skippedQuestionIds: []
      })
    ).rejects.toThrow('toolCallId mismatch for AskUserQuestion response')
  })

  it('throws when duplicate question text exists in AskUserQuestion snapshot', async () => {
    const session = createSessionState({
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [
            { id: 'q_1', question: 'Repeat?' },
            { id: 'q_2', question: 'Repeat?' }
          ]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-test',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(
      handleAskUserQuestionResponse('conv-1', {
        toolCallId: 'tool-ask-1',
        runId: 'run-test',
        answersByQuestionId: { q_1: ['A'], q_2: ['B'] },
        skippedQuestionIds: []
      })
    ).rejects.toThrow('Duplicate AskUserQuestion question text is not allowed')
  })

  it('converts multi-select answers to SDK question-text map with comma-joined values', async () => {
    const resolvePendingQuestion = vi.fn<(decision: unknown) => void>()
    const session = createSessionState({
      pendingAskUserQuestion: {
        resolve: resolvePendingQuestion,
        inputSnapshot: {
          questions: [
            { id: 'q_1', question: 'Pick colors' },
            { id: 'q_2', question: 'Pick one tool' }
          ]
        },
        expectedToolCallId: 'tool-ask-1',
        runId: 'run-test',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await handleAskUserQuestionResponse('conv-1', {
      toolCallId: 'tool-ask-1',
      runId: 'run-test',
      answersByQuestionId: {
        q_1: ['red', 'blue'],
        q_2: ['hammer']
      },
      skippedQuestionIds: []
    })

    expect(resolvePendingQuestion).toHaveBeenCalledWith({
      behavior: 'allow',
      updatedInput: {
        questions: [
          {
            id: 'q_1',
            header: 'Question 1',
            question: 'Pick colors',
            options: [
              { label: 'Yes', description: 'Select Yes' },
              { label: 'No', description: 'Select No' }
            ],
            multiSelect: false
          },
          {
            id: 'q_2',
            header: 'Question 2',
            question: 'Pick one tool',
            options: [
              { label: 'Yes', description: 'Select Yes' },
              { label: 'No', description: 'Select No' }
            ],
            multiSelect: false
          }
        ],
        answers: {
          'Pick colors': 'red, blue',
          'Pick one tool': 'hammer'
        },
        skippedQuestionIds: []
      }
    })
  })

  it('throws for legacy string answer when AskUserQuestion has multiple questions', async () => {
    const session = createSessionState({
      pendingAskUserQuestion: {
        resolve: vi.fn(),
        inputSnapshot: {
          questions: [
            { id: 'q_1', question: 'Question 1' },
            { id: 'q_2', question: 'Question 2' }
          ]
        },
        expectedToolCallId: null,
        runId: 'run-test',
        createdAt: Date.now(),
        mode: 'sdk_allow_updated_input'
      }
    })
    sessionManagerMocks.getActiveSession.mockReturnValue(session)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({
      session: { send: vi.fn() }
    })

    await expect(handleAskUserQuestionResponse('conv-1', 'legacy-answer')).rejects.toThrow(
      'Legacy answer string does not support multi-question AskUserQuestion. Please upgrade client.'
    )
  })
})
