/**
 * V2 Session Manager
 *
 * Manages V2 SDK Session lifecycle including creation, reuse, and cleanup.
 */

import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { resolve } from 'path'
import { getConfig, onApiConfigChange } from '../config.service'
import { clearSessionId, getConversation } from '../conversation.service'
import { getHeadlessElectronPath } from './electron-path'
import { resolveProvider } from './provider-resolver'
import { resolveEffectiveConversationAi } from './ai-config-resolver'
import { buildSdkOptions, getWorkingDir, getEffectiveSkillsLazyLoad } from './sdk-config.builder'
import { createCanUseTool } from './renderer-comm'
import type {
  V2SDKSession,
  V2SessionInfo,
  SessionConfig,
  SessionState,
  ChatMode,
  AgentSetModeResult,
  SessionAcquireResult,
  ResumeErrorCode
} from './types'
import { getPermissionModeForChatMode, isChatMode } from './types'
import { getEnabledPluginMcpHash, getEnabledPluginMcpList } from '../plugin-mcp.service'
import { getResourceIndexHash } from '../resource-index.service'
import { normalizeLocale, type LocaleCode } from '../../../shared/i18n/locale'
import { buildSessionKey } from '../../../shared/session-key'

// V2 Session management: Map of sessionKey -> persistent V2 session
const v2Sessions = new Map<string, V2SessionInfo>()

// Active session state: Map of sessionKey -> session state
const activeSessions = new Map<string, SessionState>()

// Session cleanup defaults
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const MIN_SESSION_IDLE_TIMEOUT_MS = 1000
const RESOURCE_INDEX_REBUILD_DEBOUNCE_MS = 3000
let cleanupIntervalId: NodeJS.Timeout | null = null
const lastResourceIndexRebuildAt = new Map<string, number>()
const sessionAcquireLockChains = new Map<string, Promise<void>>()

function toSessionKey(spaceId: string, conversationId: string): string {
  return buildSessionKey(spaceId, conversationId)
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function hasPendingAskUserQuestionInteraction(sessionState: SessionState): boolean {
  for (const pendingId of sessionState.pendingAskUserQuestionOrder) {
    const pendingContext = sessionState.pendingAskUserQuestionsById.get(pendingId)
    if (!pendingContext) continue
    if (pendingContext.status === 'awaiting_bind' || pendingContext.status === 'awaiting_answer') {
      return true
    }
  }
  return false
}

function resolveSessionIdleTimeoutMs(): number | null {
  const rawTimeout = (getConfig().claudeCode as { sessionIdleTimeoutMs?: unknown } | undefined)
    ?.sessionIdleTimeoutMs

  if (rawTimeout == null) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS
  }

  if (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout)) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS
  }

  if (rawTimeout <= 0) {
    return null
  }

  if (rawTimeout < MIN_SESSION_IDLE_TIMEOUT_MS) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS
  }

  return rawTimeout
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return ''
}

function isAbortLikeError(error: unknown): boolean {
  return /abort/i.test(errorMessage(error))
}

function normalizePathForCompare(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function withSessionAcquireLock<T>(
  sessionKey: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = sessionAcquireLockChains.get(sessionKey) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const chain = previous.then(() => gate)
  sessionAcquireLockChains.set(sessionKey, chain)

  const run = async (): Promise<T> => {
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (sessionAcquireLockChains.get(sessionKey) === chain) {
        sessionAcquireLockChains.delete(sessionKey)
      }
    }
  }

  return run()
}

