/**
 * V2 Session Manager
 *
 * Manages V2 SDK Session lifecycle including creation, reuse, and cleanup.
 */

import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { getConfig, onApiConfigChange } from '../config.service'
import { getToolkitHash } from '../toolkit.service'
import { getConversation } from '../conversation.service'
import { getHeadlessElectronPath } from './electron-path'
import { resolveProvider } from './provider-resolver'
import { buildSdkOptions, getWorkingDir, getEffectiveSkillsLazyLoad } from './sdk-config.builder'
import { createCanUseTool } from './renderer-comm'
import type { V2SDKSession, V2SessionInfo, SessionConfig, SessionState } from './types'
import { getEnabledPluginMcpHash, getEnabledPluginMcpList } from '../plugin-mcp.service'

// V2 Session management: Map of conversationId -> persistent V2 session
const v2Sessions = new Map<string, V2SessionInfo>()

// Active session state: Map of conversationId -> session state
const activeSessions = new Map<string, SessionState>()

// Session cleanup interval (clean up sessions not used for 30 minutes)
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
let cleanupIntervalId: NodeJS.Timeout | null = null

/**
 * Start session cleanup interval
 */
function startSessionCleanup(): void {
  if (cleanupIntervalId) return

  cleanupIntervalId = setInterval(() => {
    const now = Date.now()
    for (const [convId, info] of Array.from(v2Sessions.entries())) {
      if (now - info.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        console.log(`[Agent] Cleaning up idle V2 session: ${convId}`)
        try {
          info.session.close()
        } catch (e) {
          console.error(`[Agent] Error closing session ${convId}:`, e)
        }
        v2Sessions.delete(convId)
      }
    }
  }, 60 * 1000)
}

/**
 * Check if session config requires rebuild.
 * Only process-level params need rebuild; runtime params use setXxx() methods.
 */
function needsSessionRebuild(existing: V2SessionInfo, newConfig: SessionConfig): boolean {
  return (
    existing.config.aiBrowserEnabled !== newConfig.aiBrowserEnabled ||
    existing.config.skillsLazyLoad !== newConfig.skillsLazyLoad ||
    (existing.config.toolkitHash || '') !== (newConfig.toolkitHash || '') ||
    (existing.config.enabledPluginMcpsHash || '') !== (newConfig.enabledPluginMcpsHash || '') ||
    // Rebuild if canUseTool presence changed (needed for AskUserQuestion support)
    (existing.config.hasCanUseTool || false) !== (newConfig.hasCanUseTool || false)
  )
}

/**
 * Close and remove an existing V2 session (internal helper for rebuild)
 */
function closeV2SessionForRebuild(conversationId: string): void {
  const existing = v2Sessions.get(conversationId)
  if (existing) {
    console.log(`[Agent][${conversationId}] Closing V2 session for rebuild`)
    try {
      existing.session.close()
    } catch (e) {
      console.error(`[Agent][${conversationId}] Error closing session:`, e)
    }
    v2Sessions.delete(conversationId)
  }
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
  const existing = v2Sessions.get(conversationId)
  if (existing) {
    if (config && needsSessionRebuild(existing, config)) {
      console.log(
        `[Agent][${conversationId}] Config changed (aiBrowser: ${existing.config.aiBrowserEnabled} → ${config.aiBrowserEnabled}), rebuilding session`
      )
      closeV2SessionForRebuild(conversationId)
    } else {
      console.log(`[Agent][${conversationId}] Reusing existing V2 session`)
      existing.lastUsedAt = Date.now()
      return existing.session
    }
  }

  console.log(`[Agent][${conversationId}] Creating new V2 session${sessionId ? ` with resume: ${sessionId}` : ''}`)
  const startTime = Date.now()

  if (sessionId) {
    sdkOptions.resume = sessionId
  }

  const session = (await unstable_v2_createSession(sdkOptions as any)) as unknown as V2SDKSession
  console.log(`[Agent][${conversationId}] V2 session created in ${Date.now() - startTime}ms`)

  v2Sessions.set(conversationId, {
    session,
    spaceId,
    conversationId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    config: config || { aiBrowserEnabled: false, skillsLazyLoad: false, toolkitHash: '', enabledPluginMcpsHash: '' }
  })

  startSessionCleanup()
  return session
}

/**
 * Warm up V2 Session for faster message sending.
 * Called when user switches conversations.
 */
export async function ensureSessionWarm(spaceId: string, conversationId: string): Promise<void> {
  const config = getConfig()
  const workDir = getWorkingDir(spaceId)
  const conversation = getConversation(spaceId, conversationId)
  const sessionId = conversation?.sessionId
  const electronPath = getHeadlessElectronPath()
  const { effectiveLazyLoad: skillsLazyLoad, toolkit } = getEffectiveSkillsLazyLoad(workDir, config)
  const toolkitHash = getToolkitHash(toolkit)

  const abortController = new AbortController()
  const resolved = await resolveProvider(config.api)

  const sdkOptions = buildSdkOptions({
    spaceId,
    conversationId,
    workDir,
    config,
    abortController,
    anthropicApiKey: resolved.anthropicApiKey,
    anthropicBaseUrl: resolved.anthropicBaseUrl,
    sdkModel: resolved.sdkModel,
    electronPath,
    aiBrowserEnabled: false,
    thinkingEnabled: false,
    stderrSuffix: ' (warm)',
    canUseTool: createCanUseTool(workDir, spaceId, conversationId, getActiveSession),
    enabledPluginMcps: getEnabledPluginMcpList(conversationId)
  })

  try {
    console.log(`[Agent] Warming up V2 session: ${conversationId}`)
    await getOrCreateV2Session(
      spaceId,
      conversationId,
      sdkOptions,
      sessionId,
      {
        aiBrowserEnabled: false,
        skillsLazyLoad,
        toolkitHash,
        enabledPluginMcpsHash: getEnabledPluginMcpHash(conversationId),
        hasCanUseTool: true // Session has canUseTool callback
      }
    )
    console.log(`[Agent] V2 session warmed up: ${conversationId}`)
  } catch (error) {
    console.error(`[Agent] Failed to warm up session ${conversationId}:`, error)
  }
}

