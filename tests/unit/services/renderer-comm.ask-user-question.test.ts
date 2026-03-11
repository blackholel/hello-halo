import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionState } from '../../../src/main/services/agent/types'

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    permissions: {
      commandExecution: 'allow',
      trustMode: true
    }
  }))
}))

vi.mock('../../../src/main/services/ai-browser', () => ({
  isAIBrowserTool: vi.fn((toolName: string) => toolName.startsWith('browser_'))
}))

vi.mock('../../../src/main/http/websocket', () => ({
  broadcastToWebSocket: vi.fn()
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../../src/main/services/agent/space-resource-policy.service', () => ({
  getExecutionLayerAllowedSources: vi.fn(() => ['app', 'global', 'space', 'installed', 'plugin']),
  getSpaceResourcePolicy: vi.fn(() => ({
    version: 1,
    mode: 'strict-space-only',
    allowedSources: ['app', 'global', 'space', 'installed', 'plugin']
  })),
  isStrictSpaceOnlyPolicy: vi.fn((policy: { mode: string }) => policy.mode === 'strict-space-only')
}))

import {
  createCanUseTool,
  normalizeAskUserQuestionInput
} from '../../../src/main/services/agent/renderer-comm'

function createSession(mode: 'plan' | 'code' = 'plan'): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId: 'conversation-1',
    runId: 'run-1',
    mode,
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
    processTrace: []
  }
}

function createPlanHandler(session: SessionState) {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => session,
    { mode: 'plan' }
  )
}

function createCodeHandler(session: SessionState) {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => session,
    { mode: 'code' }
  )
}

describe('renderer-comm AskUserQuestion priority + plan whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plan mode allows read-only tools and blocks write/execute/browser tools', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)
    const signal = { signal: new AbortController().signal }

    const readInput = { file_path: 'README.md' }
    const readResult = await canUseTool('Read', readInput, signal)
    expect(readResult).toMatchObject({
      behavior: 'allow',
      updatedInput: readInput
    })

    const grepInput = { pattern: 'TODO', path: '.' }
    const grepResult = await canUseTool('Grep', grepInput, signal)
    expect(grepResult).toMatchObject({
      behavior: 'allow',
      updatedInput: grepInput
    })

    const globInput = { pattern: '**/*.ts' }
    const globResult = await canUseTool('Glob', globInput, signal)
    expect(globResult).toMatchObject({
      behavior: 'allow',
      updatedInput: globInput
    })

    const deniedWrite = await canUseTool('Write', { file_path: 'README.md', content: 'x' }, signal)
    expect(deniedWrite.behavior).toBe('deny')
    expect(deniedWrite.message).toContain('PLAN mode only allows')

    const deniedBash = await canUseTool('Bash', { command: 'echo hello' }, signal)
    expect(deniedBash.behavior).toBe('deny')
    expect(deniedBash.message).toContain('PLAN mode only allows')

    const deniedBrowser = await canUseTool('browser_navigate', { url: 'https://example.com' }, signal)
    expect(deniedBrowser.behavior).toBe('deny')
    expect(deniedBrowser.message).toContain('PLAN mode only allows')
  })

  it('code mode allows browser tools and keeps passthrough updatedInput', async () => {
    const session = createSession('code')
    const canUseTool = createCodeHandler(session)
    const input = { url: 'https://example.com' }
    const decision = await canUseTool('browser_navigate', input, {
      signal: new AbortController().signal
    })

    expect(decision).toMatchObject({
      behavior: 'allow',
      updatedInput: input
    })
  })

  it('plan mode task is allowed with exploration-only prompt guard', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)
    const decision = await canUseTool(
      'Task',
      {
        description: 'Inspect relevant modules',
        prompt: 'Find how mode switching works.'
      },
      { signal: new AbortController().signal }
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.updatedInput).toBeDefined()
    expect(typeof decision.updatedInput?.prompt).toBe('string')
    expect(String(decision.updatedInput?.prompt)).toContain('PLAN MODE sub-agent policy')
    expect(String(decision.updatedInput?.prompt)).toContain('Find how mode switching works.')
    expect(decision.updatedInput?.subagent_type).toBe('explorer')
  })

  it('plan mode AskUserQuestion creates pending context and resolves via updated input path', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)

    const pendingDecisionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            id: 'q_1',
            question: 'Which mode do you prefer?',
            options: [{ label: 'Plan', description: 'Keep plan mode' }]
          }
        ]
      },
      { signal: new AbortController().signal }
    )

    await Promise.resolve()
    expect(session.askUserQuestionUsedInRun).toBe(true)
    expect(session.pendingAskUserQuestionOrder.length).toBe(1)

    const pendingId = session.pendingAskUserQuestionOrder[0]
    const pendingContext = session.pendingAskUserQuestionsById.get(pendingId)
    expect(pendingContext).toBeTruthy()
    pendingContext?.resolve({ behavior: 'allow', updatedInput: { answers: { q_1: 'Plan' } } })

    const decision = await pendingDecisionPromise
    expect(decision.behavior).toBe('allow')
    expect(decision.updatedInput).toEqual({ answers: { q_1: 'Plan' } })
  })

  it('plan mode AskUserQuestion normalizes legacy allow decision without updatedInput', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)

    const pendingDecisionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            id: 'q_1',
            question: 'Keep going?',
            options: [{ label: 'Yes', description: 'Continue' }]
          }
        ]
      },
      { signal: new AbortController().signal }
    )

    await Promise.resolve()
    const pendingId = session.pendingAskUserQuestionOrder[0]
    const pendingContext = session.pendingAskUserQuestionsById.get(pendingId)
    expect(pendingContext).toBeTruthy()
    const snapshot = pendingContext?.inputSnapshot

    pendingContext?.resolve({ behavior: 'allow' } as any)

    const decision = await pendingDecisionPromise
    expect(decision).toMatchObject({ behavior: 'allow' })
    expect(decision.updatedInput).toEqual(snapshot)
  })

  it('code mode AskUserQuestion remains callable and creates pending context', async () => {
    const session = createSession('code')
    const canUseTool = createCodeHandler(session)

    const pendingDecisionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            id: 'q_1',
            question: 'Continue with default assumptions?',
            options: [
              { label: 'Yes', description: 'Proceed with defaults' },
              { label: 'No', description: 'Stop and clarify first' }
            ]
          }
        ]
      },
      { signal: new AbortController().signal }
    )

    await Promise.resolve()
    expect(session.pendingAskUserQuestionOrder.length).toBe(1)
    const pendingId = session.pendingAskUserQuestionOrder[0]
    const pendingContext = session.pendingAskUserQuestionsById.get(pendingId)
    expect(pendingContext).toBeTruthy()
    pendingContext?.resolve({ behavior: 'allow', updatedInput: { answers: { q_1: 'Yes' } } })

    await expect(pendingDecisionPromise).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { q_1: 'Yes' } }
    })
  })

  it('plan mode AskUserQuestion applies runtime normalization pipeline before pending bind', async () => {
    const session = createSession('plan')
    const canUseTool = createPlanHandler(session)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const pendingDecisionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            id: 'q_1',
            question: 'Pick one',
            options: ['A', 'B', 'Other', 'C', 'D', 'E', 'A']
          },
          {
            id: 'q_2',
            question: 'Pick two',
            options: ['X', 'Y']
          },
          {
            id: 'q_3',
            question: 'Pick three',
            options: ['L', 'M']
          },
          {
            id: 'q_4',
            question: 'Should be truncated',
            options: ['N', 'O']
          }
        ]
      },
      { signal: new AbortController().signal }
    )

    await Promise.resolve()
    const pendingId = session.pendingAskUserQuestionOrder[0]
    const pendingContext = session.pendingAskUserQuestionsById.get(pendingId)
    expect(pendingContext).toBeTruthy()

    const questions = (pendingContext?.inputSnapshot.questions || []) as Array<Record<string, unknown>>
    expect(questions).toHaveLength(3)
    const firstOptions = questions[0].options as Array<{ label: string }>
    expect(firstOptions).toHaveLength(4)
    expect(firstOptions.some((option) => option.label.toLowerCase().startsWith('other'))).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0][0])).toContain('AskUserQuestion input normalized')

    pendingContext?.resolve({ behavior: 'allow', updatedInput: { answers: { q_1: 'A' } } })
    await expect(pendingDecisionPromise).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { q_1: 'A' } }
    })

    warnSpy.mockRestore()
  })
})