export function classifyResumeError(error: unknown): {
  code: ResumeErrorCode
  retryable: boolean
} {
  const rawCode = (() => {
    if (!error || typeof error !== 'object') return ''
    const maybeCode = (error as { code?: unknown; errorCode?: unknown }).code
      ?? (error as { code?: unknown; errorCode?: unknown }).errorCode
    return typeof maybeCode === 'string' ? maybeCode.trim() : ''
  })()
  const normalizedCode = rawCode
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (normalizedCode === 'SESSION_NOT_FOUND') {
    return { code: 'SESSION_NOT_FOUND', retryable: true }
  }
  if (normalizedCode === 'INVALID_SESSION') {
    return { code: 'INVALID_SESSION', retryable: true }
  }

  const message = errorMessage(error).toLowerCase()

  if (!message) {
    return { code: 'UNKNOWN', retryable: false }
  }

  if (message.includes('session') && message.includes('not found')) {
    return { code: 'SESSION_NOT_FOUND', retryable: true }
  }
  if (message.includes('invalid') && message.includes('session')) {
    return { code: 'INVALID_SESSION', retryable: true }
  }

  return { code: 'UNKNOWN', retryable: false }
}

function closeSessionSafely(session: V2SDKSession, context: string): void {
  try {
    const maybePromise = session.close()
    if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
      void (maybePromise as Promise<void>).catch((error) => {
        if (isAbortLikeError(error)) {
          console.debug(`${context} Session close aborted`, error)
          return
        }
        console.error(`${context} Error closing session:`, error)
      })
    }
  } catch (error) {
    if (isAbortLikeError(error)) {
      console.debug(`${context} Session close aborted`, error)
      return
    }
    console.error(`${context} Error closing session:`, error)
  }
}

/**
 * Start session cleanup interval
 */
function startSessionCleanup(): void {
  if (cleanupIntervalId) return

  cleanupIntervalId = setInterval(() => {
    const idleTimeoutMs = resolveSessionIdleTimeoutMs()
    if (idleTimeoutMs === null) {
      return
    }
    const now = Date.now()
    for (const [sessionKey, info] of Array.from(v2Sessions.entries())) {
      if (activeSessions.has(sessionKey)) {
        continue
      }
      const idleMs = now - info.lastUsedAt
      if (idleMs > idleTimeoutMs) {
        console.log(`[Agent] Cleaning up idle V2 session: ${sessionKey} (idleMs=${idleMs}, timeoutMs=${idleTimeoutMs})`)
        closeSessionSafely(info.session, `[Agent][${sessionKey}]`)
        v2Sessions.delete(sessionKey)
        lastResourceIndexRebuildAt.delete(sessionKey)
      }
    }
  }, 60 * 1000)
}

function getSessionRebuildReasons(existing: SessionConfig, next: SessionConfig): string[] {
  const reasons: string[] = []
  if ((existing.spaceId || '') !== (next.spaceId || '')) reasons.push('spaceId')
  if ((existing.workDir || '') !== (next.workDir || '')) reasons.push('workDir')
  if (existing.aiBrowserEnabled !== next.aiBrowserEnabled) reasons.push('aiBrowserEnabled')
  if (existing.skillsLazyLoad !== next.skillsLazyLoad) reasons.push('skillsLazyLoad')
  if ((existing.responseLanguage || 'en') !== (next.responseLanguage || 'en')) reasons.push('responseLanguage')
  if ((existing.profileId || '') !== (next.profileId || '')) reasons.push('profileId')
  if ((existing.providerSignature || '') !== (next.providerSignature || '')) reasons.push('providerSignature')
  if ((existing.effectiveModel || '') !== (next.effectiveModel || '')) reasons.push('effectiveModel')
  if ((existing.enabledPluginMcpsHash || '') !== (next.enabledPluginMcpsHash || '')) reasons.push('enabledPluginMcpsHash')
  if ((existing.resourceIndexHash || '') !== (next.resourceIndexHash || '')) reasons.push('resourceIndexHash')
  if ((existing.hasCanUseTool || false) !== (next.hasCanUseTool || false)) reasons.push('hasCanUseTool')
  return reasons
}

function buildSessionConfigSignature(config: SessionConfig): string {
  return JSON.stringify({
    spaceId: config.spaceId || '',
    workDir: config.workDir || '',
    aiBrowserEnabled: config.aiBrowserEnabled,
    skillsLazyLoad: config.skillsLazyLoad,
    responseLanguage: config.responseLanguage || 'en',
    profileId: config.profileId || '',
    providerSignature: config.providerSignature || '',
    effectiveModel: config.effectiveModel || '',
    enabledPluginMcpsHash: config.enabledPluginMcpsHash || '',
    resourceIndexHash: config.resourceIndexHash || '',
    hasCanUseTool: config.hasCanUseTool || false
  })
}

