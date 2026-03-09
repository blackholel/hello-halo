import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn()
}))

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({})),
  onApiConfigChange: vi.fn()
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn(() => null),
  clearSessionId: vi.fn()
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

vi.mock('../../resource-index.service', () => ({
  getResourceIndexHash: vi.fn(() => 'resource-hash')
}))

import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from '../../config.service'
import { clearSessionId, getConversation } from '../../conversation.service'
import { resolveEffectiveConversationAi } from '../ai-config-resolver'
import { resolveProvider } from '../provider-resolver'
import { buildSdkOptions, getWorkingDir } from '../sdk-config.builder'
import {
  acquireSessionWithResumeFallback,
  classifyResumeError,
  closeAllV2Sessions,
  deleteActiveSession,
  ensureSessionWarm,
  getOrCreateV2Session,
  setActiveSession,
  touchV2Session
} from '../session.manager'
import type { SessionConfig, SessionState } from '../types'

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

function createRunningSessionState(conversationId: string): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId,
    runId: `run-${conversationId}`,
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
    processTrace: []
  }
}

describe('session.manager rebuild', () => {
  const closeFirst = vi.fn()
  const closeSecond = vi.fn()

  beforeEach(() => {
    vi.mocked(unstable_v2_createSession)
      .mockResolvedValueOnce({ close: closeFirst } as any)
      .mockResolvedValueOnce({ close: closeSecond } as any)
  })

  afterEach(() => {
    closeAllV2Sessions()
    vi.clearAllMocks()
  })

  it('配置不变复用 session，配置变化触发重建', async () => {
    const configA: SessionConfig = {
      aiBrowserEnabled: false,
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    const configB: SessionConfig = {
      ...configA,
      effectiveModel: 'model-b'
    }

    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configB)

    expect(unstable_v2_createSession).toHaveBeenCalledTimes(2)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(closeSecond).not.toHaveBeenCalled()
  })

  it('resourceIndexHash 高频变化时触发防抖，避免连续重建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    const closeC = vi.fn()
    vi.mocked(unstable_v2_createSession)
      .mockReset()
      .mockResolvedValueOnce({ close: closeA } as any)
      .mockResolvedValueOnce({ close: closeB } as any)
      .mockResolvedValueOnce({ close: closeC } as any)

    const base: SessionConfig = {
      aiBrowserEnabled: false,
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-1'
    })
    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-2'
    })
    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-3'
    })

    expect(unstable_v2_createSession).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
    expect(closeC).not.toHaveBeenCalled()
  })

  it('仅 responseLanguage 变化时也会触发 session 重建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(unstable_v2_createSession)
      .mockReset()
      .mockResolvedValueOnce({ close: closeA } as any)
      .mockResolvedValueOnce({ close: closeB } as any)

    const base: SessionConfig = {
      aiBrowserEnabled: false,
      skillsLazyLoad: false,
      responseLanguage: 'en',
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-lang', {}, undefined, base)
    await getOrCreateV2Session('space-1', 'conv-lang', {}, undefined, {
      ...base,
      responseLanguage: 'zh-CN'
    })

    expect(unstable_v2_createSession).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('warmup 对缺少 scope 的旧 sessionId 不做 resume，并清理持久化 sessionId', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession).mockReset().mockResolvedValueOnce({ close } as any)
    vi.mocked(getWorkingDir).mockReturnValue('/workspace/project')
    vi.mocked(getConversation).mockReturnValue({
      id: 'conv-warm',
      spaceId: 'space-1',
      sessionId: 'legacy-session-id',
      ai: { profileId: 'profile-a' }
    } as any)
    vi.mocked(resolveEffectiveConversationAi).mockReturnValue({
      profileId: 'profile-a',
      profile: {
        id: 'profile-a',
        vendor: 'anthropic',
        protocol: 'anthropic_official'
      },
      effectiveModel: 'claude-test',
      providerSignature: 'provider-signature',
      disableToolsForCompat: false
    } as any)
    vi.mocked(resolveProvider).mockResolvedValue({
      anthropicApiKey: 'test-key',
      anthropicBaseUrl: 'https://api.anthropic.com',
      sdkModel: 'claude-test',
      effectiveModel: 'claude-test',
      useAnthropicCompatModelMapping: false
    } as any)
    vi.mocked(buildSdkOptions).mockReturnValue({
      cwd: '/workspace/project'
    } as any)

    await ensureSessionWarm('space-1', 'conv-warm', 'en')

    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-warm')
    expect(unstable_v2_createSession).toHaveBeenCalledTimes(1)
    const createArgs = vi.mocked(unstable_v2_createSession).mock.calls[0]?.[0] as Record<string, unknown>
    expect(createArgs?.resume).toBeUndefined()
  })

  it('scope 不匹配时会清理旧 sessionId 并直接新建', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession).mockReset().mockResolvedValueOnce({ close } as any)

    const result = await acquireSessionWithResumeFallback({
      spaceId: 'space-1',
      conversationId: 'conv-scope-mismatch',
      sdkOptions: {},
      persistedSessionId: 'legacy-session-id',
      persistedSessionScope: { spaceId: 'space-other', workDir: '/workspace/project' },
      resolvedWorkDir: '/workspace/project',
      historyMessageCount: 2
    })

    expect(result.outcome).toBe('blocked_space_mismatch')
    expect(result.retryCount).toBe(0)
    expect(result.errorCode).toBe(null)
    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-scope-mismatch')
    expect(unstable_v2_createSession).toHaveBeenCalledTimes(1)
    const createArgs = vi.mocked(unstable_v2_createSession).mock.calls[0]?.[0] as Record<string, unknown>
    expect(createArgs?.resume).toBeUndefined()
  })

  it('resume 失败命中白名单后会清理并重试新建', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession)
      .mockReset()
      .mockRejectedValueOnce(new Error('Session not found: stale id'))
      .mockResolvedValueOnce({ close } as any)

    const result = await acquireSessionWithResumeFallback({
      spaceId: 'space-1',
      conversationId: 'conv-retry',
      sdkOptions: {},
      persistedSessionId: 'stale-id',
      persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
      resolvedWorkDir: '/workspace/project',
      historyMessageCount: 4
    })

    expect(result.outcome).toBe('new_after_resume_fail')
    expect(result.retryCount).toBe(1)
    expect(result.errorCode).toBe('SESSION_NOT_FOUND')
    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-retry')
    expect(unstable_v2_createSession).toHaveBeenCalledTimes(2)
    const secondArgs = vi.mocked(unstable_v2_createSession).mock.calls[1]?.[0] as Record<string, unknown>
    expect(secondArgs?.resume).toBeUndefined()
  })

  it('resume 失败非白名单错误直接抛出，不 fallback', async () => {
    vi.mocked(unstable_v2_createSession)
      .mockReset()
      .mockRejectedValueOnce(new Error('network disconnected'))

    await expect(
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-fatal',
        sdkOptions: {},
        persistedSessionId: 'session-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 2
      })
    ).rejects.toThrow('network disconnected')

    expect(clearSessionId).not.toHaveBeenCalled()
    expect(unstable_v2_createSession).toHaveBeenCalledTimes(1)
  })

  it('classifyResumeError 按白名单分类', () => {
    expect(classifyResumeError({ code: 'SESSION_NOT_FOUND' }).code).toBe('SESSION_NOT_FOUND')
    expect(classifyResumeError({ errorCode: 'invalid-session' }).code).toBe('INVALID_SESSION')
    expect(classifyResumeError(new Error('Session not found')).code).toBe('SESSION_NOT_FOUND')
    expect(classifyResumeError(new Error('invalid session id')).code).toBe('INVALID_SESSION')
    expect(classifyResumeError(new Error('permission denied')).code).toBe('UNKNOWN')
  })

  it('同一 conversationId 并发恢复链路会被互斥串行化', async () => {
    vi.useRealTimers()
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(unstable_v2_createSession).mockReset().mockImplementation(async (options: any) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      if (options?.resume) {
        throw new Error('Session not found: stale id')
      }
      return { close: vi.fn() } as any
    })

    await Promise.all([
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-serial',
        sdkOptions: {},
        persistedSessionId: 'stale-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 3
      }),
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-serial',
        sdkOptions: {},
        persistedSessionId: 'stale-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 3
      })
    ])

    expect(maxInFlight).toBe(1)
  })
})