/**
 * Close V2 session for a conversation
 */
export function closeV2Session(conversationId: string): void {
  const info = v2Sessions.get(conversationId)
  if (info) {
    console.log(`[Agent][${conversationId}] Closing V2 session`)
    try {
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session:`, e)
    }
    v2Sessions.delete(conversationId)
  }
}

/**
 * Close all V2 sessions (for app shutdown)
 */
export function closeAllV2Sessions(): void {
  console.log(`[Agent] Closing all ${v2Sessions.size} V2 sessions`)
  // Avoid TS downlevelIteration requirement
  for (const [convId, info] of Array.from(v2Sessions.entries())) {
    try {
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session ${convId}:`, e)
    }
  }
  v2Sessions.clear()

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

  for (const [convId, info] of Array.from(v2Sessions.entries())) {
    try {
      console.log(`[Agent] Closing session: ${convId}`)
      info.session.close()
    } catch (e) {
      console.error(`[Agent] Error closing session ${convId}:`, e)
    }
  }

  v2Sessions.clear()
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
  conversationId: string,
  serverName: string
): Promise<{ success: boolean; error?: string }> {
  const sessionInfo = v2Sessions.get(conversationId)
  if (!sessionInfo) {
    return { success: false, error: 'No active session for this conversation' }
  }

  const session = sessionInfo.session
  if (!session.reconnectMcpServer) {
    return { success: false, error: 'SDK does not support MCP reconnection' }
  }

  try {
    console.log(`[Agent][${conversationId}] Reconnecting MCP server: ${serverName}`)
    await session.reconnectMcpServer(serverName)
    console.log(`[Agent][${conversationId}] MCP server reconnected: ${serverName}`)
    return { success: true }
  } catch (error) {
    const err = error as Error
    console.error(`[Agent][${conversationId}] Failed to reconnect MCP server ${serverName}:`, err)
    return { success: false, error: err.message }
  }
}

/**
 * Toggle (enable/disable) an MCP server for a specific conversation
 */
export async function toggleMcpServer(
  conversationId: string,
  serverName: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const sessionInfo = v2Sessions.get(conversationId)
  if (!sessionInfo) {
    return { success: false, error: 'No active session for this conversation' }
  }

  const session = sessionInfo.session
  if (!session.toggleMcpServer) {
    return { success: false, error: 'SDK does not support MCP toggle' }
  }

  try {
    console.log(
      `[Agent][${conversationId}] Toggling MCP server ${serverName}: ${enabled ? 'enable' : 'disable'}`
    )
    await session.toggleMcpServer(serverName, enabled)
    console.log(`[Agent][${conversationId}] MCP server ${serverName} ${enabled ? 'enabled' : 'disabled'}`)
    return { success: true }
  } catch (error) {
    const err = error as Error
    console.error(`[Agent][${conversationId}] Failed to toggle MCP server ${serverName}:`, err)
    return { success: false, error: err.message }
  }
}

// ============================================
// Active Session State Management
// ============================================

/**
 * Get active session state for a conversation
 */
export function getActiveSession(conversationId: string): SessionState | undefined {
  return activeSessions.get(conversationId)
}

/**
 * Set active session state for a conversation
 */
export function setActiveSession(conversationId: string, state: SessionState): void {
  activeSessions.set(conversationId, state)
}

/**
 * Delete active session state for a conversation
 */
export function deleteActiveSession(conversationId: string): void {
  activeSessions.delete(conversationId)
}

/**
 * Check if a conversation has an active generation
 */
export function isGenerating(conversationId: string): boolean {
  return activeSessions.has(conversationId)
}

/**
 * Get all active session conversation IDs
 */
export function getActiveSessions(): string[] {
  return Array.from(activeSessions.keys())
}

/**
 * Get current session state for a conversation (for recovery after refresh)
 */
export function getSessionState(conversationId: string): {
  isActive: boolean
  thoughts: import('./types').Thought[]
  spaceId?: string
} {
  const session = activeSessions.get(conversationId)
  if (!session) {
    return { isActive: false, thoughts: [] }
  }
  return {
    isActive: true,
    thoughts: [...session.thoughts],
    spaceId: session.spaceId
  }
}

/**
 * Get V2 session info for a conversation
 */
export function getV2SessionInfo(conversationId: string): V2SessionInfo | undefined {
  return v2Sessions.get(conversationId)
}

/**
 * Get V2 sessions count
 */
export function getV2SessionsCount(): number {
  return v2Sessions.size
}