function shouldDebounceResourceIndexRebuild(sessionKey: string, reasons: string[]): boolean {
  if (reasons.length !== 1 || reasons[0] !== 'resourceIndexHash') {
    return false
  }
  const now = Date.now()
  const last = lastResourceIndexRebuildAt.get(sessionKey) || 0
  if (now - last < RESOURCE_INDEX_REBUILD_DEBOUNCE_MS) {
    return true
  }
  lastResourceIndexRebuildAt.set(sessionKey, now)
  return false
}

function emitAgentSessionRebuildEvent(
  sessionKey: string,
  reasons: string[],
  previous: SessionConfig,
  next: SessionConfig
): void {
  console.warn('[telemetry] agent_session_rebuild', {
    sessionKey,
    spaceId: next.spaceId || previous.spaceId || null,
    reasons,
    previousConfigHash: buildSessionConfigSignature(previous),
    nextConfigHash: buildSessionConfigSignature(next)
  })
}

/**
 * Close and remove an existing V2 session (internal helper for rebuild)
 */
function closeV2SessionForRebuild(spaceId: string, conversationId: string): void {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const existing = v2Sessions.get(sessionKey)
  if (existing) {
    console.log(`[Agent][${sessionKey}] Closing V2 session for rebuild`)
    closeSessionSafely(existing.session, `[Agent][${sessionKey}]`)
    v2Sessions.delete(sessionKey)
  }
}

export function touchV2Session(spaceId: string, conversationId: string): void {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const sessionInfo = v2Sessions.get(sessionKey)
  if (!sessionInfo) {
    return
  }
  sessionInfo.lastUsedAt = Date.now()
}

/**
 * Get or create V2 Session.
 * Enables process reuse to avoid cold start delays.
 */
export async function getOrCreateV2Session(
  spaceId: string,
  conversationId: string,
  sdkOptions: Record<string, any>,
  sessionId?: string,
  config?: SessionConfig
): Promise<V2SDKSession> {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const existing = v2Sessions.get(sessionKey)
  if (existing) {
    if (existing.spaceId !== spaceId) {
      console.warn(
        `[Agent][${sessionKey}] Session scope mismatch (existing=${existing.spaceId}, incoming=${spaceId}), rebuilding session`
      )
      closeV2SessionForRebuild(spaceId, conversationId)
    }
  }
  const rebuiltExisting = v2Sessions.get(sessionKey)
  if (rebuiltExisting) {
    const reasons = config ? getSessionRebuildReasons(rebuiltExisting.config, config) : []
    if (config && reasons.length > 0) {
      if (shouldDebounceResourceIndexRebuild(sessionKey, reasons)) {
        console.log(
          `[Agent][${sessionKey}] Skip session rebuild due to resourceIndexHash debounce (${RESOURCE_INDEX_REBUILD_DEBOUNCE_MS}ms)`
        )
        touchV2Session(spaceId, conversationId)
        return rebuiltExisting.session
      }
      console.log(
        `[Agent][${sessionKey}] Session config changed, rebuilding session`,
        {
          from: {
            aiBrowserEnabled: rebuiltExisting.config.aiBrowserEnabled,
            responseLanguage: rebuiltExisting.config.responseLanguage || 'en',
            profileId: rebuiltExisting.config.profileId,
            effectiveModel: rebuiltExisting.config.effectiveModel
          },
          to: {
            aiBrowserEnabled: config.aiBrowserEnabled,
            responseLanguage: config.responseLanguage || 'en',
            profileId: config.profileId,
            effectiveModel: config.effectiveModel
          }
        }
      )
      emitAgentSessionRebuildEvent(sessionKey, reasons, rebuiltExisting.config, config)
      closeV2SessionForRebuild(spaceId, conversationId)
    } else {
      console.log(`[Agent][${sessionKey}] Reusing existing V2 session`)
      touchV2Session(spaceId, conversationId)
      return rebuiltExisting.session
    }
  }

  console.log(`[Agent][${sessionKey}] Creating new V2 session${sessionId ? ` with resume: ${sessionId}` : ''}`)
  const startTime = Date.now()

  if (sessionId) {
    sdkOptions.resume = sessionId
  } else if (Object.prototype.hasOwnProperty.call(sdkOptions, 'resume')) {
    delete sdkOptions.resume
  }

  const session = (await unstable_v2_createSession(sdkOptions as any)) as unknown as V2SDKSession
  console.log(`[Agent][${sessionKey}] V2 session created in ${Date.now() - startTime}ms`)

  v2Sessions.set(sessionKey, {
    session,
    spaceId,
    conversationId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    config: config || {
      spaceId,
      workDir: typeof sdkOptions?.cwd === 'string' ? sdkOptions.cwd : undefined,
      aiBrowserEnabled: false,
      skillsLazyLoad: false,
      enabledPluginMcpsHash: ''
    }
  })

  startSessionCleanup()
  return session
}

