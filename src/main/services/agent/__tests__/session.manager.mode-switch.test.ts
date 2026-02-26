import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn()
}))

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({})),
  onApiConfigChange: vi.fn()
}))

vi.mock('../../toolkit.service', () => ({
  getToolkitHash: vi.fn(() => 'toolkit-hash')
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn(() => null)
}))

vi.mock('../electron-path', () => ({
  getHeadlessElectronPath: vi.fn(() => '/tmp/electron')
}))

vi.mock('../provider-resolver', () => ({
  resolveProvider: vi.fn()
}))

vi.mock('../ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn()
}))

vi.mock('../sdk-config.builder', () => ({
  buildSdkOptions: vi.fn(),
  getWorkingDir: vi.fn(),
  getEffectiveSkillsLazyLoad: vi.fn(() => ({ effectiveLazyLoad: false, toolkit: [] }))
}))

vi.mock('../renderer-comm', () => ({
  createCanUseTool: vi.fn()
}))

vi.mock('../../plugin-mcp.service', () => ({
  getEnabledPluginMcpHash: vi.fn(() => 'mcp-hash'),
  getEnabledPluginMcpList: vi.fn(() => [])
}))

import {
  closeAllV2Sessions,
  deleteActiveSession,
  getOrCreateV2Session,
  setActiveSession,
  setSessionMode
} from '../session.manager'
import type { SessionState } from '../types'

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
    pendingAskUserQuestion: null,
    thoughts: [],
    processTrace: [],
    ...overrides
  }
}

describe('session.manager setSessionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    deleteActiveSession('conv-1')
    closeAllV2Sessions()
  })

  it('returns no_active_session when conversation has no running session', async () => {
    const result = await setSessionMode('conv-1', 'plan', 'run-1')
    expect(result).toEqual({
      applied: false,
      mode: 'plan',
      reason: 'no_active_session'
    })
  })

  it('returns run_id_mismatch when runId does not match current run', async () => {
    setActiveSession('conv-1', createSessionState({ runId: 'run-current' }))
    const result = await setSessionMode('conv-1', 'plan', 'run-other')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('run_id_mismatch')
    expect(result.mode).toBe('code')
    expect(result.runId).toBe('run-current')
  })

  it('returns blocked_pending_interaction when pending approval/question exists', async () => {
    setActiveSession('conv-1', createSessionState({
      pendingPermissionResolve: vi.fn()
    }))
    const result = await setSessionMode('conv-1', 'plan', 'run-1')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('blocked_pending_interaction')
  })

  it('returns sdk_error when v2 session is unavailable', async () => {
    setActiveSession('conv-1', createSessionState())
    const result = await setSessionMode('conv-1', 'plan', 'run-1')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('sdk_error')
  })

  it('applies mode switch and updates session mode on success', async () => {
    const setPermissionMode = vi.fn().mockResolvedValue(undefined)
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({
      close: vi.fn(),
      setPermissionMode
    } as any)

    await getOrCreateV2Session('space-1', 'conv-1', {})
    const session = createSessionState({ mode: 'code' })
    setActiveSession('conv-1', session)

    const result = await setSessionMode('conv-1', 'plan', 'run-1')

    expect(result).toEqual({
      applied: true,
      mode: 'plan',
      runId: 'run-1'
    })
    expect(setPermissionMode).toHaveBeenCalledWith('plan')
    expect(session.mode).toBe('plan')
  })

  it('rejects invalid mode', async () => {
    const result = await setSessionMode('conv-1', 'invalid-mode' as unknown, 'run-1')
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('invalid_mode')
  })
})