describe('normalizeAskUserQuestionInput multiSelect precedence', () => {
  it('defaults to multi-select for multi-question payload when not explicitly set', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'] },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(2)
    expect(questions.every((q) => q.multiSelect === true)).toBe(true)
  })

  it('keeps single question as single-select when not explicitly set', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [{ id: 'q_1', question: 'Only one', options: ['A', 'B'] }]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(1)
    expect(questions[0].multiSelect).toBe(false)
  })

  it('applies top-level multiSelect to questions without explicit field', () => {
    const normalized = normalizeAskUserQuestionInput({
      multi_select: false,
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'] },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions.every((q) => q.multiSelect === false)).toBe(true)
  })

  it('preserves explicit question-level false over top-level and inferred defaults', () => {
    const normalized = normalizeAskUserQuestionInput({
      multiSelect: true,
      questions: [
        { id: 'q_1', question: 'Question 1', options: ['A', 'B'], multiSelect: false },
        { id: 'q_2', question: 'Question 2', options: ['C', 'D'] }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions[0].multiSelect).toBe(false)
    expect(questions[1].multiSelect).toBe(true)
  })

  it('trims questions to at most 3 and options to at most 4', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [
        {
          id: 'q_1',
          question: 'Q1',
          options: ['A', 'B', 'C', 'D', 'E']
        },
        {
          id: 'q_2',
          question: 'Q2',
          options: ['A', 'B']
        },
        {
          id: 'q_3',
          question: 'Q3',
          options: ['A', 'B']
        },
        {
          id: 'q_4',
          question: 'Q4',
          options: ['A', 'B']
        }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(3)
    const firstOptions = questions[0].options as Array<{ label: string }>
    expect(firstOptions).toHaveLength(4)
    expect(firstOptions.map((option) => option.label)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('removes explicit Other options and guarantees at least 2 unique options', () => {
    const normalized = normalizeAskUserQuestionInput({
      questions: [
        {
          id: 'q_1',
          question: 'Select one',
          options: ['Other', 'other...', 'Only']
        }
      ]
    })

    const questions = normalized.questions as Array<Record<string, unknown>>
    expect(questions).toHaveLength(1)
    const options = questions[0].options as Array<{ label: string }>
    expect(options.length).toBeGreaterThanOrEqual(2)
    expect(options.some((option) => option.label.toLowerCase().startsWith('other'))).toBe(false)
  })
})