export async function acquireSessionWithResumeFallback(params: {
  spaceId: string
  conversationId: string
  sdkOptions: Record<string, any>
  sessionConfig?: SessionConfig
  persistedSessionId?: string
  persistedSessionScope?: { spaceId?: string; workDir?: string } | undefined
  resolvedWorkDir: string
  historyMessageCount: number
}): Promise<SessionAcquireResult> {
  const {
    spaceId,
    conversationId,
    sdkOptions,
    sessionConfig,
    persistedSessionId,
    persistedSessionScope,
    resolvedWorkDir,
    historyMessageCount
  } = params
  const sessionKey = toSessionKey(spaceId, conversationId)

  return withSessionAcquireLock(sessionKey, async () => {
    const startedAt = Date.now()
    const scopeSpaceId =
      typeof persistedSessionScope?.spaceId === 'string' ? persistedSessionScope.spaceId.trim() : ''
    const scopeWorkDir =
      typeof persistedSessionScope?.workDir === 'string' ? persistedSessionScope.workDir.trim() : ''
    const scopeMatches =
      scopeSpaceId === spaceId &&
      scopeWorkDir.length > 0 &&
      normalizePathForCompare(scopeWorkDir) === normalizePathForCompare(resolvedWorkDir)
    const hasSessionId = Boolean(persistedSessionId)

    const logBase = {
      sessionKey,
      spaceId,
      conversationId,
      hasSessionId,
      historyMessageCount
    }

    if (persistedSessionId && !scopeMatches) {
      console.warn('[Agent] resume_scope_guard blocked persisted sessionId due to scope mismatch', {
        ...logBase,
        phase: 'resume_scope_guard',
        outcome: 'blocked_space_mismatch',
        errorCode: null,
        retryCount: 0,
        durationMs: Date.now() - startedAt,
        bootstrapTokenEstimate: 0,
        scopeSpaceId: scopeSpaceId || null,
        scopeWorkDir: scopeWorkDir || null,
        resolvedWorkDir
      })
      try {
        clearSessionId(spaceId, conversationId)
      } catch (clearError) {
        console.warn('[Agent] Failed to clear stale sessionId in scope guard', {
          ...logBase,
          phase: 'resume_scope_guard',
          outcome: 'blocked_space_mismatch',
          errorCode: null,
          retryCount: 0,
          durationMs: Date.now() - startedAt,
          bootstrapTokenEstimate: 0,
          cause: clearError instanceof Error ? clearError.message : String(clearError)
        })
      }

      const session = await getOrCreateV2Session(
        spaceId,
        conversationId,
        sdkOptions,
        undefined,
        sessionConfig
      )

      return {
        session,
        outcome: 'blocked_space_mismatch',
        retryCount: 0,
        errorCode: null
      }
    }

    if (persistedSessionId) {
      try {
        const session = await getOrCreateV2Session(
          spaceId,
          conversationId,
          sdkOptions,
          persistedSessionId,
          sessionConfig
        )
        console.log('[Agent] resume_attempt', {
          ...logBase,
          phase: 'resume_attempt',
          outcome: 'resumed',
          errorCode: null,
          retryCount: 0,
          durationMs: Date.now() - startedAt,
          bootstrapTokenEstimate: 0,
          scopeMatches
        })
        return {
          session,
          outcome: 'resumed',
          retryCount: 0,
          errorCode: null
        }
      } catch (error) {
        const classified = classifyResumeError(error)
        if (!classified.retryable) {
          console.error('[Agent] resume_attempt failed without fallback', {
            ...logBase,
            phase: 'resume_attempt',
            outcome: 'fatal',
            errorCode: classified.code,
            retryCount: 0,
            durationMs: Date.now() - startedAt,
            bootstrapTokenEstimate: 0
          })
          throw error
        }

        console.warn('[Agent] resume_failed_retry_new', {
          ...logBase,
          phase: 'resume_failed_retry_new',
          outcome: 'new_after_resume_fail',
          errorCode: classified.code,
          retryCount: 1,
          durationMs: Date.now() - startedAt,
          bootstrapTokenEstimate: 0
        })

        try {
          clearSessionId(spaceId, conversationId)
        } catch (clearError) {
          console.warn('[Agent] Failed to clear stale sessionId after resume failure', {
            ...logBase,
            phase: 'resume_failed_retry_new',
            outcome: 'new_after_resume_fail',
            errorCode: classified.code,
            retryCount: 1,
            durationMs: Date.now() - startedAt,
            bootstrapTokenEstimate: 0,
            cause: clearError instanceof Error ? clearError.message : String(clearError)
          })
        }

        const session = await getOrCreateV2Session(
          spaceId,
          conversationId,
          sdkOptions,
          undefined,
          sessionConfig
        )

        return {
          session,
          outcome: 'new_after_resume_fail',
          retryCount: 1,
          errorCode: classified.code
        }
      }
    }

    const session = await getOrCreateV2Session(
      spaceId,
      conversationId,
      sdkOptions,
      undefined,
      sessionConfig
    )
    console.log('[Agent] resume_attempt', {
      ...logBase,
      phase: 'resume_attempt',
      outcome: 'new_no_resume',
      errorCode: null,
      retryCount: 0,
      durationMs: Date.now() - startedAt,
      bootstrapTokenEstimate: 0,
      scopeMatches
    })
    return {
      session,
      outcome: 'new_no_resume',
      retryCount: 0,
      errorCode: null
    }
  })
}