describe('session.manager cleanup', () => {
  const baseConfig: SessionConfig = {
    aiBrowserEnabled: false,
    skillsLazyLoad: false,
    profileId: 'profile-cleanup',
    providerSignature: 'sig-cleanup',
    effectiveModel: 'model-cleanup',
    enabledPluginMcpsHash: 'mcp-cleanup',
    hasCanUseTool: true
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.mocked(getConfig).mockReturnValue({} as any)
    vi.mocked(unstable_v2_createSession).mockReset()
  })

  afterEach(() => {
    deleteActiveSession('space-1', 'conv-active')
    closeAllV2Sessions()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('inactive session 超时后会被清理', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', 'conv-inactive', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('active session 超时后不会被清理', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', 'conv-active', {}, undefined, baseConfig)
    setActiveSession('space-1', 'conv-active', createRunningSessionState('conv-active'))
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)

    expect(close).not.toHaveBeenCalled()
  })

  it('sessionIdleTimeoutMs <= 0 时不执行清理', async () => {
    const close = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        sessionIdleTimeoutMs: 0
      }
    } as any)
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', 'conv-disabled', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 5 * 60 * 1000)

    expect(close).not.toHaveBeenCalled()
  })

  it('touchV2Session 可以延长会话生命周期，避免误清理', async () => {
    const close = vi.fn()
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', 'conv-touch', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000)
    touchV2Session('space-1', 'conv-touch')

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['NaN', Number.NaN],
    ['string', 'abc'],
    ['tiny', 10]
  ])('非法 timeout 配置(%s)回退默认行为', async (_, timeoutValue) => {
    const close = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        sessionIdleTimeoutMs: timeoutValue
      }
    } as any)
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', `conv-invalid-${String(timeoutValue)}`, {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('close 返回 rejected Promise(Abort) 时不会产生未处理拒绝', async () => {
    const close = vi.fn(() => Promise.reject(new Error('Operation aborted')))
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.mocked(unstable_v2_createSession).mockResolvedValueOnce({ close } as any)

    await getOrCreateV2Session('space-1', 'conv-abort', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)
    await Promise.resolve()

    expect(close).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalled()
    debugSpy.mockRestore()
  })
})