/**
 * Warm up V2 Session for faster message sending.
 * Called when user switches conversations.
 */
export async function ensureSessionWarm(
  spaceId: string,
  conversationId: string,
  responseLanguage?: LocaleCode | string
): Promise<void> {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const config = getConfig()
  const workDir = getWorkingDir(spaceId)
  const normalizedResponseLanguage = normalizeLocale(responseLanguage)
  const conversation = getConversation(spaceId, conversationId) as
    | ({
      ai?: { profileId?: string }
      sessionId?: string
      sessionScope?: { spaceId?: string; workDir?: string }
      messages?: Array<Record<string, unknown>>
    } & Record<string, unknown>)
    | null
  const persistedSessionId =
    typeof conversation?.sessionId === 'string' && conversation.sessionId.trim().length > 0
      ? conversation.sessionId.trim()
      : undefined
  const persistedSessionScope =
    conversation && typeof conversation.sessionScope === 'object' && conversation.sessionScope
      ? conversation.sessionScope
      : undefined
  const historyMessageCount = Array.isArray(conversation?.messages) ? conversation.messages.length : 0
  const electronPath = getHeadlessElectronPath()
  const { effectiveLazyLoad: skillsLazyLoad } = getEffectiveSkillsLazyLoad(workDir, config)
  const effectiveAi = resolveEffectiveConversationAi(spaceId, conversationId)
  const configuredConversationProfileId = toNonEmptyString(conversation?.ai?.profileId)
  const defaultProfileId = toNonEmptyString(config.ai?.defaultProfileId)

  if (!configuredConversationProfileId) {
    console.warn(
      `[Agent][${conversationId}] Warmup: Conversation AI profile missing, fallback to defaultProfileId=${defaultProfileId || effectiveAi.profileId}`
    )
  } else if (configuredConversationProfileId !== effectiveAi.profileId) {
    console.warn(
      `[Agent][${conversationId}] Warmup: Conversation AI profile "${configuredConversationProfileId}" not found, fallback to defaultProfileId=${defaultProfileId || effectiveAi.profileId}`
    )
  }

  const abortController = new AbortController()
  const resolved = await resolveProvider(effectiveAi.profile, effectiveAi.effectiveModel)

  const sdkOptions = buildSdkOptions({
    spaceId,
    conversationId,
    workDir,
    config,
    abortController,
    anthropicApiKey: resolved.anthropicApiKey,
    anthropicBaseUrl: resolved.anthropicBaseUrl,
    sdkModel: resolved.sdkModel,
    effectiveModel: resolved.effectiveModel,
    useAnthropicCompatModelMapping: resolved.useAnthropicCompatModelMapping,
    electronPath,
    aiBrowserEnabled: false,
    thinkingEnabled: false,
    responseLanguage: normalizedResponseLanguage,
    disableToolsForCompat: effectiveAi.disableToolsForCompat,
    stderrSuffix: ' (warm)',
    canUseTool: createCanUseTool(
      workDir,
      spaceId,
      conversationId,
      getActiveSession
    ),
    enabledPluginMcps: getEnabledPluginMcpList(conversationId)
  })

  try {
    console.log(`[Agent] Warming up V2 session: ${sessionKey}`)
    await acquireSessionWithResumeFallback({
      spaceId,
      conversationId,
      sdkOptions,
      persistedSessionId,
      persistedSessionScope,
      resolvedWorkDir: workDir,
      historyMessageCount,
      sessionConfig: {
        spaceId,
        workDir,
        aiBrowserEnabled: false,
        skillsLazyLoad,
        responseLanguage: normalizedResponseLanguage,
        profileId: effectiveAi.profileId,
        providerSignature: effectiveAi.providerSignature,
        effectiveModel: effectiveAi.effectiveModel,
        enabledPluginMcpsHash: getEnabledPluginMcpHash(conversationId),
        resourceIndexHash: getResourceIndexHash(workDir),
        hasCanUseTool: true // Session has canUseTool callback
      }
    })
    console.log(`[Agent] V2 session warmed up: ${sessionKey}`)
  } catch (error) {
    console.error(`[Agent] Failed to warm up session ${sessionKey}:`, error)
    throw error
  }
}

/**
 * Close V2 session for a conversation
 */
export function closeV2Session(spaceId: string, conversationId: string): void {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const info = v2Sessions.get(sessionKey)
  if (info) {
    console.log(`[Agent][${sessionKey}] Closing V2 session`)
    closeSessionSafely(info.session, `[Agent][${sessionKey}]`)
    v2Sessions.delete(sessionKey)
  }
  lastResourceIndexRebuildAt.delete(sessionKey)
}

/**
 * Close all V2 sessions (for app shutdown)
 */
export function closeAllV2Sessions(): void {
  console.log(`[Agent] Closing all ${v2Sessions.size} V2 sessions`)
  // Avoid TS downlevelIteration requirement
  for (const [convId, info] of Array.from(v2Sessions.entries())) {
    closeSessionSafely(info.session, `[Agent][${convId}]`)
  }
  v2Sessions.clear()
  lastResourceIndexRebuildAt.clear()

  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
  }
}

/**
 * Invalidate all V2 sessions due to API config change.
 * Called by config.service via callback when API config changes.
 *
 * Sessions are closed immediately, but users are not interrupted.
 * New sessions will be created with updated config on next message.
 */
function invalidateAllSessions(): void {
  const count = v2Sessions.size
  if (count === 0) {
    console.log('[Agent] No active sessions to invalidate')
    return
  }

  console.log(`[Agent] Invalidating ${count} sessions due to API config change`)

  for (const [sessionKey, info] of Array.from(v2Sessions.entries())) {
    console.log(`[Agent] Closing session: ${sessionKey}`)
    closeSessionSafely(info.session, `[Agent][${sessionKey}]`)
  }

  v2Sessions.clear()
  lastResourceIndexRebuildAt.clear()
  console.log('[Agent] All sessions invalidated, will use new config on next message')
}

// Register for API config change notifications
// This is called once when the module loads
onApiConfigChange(() => {
  invalidateAllSessions()
})

/**
 * Reconnect a failed MCP server for a specific conversation
 */
export async function reconnectMcpServer(
  spaceId: string,
  conversationId: string,
  serverName: string
): Promise<{ success: boolean; error?: string }> {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const sessionInfo = v2Sessions.get(sessionKey)
  if (!sessionInfo) {
    return { success: false, error: 'No active session for this conversation' }
  }

  const session = sessionInfo.session
  if (!session.reconnectMcpServer) {
    return { success: false, error: 'SDK does not support MCP reconnection' }
  }

  try {
    console.log(`[Agent][${sessionKey}] Reconnecting MCP server: ${serverName}`)
    await session.reconnectMcpServer(serverName)
    console.log(`[Agent][${sessionKey}] MCP server reconnected: ${serverName}`)
    return { success: true }
  } catch (error) {
    const err = error as Error
    console.error(`[Agent][${sessionKey}] Failed to reconnect MCP server ${serverName}:`, err)
    return { success: false, error: err.message }
  }
}

/**
 * Toggle (enable/disable) an MCP server for a specific conversation
 */
export async function toggleMcpServer(
  spaceId: string,
  conversationId: string,
  serverName: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const sessionKey = toSessionKey(spaceId, conversationId)
  const sessionInfo = v2Sessions.get(sessionKey)
  if (!sessionInfo) {
    return { success: false, error: 'No active session for this conversation' }
  }

  const session = sessionInfo.session
  if (!session.toggleMcpServer) {
    return { success: false, error: 'SDK does not support MCP toggle' }
  }

  try {
    console.log(
      `[Agent][${sessionKey}] Toggling MCP server ${serverName}: ${enabled ? 'enable' : 'disable'}`
    )
    await session.toggleMcpServer(serverName, enabled)
    console.log(`[Agent][${sessionKey}] MCP server ${serverName} ${enabled ? 'enabled' : 'disabled'}`)
    return { success: true }
  } catch (error) {
    const err = error as Error
    console.error(`[Agent][${sessionKey}] Failed to toggle MCP server ${serverName}:`, err)
    return { success: false, error: err.message }
  }
}

// ============================================
// Active Session State Management
// ============================================

/**
 * Get active session state for a conversation
 */
export function getActiveSession(spaceId: string, conversationId: string): SessionState | undefined {
  return activeSessions.get(toSessionKey(spaceId, conversationId))
}

/**
 * Set active session state for a conversation
 */
export function setActiveSession(spaceId: string, conversationId: string, state: SessionState): void {
  activeSessions.set(toSessionKey(spaceId, conversationId), state)
}

/**
 * Delete active session state for a conversation
 */
export function deleteActiveSession(spaceId: string, conversationId: string, expectedRunId?: string): void {
  const sessionKey = toSessionKey(spaceId, conversationId)
  if (!expectedRunId) {
    activeSessions.delete(sessionKey)
    return
  }

  const current = activeSessions.get(sessionKey)
  if (!current) {
    return
  }

  if (current.runId !== expectedRunId) {
    console.warn(
      `[Agent][${sessionKey}] Skip deleteActiveSession due to run mismatch: expected=${expectedRunId}, actual=${current.runId}`
    )
    return
  }

  activeSessions.delete(sessionKey)
}

/**
 * Check if a conversation has an active generation
 */
export function isGenerating(spaceId: string, conversationId: string): boolean {
  return activeSessions.has(toSessionKey(spaceId, conversationId))
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): Array<{ spaceId: string; conversationId: string; sessionKey: string }> {
  return Array.from(activeSessions.values()).map((session) => ({
    spaceId: session.spaceId,
    conversationId: session.conversationId,
    sessionKey: toSessionKey(session.spaceId, session.conversationId)
  }))
}

/**
 * Get current session state for a conversation (for recovery after refresh)
 */
export function getSessionState(spaceId: string, conversationId: string): {
  isActive: boolean
  thoughts: import('./types').Thought[]
  processTrace: import('./types').ProcessTraceNode[]
  spaceId?: string
  runId?: string | null
  mode?: ChatMode
  lifecycle?: import('./types').SessionLifecycle | 'idle'
  terminalReason?: import('./types').SessionTerminalReason
} {
  const session = activeSessions.get(toSessionKey(spaceId, conversationId))
  if (!session) {
    return {
      isActive: false,
      thoughts: [],
      processTrace: [],
      runId: null,
      mode: 'code',
      lifecycle: 'idle',
      terminalReason: null
    }
  }
  return {
    isActive: true,
    thoughts: [...session.thoughts],
    processTrace: [...session.processTrace],
    spaceId: session.spaceId,
    runId: session.runId,
    mode: session.mode,
    lifecycle: session.lifecycle,
    terminalReason: session.terminalReason
  }
}

export async function setSessionMode(
  spaceId: string,
  conversationId: string,
  targetMode: unknown,
  runId?: string
): Promise<AgentSetModeResult> {
  if (!isChatMode(targetMode)) {
    return {
      applied: false,
      mode: 'code',
      reason: 'invalid_mode',
      error: `Invalid mode: ${String(targetMode)}`
    }
  }

  const sessionKey = toSessionKey(spaceId, conversationId)
  const sessionState = activeSessions.get(sessionKey)
  if (!sessionState || sessionState.lifecycle !== 'running') {
    return {
      applied: false,
      mode: targetMode,
      reason: 'no_active_session'
    }
  }

  if (hasPendingAskUserQuestionInteraction(sessionState) || sessionState.pendingPermissionResolve) {
    return {
      applied: false,
      mode: sessionState.mode,
      runId: sessionState.runId,
      reason: 'blocked_pending_interaction'
    }
  }

  if (runId && sessionState.runId !== runId) {
    return {
      applied: false,
      mode: sessionState.mode,
      runId: sessionState.runId,
      reason: 'run_id_mismatch'
    }
  }

  const v2SessionInfo = v2Sessions.get(sessionKey)
  if (!v2SessionInfo || typeof v2SessionInfo.session.setPermissionMode !== 'function') {
    return {
      applied: false,
      mode: sessionState.mode,
      runId: sessionState.runId,
      reason: 'sdk_error',
      error: 'Session does not support permission mode switching'
    }
  }

  if (sessionState.mode === targetMode) {
    return {
      applied: true,
      mode: targetMode,
      runId: sessionState.runId
    }
  }

  try {
    await v2SessionInfo.session.setPermissionMode(getPermissionModeForChatMode(targetMode))
    sessionState.mode = targetMode
    touchV2Session(spaceId, conversationId)
    return {
      applied: true,
      mode: targetMode,
      runId: sessionState.runId
    }
  } catch (error) {
    const err = error as Error
    return {
      applied: false,
      mode: sessionState.mode,
      runId: sessionState.runId,
      reason: 'sdk_error',
      error: err.message
    }
  }
}

/**
 * Get V2 session info for a conversation
 */
export function getV2SessionInfo(spaceId: string, conversationId: string): V2SessionInfo | undefined {
  return v2Sessions.get(toSessionKey(spaceId, conversationId))
}

/**
 * Get V2 sessions count
 */
export function getV2SessionsCount(): number {
  return v2Sessions.size
}

/**
 * Get all conversation IDs that currently have V2 sessions.
 */
export function getV2SessionConversationIds(): Array<{ spaceId: string; conversationId: string; sessionKey: string }> {
  return Array.from(v2Sessions.values()).map((sessionInfo) => ({
    spaceId: sessionInfo.spaceId,
    conversationId: sessionInfo.conversationId,
    sessionKey: toSessionKey(sessionInfo.spaceId, sessionInfo.conversationId)
  }))
}
