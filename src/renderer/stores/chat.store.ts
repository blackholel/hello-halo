/**
 * Chat Store - Conversation and messaging state
 *
 * Architecture:
 * - spaceStates: Map<spaceId, SpaceState> - conversation metadata organized by space
 * - conversationCache: Map<conversationId, Conversation> - full conversations loaded on-demand
 * - sessions: Map<conversationId, SessionState> - runtime state per conversation (cross-space)
 * - currentSpaceId: pointer to active space
 *
 * Performance optimization:
 * - listConversations returns lightweight ConversationMeta (no messages)
 * - Full conversation loaded on-demand when selecting
 * - LRU cache for recently accessed conversations
 *
 * This allows:
 * - Fast space switching (only metadata loaded)
 * - Space switching without losing session states
 * - Multiple conversations running in parallel across spaces
 * - Clean separation of concerns
 */

import { create } from 'zustand'
import { api } from '../api'
import { useAppStore } from './app.store'
import { useTaskStore } from './task.store'
import { normalizeChatMode } from '../types'
import type {
  ChatMode,
  AgentModeEvent,
  Conversation,
  ConversationMeta,
  ConversationAiConfig,
  Message,
  ToolCall,
  Artifact,
  Thought,
  AgentEventBase,
  AgentCompleteEvent,
  AgentProcessEvent,
  ImageAttachment,
  CompactInfo,
  CanvasContext,
  FileContextAttachment,
  ParallelGroup,
  ChangeSet,
  AgentRunLifecycle,
  ToolStatus,
  AskUserQuestionAnswerPayload,
  ProcessTraceNode
} from '../types'
import { canvasLifecycle } from '../services/canvas-lifecycle'
import { buildParallelGroups, getThoughtKey } from '../utils/thought-utils'
import i18n, { getCurrentLanguage } from '../i18n'
import type { InvocationContext } from '../../shared/resource-access'
import { getAiSetupState } from '../../shared/types/ai-profile'

// LRU cache size limit
const CONVERSATION_CACHE_SIZE = 10
const PRE_RUN_BUFFER_TTL_MS = 2000
type ConversationWithAi = Conversation & { ai?: ConversationAiConfig }
type ConversationMetaWithAi = ConversationMeta & { ai?: ConversationAiConfig }

type TerminalReason = 'completed' | 'stopped' | 'error' | 'no_text'
type PendingRunEventKind =
  | 'process'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'thought'
  | 'error'
  | 'complete'
  | 'compact'
  | 'tools_available'

interface PendingRunEvent {
  kind: PendingRunEventKind
  runId: string
  payload: unknown
  receivedAt: number
}

interface AvailableToolsSnapshot {
  runId: string | null
  snapshotVersion: number
  emittedAt: string | null
  tools: string[]
  toolCount: number
}

interface OrphanToolResult {
  result: string
  isError: boolean
}

type AskUserQuestionItemStatus = 'pending' | 'failed' | 'resolved'

interface AskUserQuestionItem {
  id: string
  toolCall: ToolCall
  status: AskUserQuestionItemStatus
  runId: string | null
  updatedAt: number
  errorCode?: string
}

interface QueuedUserTurn {
  id: string
  spaceId: string
  conversationId: string
  content: string
  images?: ImageAttachment[]
  fileContexts?: FileContextAttachment[]
  thinkingEnabled?: boolean
  mode?: ChatMode
  aiBrowserEnabled: boolean
  invocationContext?: InvocationContext
  guided?: boolean
  createdAt: number
}

type QueueDispatchTrigger = 'submit' | 'agent_complete' | 'agent_error' | 'stop_generation'

type DispatchResult =
  | { accepted: true }
  | { accepted: false; error: string; errorCode?: string }

type GuideDispatchResult =
  | { accepted: true; delivery?: 'session_send' | 'ask_user_question_answer' }
  | { accepted: false; error: string; errorCode?: string }

export type QueueSendResult = {
  accepted: boolean
  guided: boolean
  fallbackToNewRun: boolean
  delivery?: 'session_send' | 'ask_user_question_answer'
  error?: string
}

const GUIDE_FALLBACK_TO_NEW_RUN_ERROR_CODES = new Set<string>([
  'ASK_USER_QUESTION_NO_ACTIVE_SESSION',
  'ASK_USER_QUESTION_RUN_MISMATCH'
])

const SPACE_ROUTING_ERROR_CODES = {
  SPACE_CONVERSATION_MISMATCH: 'SPACE_CONVERSATION_MISMATCH',
  SPACE_NOT_FOUND_FOR_WORKDIR: 'SPACE_NOT_FOUND_FOR_WORKDIR',
  CONVERSATION_SPACE_MISMATCH: 'CONVERSATION_SPACE_MISMATCH'
} as const

type SpaceRoutingErrorCode =
  (typeof SPACE_ROUTING_ERROR_CODES)[keyof typeof SPACE_ROUTING_ERROR_CODES]

const NON_RETRIABLE_DISPATCH_ERROR_CODES = new Set<string>(
  Object.values(SPACE_ROUTING_ERROR_CODES)
)

function isNonRetriableDispatchError(
  result: { accepted: boolean; errorCode?: string }
): boolean {
  if (result.accepted) return false
  return typeof result.errorCode === 'string' && NON_RETRIABLE_DISPATCH_ERROR_CODES.has(result.errorCode)
}

function normalizeToolStatus(status: unknown): ToolStatus {
  switch (status) {
    case 'pending':
    case 'running':
    case 'success':
    case 'error':
    case 'waiting_approval':
    case 'cancelled':
    case 'unknown':
      return status
    default:
      console.warn('[ChatStore] Unknown tool status, fallback to unknown:', status)
      return 'unknown'
  }
}

function normalizeLifecycle(lifecycle: unknown): AgentRunLifecycle {
  switch (lifecycle) {
    case 'running':
    case 'completed':
    case 'stopped':
    case 'error':
    case 'idle':
      return lifecycle
    default:
      console.warn('[ChatStore] Unknown lifecycle, fallback to idle:', lifecycle)
      return 'idle'
  }
}

// Per-space state (conversations metadata belong to a space)
interface SpaceState {
  conversations: ConversationMeta[]  // Lightweight metadata, no messages
  currentConversationId: string | null
}

// Per-session runtime state (isolated per conversation, persists across space switches)
interface SessionState {
  activeRunId: string | null
  mode: ChatMode
  modeSwitching: boolean
  lifecycle: AgentRunLifecycle
  terminalReason: TerminalReason | null
  isGenerating: boolean
  streamingContent: string
  isStreaming: boolean  // True during token-level text streaming
  thoughts: Thought[]
  processTrace: ProcessTraceNode[]
  isThinking: boolean
  pendingToolApproval: ToolCall | null
  askUserQuestionsById: Record<string, AskUserQuestionItem>
  askUserQuestionOrder: string[]
  activeAskUserQuestionId: string | null
  error: string | null
  // Compact notification
  compactInfo: CompactInfo | null
  // Text block version - increments on each new text block (for StreamingBubble reset)
  textBlockVersion: number
  toolStatusById: Record<string, ToolStatus>
  toolCallsById: Record<string, ToolCall>
  orphanToolResults: Record<string, OrphanToolResult>
  availableToolsSnapshot: AvailableToolsSnapshot
  pendingRunEvents: PendingRunEvent[]

  // === Tree and parallel group support ===
  // Parallel operation groups (for side-by-side display)
  parallelGroups: Map<string, ParallelGroup>
  // Currently active sub-agent IDs (Task tools that haven't completed)
  activeAgentIds: string[]
  activePlanTabId?: string
}

// Create empty session state
function createEmptySessionState(): SessionState {
  return {
    activeRunId: null,
    mode: 'code',
    modeSwitching: false,
    lifecycle: 'idle',
    terminalReason: null,
    isGenerating: false,
    streamingContent: '',
    isStreaming: false,
    thoughts: [],
    processTrace: [],
    isThinking: false,
    pendingToolApproval: null,
    askUserQuestionsById: {},
    askUserQuestionOrder: [],
    activeAskUserQuestionId: null,
    error: null,
    compactInfo: null,
    textBlockVersion: 0,
    toolStatusById: {},
    toolCallsById: {},
    orphanToolResults: {},
    availableToolsSnapshot: {
      runId: null,
      snapshotVersion: 0,
      emittedAt: null,
      tools: [],
      toolCount: 0
    },
    pendingRunEvents: [],
    // New fields
    parallelGroups: new Map(),
    activeAgentIds: [],
    activePlanTabId: undefined,
  }
}

// Create empty space state
function createEmptySpaceState(): SpaceState {
  return {
    conversations: [],
    currentConversationId: null
  }
}

function prunePendingRunEvents(events: PendingRunEvent[]): PendingRunEvent[] {
  const now = Date.now()
  const kept = events.filter((event) => now - event.receivedAt <= PRE_RUN_BUFFER_TTL_MS)
  if (kept.length !== events.length) {
    console.warn(`[ChatStore] Dropped ${events.length - kept.length} pending run event(s) after TTL`)
  }
  return kept
}

function enqueuePendingRunEvent(
  session: SessionState,
  event: PendingRunEvent
): PendingRunEvent[] {
  const next = [...prunePendingRunEvents(session.pendingRunEvents), event]
  return next
}

function isEventRunAccepted(session: SessionState, runId?: string): boolean {
  if (!runId) {
    return session.lifecycle === 'running' || !session.activeRunId
  }
  if (!session.activeRunId) return false
  if (session.activeRunId !== runId) return false
  return session.lifecycle === 'running'
}

function isThoughtLike(value: unknown): value is Thought {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Thought>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.timestamp === 'string'
  )
}

function ensureAskUserQuestionOrder(
  order: string[],
  byId: Record<string, AskUserQuestionItem>
): string[] {
  return order.filter((id) => Boolean(byId[id]))
}

function hasPendingAskUserQuestion(session: SessionState): boolean {
  return session.askUserQuestionOrder.some((id) => session.askUserQuestionsById[id]?.status === 'pending')
}

function canStartNewRun(session: SessionState): boolean {
  return !session.isGenerating && !hasPendingAskUserQuestion(session) && session.pendingToolApproval === null
}

function getVisibleQueuedTurns(queue: QueuedUserTurn[]): QueuedUserTurn[] {
  return queue
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return fallback
}

function resolveSendErrorMessage(error: string | undefined, errorCode?: string): string {
  if (errorCode === 'AI_PROFILE_NOT_CONFIGURED') {
    return i18n.t('Please configure AI profile first')
  }
  if (errorCode === SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH) {
    return i18n.t('Conversation does not belong to the selected space.')
  }
  if (errorCode === SPACE_ROUTING_ERROR_CODES.CONVERSATION_SPACE_MISMATCH) {
    return i18n.t('Conversation space mapping is invalid.')
  }
  if (errorCode === SPACE_ROUTING_ERROR_CODES.SPACE_NOT_FOUND_FOR_WORKDIR) {
    return i18n.t('Space working directory was not found.')
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return i18n.t('Failed to send message')
}

function toNonEmptyProfileId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function toGuideErrorMessage(error: string | undefined, errorCode?: string): string {
  if (errorCode === 'ASK_USER_QUESTION_NO_ACTIVE_SESSION') {
    return i18n.t('No active run found for guided update.')
  }
  if (errorCode === 'ASK_USER_QUESTION_RUN_MISMATCH') {
    return i18n.t('Guide update no longer matches the current run.')
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return i18n.t('Failed to guide message')
}

function resolveActiveAskUserQuestionId(
  currentActiveId: string | null,
  order: string[],
  byId: Record<string, AskUserQuestionItem>
): string | null {
  if (currentActiveId && byId[currentActiveId]) {
    return currentActiveId
  }
  for (const id of order) {
    const item = byId[id]
    if (!item) continue
    if (item.status === 'pending') return id
  }
  for (const id of order) {
    const item = byId[id]
    if (!item) continue
    if (item.status === 'failed') return id
  }
  return order[0] || null
}

function toProcessTraceNode(event: AgentProcessEvent): ProcessTraceNode {
  return {
    type: 'process',
    kind: event.kind,
    ts: event.ts || new Date().toISOString(),
    visibility: event.visibility,
    payload:
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : { value: event.payload as unknown }
  }
}

function extractThoughtFromProcessEvent(event: AgentProcessEvent): Thought | null {
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : null

  const payloadThought = payload?.thought
  if (isThoughtLike(payloadThought)) {
    return payloadThought
  }

  if (event.kind === 'tool_call' && payload) {
    const toolCallId =
      (typeof payload.toolCallId === 'string' && payload.toolCallId) ||
      (typeof payload.id === 'string' && payload.id) ||
      null
    const toolName = typeof payload.name === 'string' ? payload.name : undefined
    if (!toolCallId || !toolName) {
      return null
    }
    return {
      id: toolCallId,
      type: 'tool_use',
      content: `Tool call: ${toolName}`,
      timestamp: event.ts || new Date().toISOString(),
      toolName,
      toolInput:
        payload.input && typeof payload.input === 'object'
          ? (payload.input as Record<string, unknown>)
          : undefined,
      status: normalizeToolStatus(payload.status)
    }
  }

  if (event.kind === 'tool_result' && payload) {
    const toolCallId =
      (typeof payload.toolCallId === 'string' && payload.toolCallId) ||
      (typeof payload.toolId === 'string' && payload.toolId) ||
      null
    if (!toolCallId) {
      return null
    }
    const isError = payload.isError === true
    const resultText =
      typeof payload.result === 'string'
        ? payload.result
        : payload.result == null
          ? ''
          : JSON.stringify(payload.result)
    return {
      id: toolCallId,
      type: 'tool_result',
      content: isError ? 'Tool execution failed' : 'Tool execution succeeded',
      timestamp: event.ts || new Date().toISOString(),
      toolOutput: resultText,
      isError,
      status: isError ? 'error' : 'success'
    }
  }

  return null
}

function isRunningLikeToolStatus(status?: ToolStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'waiting_approval'
}

function cancelRunningTools(toolStatusById: Record<string, ToolStatus>): Record<string, ToolStatus> {
  const next: Record<string, ToolStatus> = { ...toolStatusById }
  for (const toolCallId of Object.keys(next)) {
    if (next[toolCallId] === 'running' || next[toolCallId] === 'pending' || next[toolCallId] === 'waiting_approval') {
      next[toolCallId] = 'cancelled'
    }
  }
  return next
}

interface ChatState {
  // Per-space state: Map<spaceId, SpaceState>
  spaceStates: Map<string, SpaceState>

  // Conversation cache: Map<conversationId, Conversation>
  // Full conversations loaded on-demand, with LRU eviction
  conversationCache: Map<string, Conversation>

  // Per-session runtime state: Map<conversationId, SessionState>
  // This persists across space switches - background tasks keep running
  sessions: Map<string, SessionState>

  // Change sets per conversation (persisted on disk, loaded on demand)
  changeSets: Map<string, ChangeSet[]>

  // Current space pointer
  currentSpaceId: string | null

  // Artifacts (per space)
  artifacts: Artifact[]

  // Loading
  isLoading: boolean
  loadingConversationCounts: Map<string, number>
  queuedTurnsByConversation: Map<string, QueuedUserTurn[]>
  queueDispatchingByConversation: Map<string, boolean>
  queueErrorByConversation: Map<string, string | null>
  queueInFlightTurnByConversation: Map<string, string>
  queueSuppressedRestoreByConversation: Map<string, Set<string>>

  // Computed getters
  getCurrentSpaceState: () => SpaceState
  getSpaceState: (spaceId: string) => SpaceState
  getCurrentConversation: () => Conversation | null
  getCurrentConversationMeta: () => ConversationMeta | null
  getCurrentSession: () => SessionState
  getSession: (conversationId: string) => SessionState
  getConversationMode: (conversationId: string) => ChatMode
  getPlanEnabled: (conversationId: string) => boolean
  setPlanEnabled: (conversationId: string, enabled: boolean) => void
  setConversationMode: (spaceId: string, conversationId: string, mode: ChatMode) => Promise<boolean>
  getChangeSets: (conversationId: string) => ChangeSet[]
  getConversations: () => ConversationMeta[]
  getCurrentConversationId: () => string | null
  getCachedConversation: (conversationId: string) => Conversation | null
  isConversationLoading: (conversationId: string) => boolean

  // Space actions
  setCurrentSpace: (spaceId: string) => void

  // Conversation actions
  loadConversations: (spaceId: string) => Promise<void>
  createConversation: (spaceId: string, title?: string) => Promise<Conversation | null>
  ensureConversationLoaded: (
    spaceId: string,
    conversationId: string,
    options?: { setCurrent?: boolean; subscribe?: boolean; warmSession?: boolean }
  ) => Promise<void>
  selectConversation: (conversationId: string) => Promise<void>
  hydrateConversation: (spaceId: string, conversationId: string) => Promise<void>
  deleteConversation: (spaceId: string, conversationId: string) => Promise<boolean>
  renameConversation: (spaceId: string, conversationId: string, newTitle: string) => Promise<boolean>
  updateConversationAi: (spaceId: string, conversationId: string, ai: ConversationAiConfig) => Promise<boolean>

  // Messaging
  sendMessage: (content: string, images?: ImageAttachment[], aiBrowserEnabled?: boolean, thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], mode?: ChatMode, invocationContext?: InvocationContext) => Promise<void>
  sendMessageToConversation: (
    spaceId: string,
    conversationId: string,
    content: string,
    images?: ImageAttachment[],
    thinkingEnabled?: boolean,
    fileContexts?: FileContextAttachment[],
    aiBrowserEnabled?: boolean,
    mode?: ChatMode,
    invocationContext?: InvocationContext
  ) => Promise<void>
  submitTurn: (turn: {
    spaceId: string
    conversationId: string
    content: string
    images?: ImageAttachment[]
    fileContexts?: FileContextAttachment[]
    thinkingEnabled?: boolean
    mode?: ChatMode
    aiBrowserEnabled: boolean
    invocationContext?: InvocationContext
  }) => Promise<void>
  flushQueuedTurns: (conversationId: string, trigger: QueueDispatchTrigger) => Promise<void>
  clearConversationQueue: (conversationId: string) => void
  removeQueuedTurn: (conversationId: string, turnId: string) => void
  sendQueuedTurn: (conversationId: string, turnId: string) => Promise<QueueSendResult>
  clearQueueError: (conversationId: string) => void
  getQueueCount: (conversationId: string) => number
  getQueueError: (conversationId: string) => string | null
  getQueuedTurns: (conversationId: string) => QueuedUserTurn[]
  dispatchTurnInternal: (turn: QueuedUserTurn) => Promise<DispatchResult>
  dispatchGuidedTurnInternal: (turn: QueuedUserTurn) => Promise<GuideDispatchResult>
  executePlan: (spaceId: string, conversationId: string, planContent: string) => Promise<void>
  stopGeneration: (conversationId?: string) => Promise<void>

  // Tool approval
  approveTool: (conversationId: string) => Promise<void>
  rejectTool: (conversationId: string) => Promise<void>
  answerQuestion: (conversationId: string, answer: AskUserQuestionAnswerPayload) => Promise<void>
  dismissAskUserQuestion: (conversationId: string, toolCallId?: string) => void
  setActiveAskUserQuestion: (conversationId: string, toolCallId: string) => void

  // Event handlers (called from App component) - with session IDs
  handleAgentRunStart: (data: AgentEventBase & { runId: string; startedAt: string }) => void
  handleAgentMessage: (data: AgentEventBase & { content: string; isComplete: boolean }) => void
  handleAgentProcess: (data: AgentProcessEvent) => void
  handleAgentToolCall: (data: AgentEventBase & ToolCall) => void
  handleAgentToolResult: (data: AgentEventBase & { toolCallId?: string; toolId?: string; result: string; isError: boolean }) => void
  handleAgentError: (data: AgentEventBase & { error: string }) => void
  handleAgentComplete: (data: AgentCompleteEvent) => void
  handleAgentMode: (data: AgentModeEvent) => void
  handleAgentThought: (data: AgentEventBase & { thought: Thought }) => void
  handleAgentCompact: (data: AgentEventBase & { trigger: 'manual' | 'auto'; preTokens: number }) => void
  handleAgentToolsAvailable: (data: AgentEventBase & { runId: string; snapshotVersion: number; emittedAt: string; tools: string[]; toolCount: number }) => void

  // Change set actions
  loadChangeSets: (spaceId: string, conversationId: string) => Promise<void>
  acceptChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string }) => Promise<ChangeSet | null>
  rollbackChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string; force?: boolean }) => Promise<{ changeSet: ChangeSet | null; conflicts: string[] }>

  // Cleanup
  reset: () => void
  resetSpace: (spaceId: string) => void
}

// Default empty states
const EMPTY_SESSION: SessionState = createEmptySessionState()
const EMPTY_SPACE_STATE: SpaceState = createEmptySpaceState()

interface EnsureConversationLoadedOptions {
  setCurrent?: boolean
  subscribe?: boolean
  warmSession?: boolean
}

function setConversationLoadingState(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  conversationId: string,
  loading: boolean
): void {
  set((state) => {
    const nextLoadingCounts = new Map(state.loadingConversationCounts)
    const currentCount = nextLoadingCounts.get(conversationId) || 0
    const nextCount = loading ? currentCount + 1 : Math.max(0, currentCount - 1)

    if (nextCount === 0) {
      nextLoadingCounts.delete(conversationId)
    } else {
      nextLoadingCounts.set(conversationId, nextCount)
    }

    return { loadingConversationCounts: nextLoadingCounts }
  })
}

function resolveConversationMode(
  state: ChatState,
  spaceId: string,
  conversationId: string,
  fallback: ChatMode = 'code'
): ChatMode {
  const sessionMode = state.sessions.get(conversationId)?.mode
  if (sessionMode) {
    return normalizeChatMode(sessionMode, undefined, fallback)
  }
  const cachedMode = (state.conversationCache.get(conversationId) as (Conversation & { mode?: ChatMode }) | undefined)?.mode
  if (cachedMode) {
    return normalizeChatMode(cachedMode, undefined, fallback)
  }
  const metaMode = state.spaceStates
    .get(spaceId)
    ?.conversations.find((conversation) => conversation.id === conversationId)?.mode
  return normalizeChatMode(metaMode, undefined, fallback)
}

/**
 * Auto-open plan tab in Canvas when the last message is a plan response.
 * Only opens for the currently active conversation to avoid background sessions stealing focus.
 */
async function autoOpenPlanTab(
  conversation: Conversation,
  spaceId: string,
  conversationId: string,
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
): Promise<void> {
  const lastMessage = conversation.messages?.[conversation.messages.length - 1]
  if (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.isPlan) {
    return
  }

  // Only auto-open for the currently active conversation
  const isActiveConversation =
    get().currentSpaceId === spaceId &&
    get().getCurrentConversationId() === conversationId

  if (!isActiveConversation) {
    return
  }

  const planTabId = await canvasLifecycle.openPlan(
    lastMessage.content,
    i18n.t('Plan'),
    spaceId,
    conversationId
  )

  set((state) => {
    const newSessions = new Map(state.sessions)
    const session = newSessions.get(conversationId)
    if (session) {
      newSessions.set(conversationId, {
        ...session,
        activePlanTabId: planTabId,
      })
    }
    return { sessions: newSessions }
  })
}

async function ensureConversationLoadedImpl(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  spaceId: string,
  conversationId: string,
  options: EnsureConversationLoadedOptions = {}
): Promise<void> {
  const { setCurrent = true, subscribe = true, warmSession = true } = options
  const { spaceStates, conversationCache } = get()
  const spaceState = spaceStates.get(spaceId)
  if (!spaceState) return

  const conversationMeta = spaceState.conversations.find((c) => c.id === conversationId)
  if (!conversationMeta) return

  if (subscribe) {
    api.subscribeToConversation(conversationId)
  }

  if (setCurrent) {
    set((state) => {
      const latest = state.spaceStates.get(spaceId)
      if (!latest) return {}
      const newSpaceStates = new Map(state.spaceStates)
      newSpaceStates.set(spaceId, {
        ...latest,
        currentConversationId: conversationId
      })
      return { spaceStates: newSpaceStates }
    })
  }

  const needsConversationLoad = !conversationCache.has(conversationId)
  if (needsConversationLoad) {
    setConversationLoadingState(set, conversationId, true)
  }

  try {
    const conversationPromise = needsConversationLoad
      ? api.getConversation(spaceId, conversationId)
      : Promise.resolve(null)
    const sessionStatePromise = api.getSessionState(conversationId)
    const changeSetsPromise = api.listChangeSets(spaceId, conversationId)

    const [conversationResponse, sessionResponse, changeSetsResponse] = await Promise.all([
      conversationPromise,
      sessionStatePromise,
      changeSetsPromise
    ])

    if (conversationResponse?.success && conversationResponse.data) {
      const fullConversation = conversationResponse.data as Conversation & { mode?: ChatMode }
      const normalizedMode = normalizeChatMode(fullConversation.mode)
      set((state) => {
        const newCache = new Map(state.conversationCache)
        newCache.set(conversationId, {
          ...fullConversation,
          mode: normalizedMode
        } as Conversation)
        if (newCache.size > CONVERSATION_CACHE_SIZE) {
          const firstKey = newCache.keys().next().value
          if (firstKey) newCache.delete(firstKey)
        }

        const newSessions = new Map(state.sessions)
        const existingSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...(existingSession || createEmptySessionState()),
          mode: normalizedMode
        })

        return {
          conversationCache: newCache,
          sessions: newSessions
        }
      })
    }

    if (sessionResponse.success && sessionResponse.data) {
      const sessionState = sessionResponse.data as {
        isActive: boolean
        thoughts: Thought[]
        processTrace?: ProcessTraceNode[]
        spaceId?: string
        mode?: ChatMode
      }
      const recoveredProcessTrace = Array.isArray(sessionState.processTrace)
        ? sessionState.processTrace
        : []
      const recoveredThoughtsFromTrace = recoveredProcessTrace
        .map((node) =>
          extractThoughtFromProcessEvent({
            type: 'process',
            kind: node.kind || node.type || 'thought',
            payload: node.payload || {},
            ts: node.ts || node.timestamp,
            visibility: node.visibility,
            spaceId: sessionState.spaceId || spaceId,
            conversationId
          })
        )
        .filter((thought): thought is Thought => thought !== null)
      const recoveredThoughts =
        recoveredThoughtsFromTrace.length > 0 ? recoveredThoughtsFromTrace : sessionState.thoughts

      if (
        sessionState.isActive &&
        (recoveredThoughts.length > 0 || recoveredProcessTrace.length > 0)
      ) {
        set((state) => {
          const newSessions = new Map(state.sessions)
          const existingSession = newSessions.get(conversationId) || createEmptySessionState()
          newSessions.set(conversationId, {
            ...existingSession,
            mode: normalizeChatMode(
              sessionState.mode,
              undefined,
              resolveConversationMode(state, spaceId, conversationId)
            ),
            isGenerating: true,
            isThinking: true,
            thoughts: recoveredThoughts,
            processTrace: recoveredProcessTrace
          })
          return { sessions: newSessions }
        })
      }
    }

    if (changeSetsResponse.success && changeSetsResponse.data) {
      const changeSets = changeSetsResponse.data as ChangeSet[]
      set((state) => {
        const newChangeSets = new Map(state.changeSets)
        newChangeSets.set(conversationId, changeSets)
        return { changeSets: newChangeSets }
      })
    }
  } catch (error) {
    console.error('[ChatStore] Failed to load conversation or session state:', error)
  } finally {
    if (needsConversationLoad) {
      setConversationLoadingState(set, conversationId, false)
    }
  }

  if (warmSession) {
    try {
      api.ensureSessionWarm(spaceId, conversationId, getCurrentLanguage())
        .catch((error) => console.error('[ChatStore] Session warm up failed:', error))
    } catch (error) {
      console.error('[ChatStore] Failed to trigger session warm up:', error)
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  spaceStates: new Map<string, SpaceState>(),
  conversationCache: new Map<string, Conversation>(),
  sessions: new Map<string, SessionState>(),
  changeSets: new Map<string, ChangeSet[]>(),
  currentSpaceId: null,
  artifacts: [],
  isLoading: false,
  loadingConversationCounts: new Map<string, number>(),
  queuedTurnsByConversation: new Map<string, QueuedUserTurn[]>(),
  queueDispatchingByConversation: new Map<string, boolean>(),
  queueErrorByConversation: new Map<string, string | null>(),
  queueInFlightTurnByConversation: new Map<string, string>(),
  queueSuppressedRestoreByConversation: new Map<string, Set<string>>(),

  // Get current space state
  getCurrentSpaceState: () => {
    const { spaceStates, currentSpaceId } = get()
    if (!currentSpaceId) return EMPTY_SPACE_STATE
    return spaceStates.get(currentSpaceId) || EMPTY_SPACE_STATE
  },

  // Get space state by ID
  getSpaceState: (spaceId: string) => {
    const { spaceStates } = get()
    return spaceStates.get(spaceId) || EMPTY_SPACE_STATE
  },

  // Get current conversation (full, from cache)
  getCurrentConversation: () => {
    const spaceState = get().getCurrentSpaceState()
    if (!spaceState.currentConversationId) return null
    return get().conversationCache.get(spaceState.currentConversationId) || null
  },

  // Get current conversation metadata (lightweight)
  getCurrentConversationMeta: () => {
    const spaceState = get().getCurrentSpaceState()
    if (!spaceState.currentConversationId) return null
    return spaceState.conversations.find((c) => c.id === spaceState.currentConversationId) || null
  },

  // Get conversations metadata for current space
  getConversations: () => {
    return get().getCurrentSpaceState().conversations
  },

  // Get current conversation ID
  getCurrentConversationId: () => {
    return get().getCurrentSpaceState().currentConversationId
  },

  // Get cached conversation by ID
  getCachedConversation: (conversationId: string) => {
    return get().conversationCache.get(conversationId) || null
  },

  isConversationLoading: (conversationId: string) => {
    return (get().loadingConversationCounts.get(conversationId) || 0) > 0
  },

  // Get current session state (for the currently viewed conversation)
  getCurrentSession: () => {
    const spaceState = get().getCurrentSpaceState()
    if (!spaceState.currentConversationId) return EMPTY_SESSION
    return get().sessions.get(spaceState.currentConversationId) || EMPTY_SESSION
  },

  // Get session state for any conversation
  getSession: (conversationId: string) => {
    return get().sessions.get(conversationId) || EMPTY_SESSION
  },

  getQueueCount: (conversationId: string) => {
    const queue = get().queuedTurnsByConversation.get(conversationId) || []
    return getVisibleQueuedTurns(queue).length
  },

  getQueueError: (conversationId: string) => {
    return get().queueErrorByConversation.get(conversationId) || null
  },

  getQueuedTurns: (conversationId: string) => {
    const queue = get().queuedTurnsByConversation.get(conversationId) || []
    return getVisibleQueuedTurns(queue)
  },

  getConversationMode: (conversationId: string) => {
    const state = get()
    const sessionMode = state.sessions.get(conversationId)?.mode
    if (sessionMode) {
      return normalizeChatMode(sessionMode)
    }

    const cachedMode = (state.conversationCache.get(conversationId) as (Conversation & { mode?: ChatMode }) | undefined)?.mode
    if (cachedMode) {
      return normalizeChatMode(cachedMode)
    }

    for (const [spaceId, spaceState] of state.spaceStates.entries()) {
      if (spaceState.conversations.some(conversation => conversation.id === conversationId)) {
        return resolveConversationMode(state, spaceId, conversationId)
      }
    }

    return 'code'
  },

  getPlanEnabled: (conversationId: string) => {
    return get().getConversationMode(conversationId) === 'plan'
  },

  setPlanEnabled: (conversationId: string, enabled: boolean) => {
    const state = get()
    let targetSpaceId = state.currentSpaceId

    if (!targetSpaceId) {
      for (const [spaceId, spaceState] of state.spaceStates.entries()) {
        if (spaceState.conversations.some(conversation => conversation.id === conversationId)) {
          targetSpaceId = spaceId
          break
        }
      }
    }

    if (!targetSpaceId) {
      set((prevState) => {
        const newSessions = new Map(prevState.sessions)
        const previousSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...(previousSession || createEmptySessionState()),
          mode: enabled ? 'plan' : 'code'
        })
        return { sessions: newSessions }
      })
      return
    }

    void get().setConversationMode(targetSpaceId, conversationId, enabled ? 'plan' : 'code')
  },

  setConversationMode: async (spaceId, conversationId, mode) => {
    const targetMode = normalizeChatMode(mode)
    const snapshot = get()
    const snapshotSession = snapshot.sessions.get(conversationId) || createEmptySessionState()
    const previousMode = resolveConversationMode(
      snapshot,
      spaceId,
      conversationId,
      snapshotSession.mode
    )
    if (snapshotSession.modeSwitching) {
      return false
    }
    if (previousMode === targetMode) {
      return true
    }

    const applyLocalMode = (
      nextMode: ChatMode,
      modeSwitching: boolean,
      nextError?: string | null
    ) => {
      set((state) => {
        const newSessions = new Map(state.sessions)
        const prevSession = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...prevSession,
          mode: nextMode,
          modeSwitching,
          error: nextError === undefined ? prevSession.error : nextError
        })

        const newCache = new Map(state.conversationCache)
        const cached = newCache.get(conversationId) as (Conversation & { mode?: ChatMode }) | undefined
        if (cached) {
          newCache.set(conversationId, {
            ...cached,
            mode: nextMode
          })
        }

        const newSpaceStates = new Map(state.spaceStates)
        const spaceState = newSpaceStates.get(spaceId)
        if (spaceState) {
          newSpaceStates.set(spaceId, {
            ...spaceState,
            conversations: spaceState.conversations.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, mode: nextMode }
                : conversation
            )
          })
        }

        return {
          sessions: newSessions,
          conversationCache: newCache,
          spaceStates: newSpaceStates
        }
      })
    }

    applyLocalMode(previousMode, true, null)
    const isRunning = snapshotSession.lifecycle === 'running' && Boolean(snapshotSession.activeRunId)
    let runtimeApplied = false

    try {
      if (isRunning) {
        const runtimeResponse = await api.setAgentMode(
          conversationId,
          targetMode,
          snapshotSession.activeRunId || undefined
        )
        const runtimeData = runtimeResponse.success ? runtimeResponse.data : null
        if (!runtimeResponse.success || !runtimeData) {
          applyLocalMode(previousMode, false, runtimeResponse.error || 'Failed to switch mode')
          return false
        }

        if (!runtimeData.applied && runtimeData.reason !== 'no_active_session') {
          applyLocalMode(previousMode, false, runtimeData.error || runtimeData.reason || 'Failed to switch mode')
          return false
        }
        runtimeApplied = runtimeData.applied
      }

      const persistResponse = await api.updateConversation(spaceId, conversationId, { mode: targetMode })
      if (!persistResponse.success) {
        if (runtimeApplied) {
          try {
            await api.setAgentMode(
              conversationId,
              previousMode,
              snapshotSession.activeRunId || undefined
            )
          } catch (rollbackError) {
            console.error('[ChatStore] Failed to compensate runtime mode switch:', rollbackError)
          }
        }
        applyLocalMode(previousMode, false, persistResponse.error || 'Failed to persist mode')
        return false
      }

      applyLocalMode(targetMode, false, null)
      if (!isRunning) {
        api.setAgentMode(conversationId, targetMode).catch((runtimeSyncError) => {
          console.warn('[ChatStore] Best-effort runtime mode sync failed:', runtimeSyncError)
        })
      }
      return true
    } catch (error) {
      console.error('[ChatStore] Failed to switch conversation mode:', error)
      if (runtimeApplied) {
        try {
          await api.setAgentMode(
            conversationId,
            previousMode,
            snapshotSession.activeRunId || undefined
          )
        } catch (rollbackError) {
          console.error('[ChatStore] Failed to compensate runtime mode switch:', rollbackError)
        }
      }
      applyLocalMode(previousMode, false, 'Failed to switch mode')
      return false
    }
  },

  getChangeSets: (conversationId: string) => {
    return get().changeSets.get(conversationId) || []
  },

  // Set current space (called when entering a space)
  setCurrentSpace: (spaceId: string) => {
    set({ currentSpaceId: spaceId })
  },

  // Load conversations for a space (returns lightweight metadata)
  loadConversations: async (spaceId) => {
    try {
      set({ isLoading: true })

      const response = await api.listConversations(spaceId)

      if (response.success && response.data) {
        // Now receives ConversationMeta[] (lightweight, no messages)
        const conversations = (response.data as ConversationMetaWithAi[]).map((conversation) => ({
          ...conversation,
          mode: normalizeChatMode((conversation as { mode?: ChatMode }).mode)
        }))

        set((state) => {
          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId) || createEmptySpaceState()

          newSpaceStates.set(spaceId, {
            ...existingState,
            conversations
          })

          return { spaceStates: newSpaceStates }
        })
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  // Create new conversation
  createConversation: async (spaceId, title) => {
    try {
      const response = await api.createConversation(spaceId, title)

      if (response.success && response.data) {
        const newConversation = response.data as ConversationWithAi & { mode?: ChatMode }
        const mode = normalizeChatMode(newConversation.mode)

        // Extract metadata for the list
        const meta: ConversationMetaWithAi = {
          id: newConversation.id,
          spaceId: newConversation.spaceId,
          title: newConversation.title,
          mode,
          createdAt: newConversation.createdAt,
          updatedAt: newConversation.updatedAt,
          messageCount: newConversation.messages?.length || 0,
          preview: undefined,
          ai: newConversation.ai
        }

        set((state) => {
          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId) || createEmptySpaceState()

          // Add to conversation cache (new conversation is full)
          const newCache = new Map(state.conversationCache)
          newCache.set(newConversation.id, {
            ...newConversation,
            mode
          } as Conversation)

          // LRU eviction
          if (newCache.size > CONVERSATION_CACHE_SIZE) {
            const firstKey = newCache.keys().next().value
            if (firstKey) newCache.delete(firstKey)
          }

          newSpaceStates.set(spaceId, {
            conversations: [meta, ...existingState.conversations],
            currentConversationId: newConversation.id
          })

          return { spaceStates: newSpaceStates, conversationCache: newCache }
        })

        return newConversation
      }

      return null
    } catch (error) {
      console.error('Failed to create conversation:', error)
      return null
    }
  },

  ensureConversationLoaded: async (spaceId, conversationId, options = {}) => {
    await ensureConversationLoadedImpl(set, get, spaceId, conversationId, options)
  },

  // Select conversation (changes pointer, loads full conversation on-demand)
  selectConversation: async (conversationId) => {
    const currentSpaceId = get().currentSpaceId
    if (!currentSpaceId) return
    await ensureConversationLoadedImpl(set, get, currentSpaceId, conversationId, {
      setCurrent: true,
      subscribe: true,
      warmSession: true
    })
  },

  // Hydrate conversation state for background tab usage without changing main pointer
  hydrateConversation: async (spaceId, conversationId) => {
    await ensureConversationLoadedImpl(set, get, spaceId, conversationId, {
      setCurrent: false,
      subscribe: true,
      warmSession: true
    })
  },

  // Delete conversation
  deleteConversation: async (spaceId, conversationId) => {
    try {
      const response = await api.deleteConversation(spaceId, conversationId)

      if (response.success) {
        set((state) => {
          // Clean up session state
          const newSessions = new Map(state.sessions)
          newSessions.delete(conversationId)

          // Clean up cache
          const newCache = new Map(state.conversationCache)
          newCache.delete(conversationId)

          // Clean up change sets
          const newChangeSets = new Map(state.changeSets)
          newChangeSets.delete(conversationId)
          const newLoadingConversationCounts = new Map(state.loadingConversationCounts)
          newLoadingConversationCounts.delete(conversationId)
          const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
          queuedTurnsByConversation.delete(conversationId)
          const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
          queueDispatchingByConversation.delete(conversationId)
          const queueErrorByConversation = new Map(state.queueErrorByConversation)
          queueErrorByConversation.delete(conversationId)
          const queueInFlightTurnByConversation = new Map(state.queueInFlightTurnByConversation)
          queueInFlightTurnByConversation.delete(conversationId)
          const queueSuppressedRestoreByConversation = new Map(state.queueSuppressedRestoreByConversation)
          queueSuppressedRestoreByConversation.delete(conversationId)

          // Update space state
          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId) || createEmptySpaceState()
          const newConversations = existingState.conversations.filter((c) => c.id !== conversationId)
          const nextCurrentConversationId =
            existingState.currentConversationId === conversationId
              ? (newConversations[0]?.id || null)
              : existingState.currentConversationId

          newSpaceStates.set(spaceId, {
            conversations: newConversations,
            currentConversationId: nextCurrentConversationId
          })

          return {
            spaceStates: newSpaceStates,
            sessions: newSessions,
            conversationCache: newCache,
            changeSets: newChangeSets,
            loadingConversationCounts: newLoadingConversationCounts,
            queuedTurnsByConversation,
            queueDispatchingByConversation,
            queueErrorByConversation,
            queueInFlightTurnByConversation,
            queueSuppressedRestoreByConversation
          }
        })

        return true
      }

      return false
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      return false
    }
  },

  // Rename conversation
  renameConversation: async (spaceId, conversationId, newTitle) => {
    try {
      const response = await api.updateConversation(spaceId, conversationId, { title: newTitle })

      if (response.success) {
        set((state) => {
          // Update cache if exists
          const newCache = new Map(state.conversationCache)
          const cached = newCache.get(conversationId)
          if (cached) {
            newCache.set(conversationId, {
              ...cached,
              title: newTitle,
              updatedAt: new Date().toISOString()
            })
          }

          // Update space state metadata
          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId)
          if (existingState) {
            newSpaceStates.set(spaceId, {
              ...existingState,
              conversations: existingState.conversations.map((c) =>
                c.id === conversationId
                  ? { ...c, title: newTitle, updatedAt: new Date().toISOString() }
                  : c
              )
            })
          }

          return {
            spaceStates: newSpaceStates,
            conversationCache: newCache
          }
        })

        return true
      }

      return false
    } catch (error) {
      console.error('Failed to rename conversation:', error)
      return false
    }
  },

  updateConversationAi: async (spaceId, conversationId, ai) => {
    try {
      const response = await api.updateConversation(spaceId, conversationId, { ai })

      if (response.success && response.data) {
        const updatedConversation = response.data as ConversationWithAi

        set((state) => {
          const newCache = new Map(state.conversationCache)
          const cached = newCache.get(conversationId)
          if (cached) {
            newCache.set(conversationId, {
              ...cached,
              ai: updatedConversation.ai,
              updatedAt: updatedConversation.updatedAt
            } as Conversation)
          }

          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId)
          if (existingState) {
            newSpaceStates.set(spaceId, {
              ...existingState,
              conversations: existingState.conversations.map((conversation) =>
                conversation.id === conversationId
                  ? {
                      ...conversation,
                      ai: updatedConversation.ai,
                      updatedAt: updatedConversation.updatedAt
                    }
                  : conversation
              )
            })
          }

          return {
            spaceStates: newSpaceStates,
            conversationCache: newCache
          }
        })

        return true
      }

      return false
    } catch (error) {
      console.error('Failed to update conversation ai config:', error)
      return false
    }
  },

  // Send message (with optional images for multi-modal, optional AI Browser and thinking mode, optional file contexts, optional mode)
  sendMessage: async (content, images, aiBrowserEnabled, thinkingEnabled, fileContexts, mode, invocationContext) => {
    const conversation = get().getCurrentConversation()
    const conversationMeta = get().getCurrentConversationMeta()
    const { currentSpaceId } = get()

    if ((!conversation && !conversationMeta) || !currentSpaceId) {
      console.error('[ChatStore] No conversation or space selected')
      return
    }

    const conversationId = conversationMeta?.id || conversation?.id
    if (!conversationId) return
    await get().submitTurn({
      spaceId: currentSpaceId,
      conversationId,
      content,
      images,
      fileContexts,
      thinkingEnabled,
      mode,
      aiBrowserEnabled: aiBrowserEnabled ?? false,
      invocationContext
    })
  },

  // Send message to a specific conversation (for Chat Tabs - avoids global context switching)
  sendMessageToConversation: async (spaceId, conversationId, content, images, thinkingEnabled, fileContexts, aiBrowserEnabled, mode, invocationContext) => {
    if (!spaceId || !conversationId) {
      console.error('[ChatStore] spaceId and conversationId are required')
      return
    }
    const snapshot = get()
    const conversationProfileId =
      toNonEmptyProfileId(snapshot.conversationCache.get(conversationId)?.ai?.profileId) ??
      toNonEmptyProfileId(
        snapshot.spaceStates
          .get(spaceId)
          ?.conversations.find((conversation) => conversation.id === conversationId)
          ?.ai?.profileId
      )
    const aiSetupState = getAiSetupState(useAppStore.getState().config, conversationProfileId)
    if (!aiSetupState.configured) {
      console.warn('[ChatStore] sendMessageToConversation blocked by ai setup guard', {
        spaceId,
        conversationId,
        conversationProfileId: conversationProfileId || null,
        reason: aiSetupState.reason
      })
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: i18n.t('Please configure AI profile first'),
          isGenerating: false,
          isThinking: false,
          isStreaming: false,
          activePlanTabId: session.activePlanTabId,
        })
        return { sessions: newSessions }
      })
      return
    }

    const snapshotSession = get().sessions.get(conversationId)
    const effectiveMode = normalizeChatMode(mode, undefined, snapshotSession?.mode || 'code')

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        const latestSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          mode: effectiveMode,
          lifecycle: 'running',
          terminalReason: null,
          isGenerating: true,
          isThinking: true,
          activePlanTabId: latestSession?.activePlanTabId,
        })
        return { sessions: newSessions }
      })

      // Add user message to UI immediately
      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        images: images
      }

      set((state) => {
        // Update cache if conversation is loaded
        const newCache = new Map(state.conversationCache)
        const cached = newCache.get(conversationId)
        if (cached) {
          newCache.set(conversationId, {
            ...cached,
            messages: [...cached.messages, userMessage],
            updatedAt: new Date().toISOString()
          })
        }

        // Update metadata (messageCount)
        const newSpaceStates = new Map(state.spaceStates)
        const spaceState = newSpaceStates.get(spaceId)
        if (spaceState) {
          newSpaceStates.set(spaceId, {
            ...spaceState,
            conversations: spaceState.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, messageCount: c.messageCount + 1, updatedAt: new Date().toISOString() }
                : c
            )
          })
        }
        return { spaceStates: newSpaceStates, conversationCache: newCache }
      })

      const context = invocationContext || 'interactive'
      if (context !== 'interactive' && context !== 'workflow-step') {
        throw new Error(`Unsupported invocationContext from renderer: ${context}`)
      }

      const baseRequest = {
        spaceId,
        conversationId,
        message: content,
        responseLanguage: getCurrentLanguage(),
        images: images,
        aiBrowserEnabled: aiBrowserEnabled ?? false,
        thinkingEnabled,
        mode: effectiveMode,
        planEnabled: effectiveMode === 'plan',
        canvasContext: undefined, // No canvas context for tab messages
        fileContexts: fileContexts
      }

      if (context === 'workflow-step') {
        const response = await api.sendWorkflowStepMessage(baseRequest)
        if (!response.success) {
          console.error('[ChatStore] sendWorkflowStepMessage (tab) failed', {
            spaceId,
            conversationId,
            errorCode: response.errorCode,
            error: response.error
          })
          throw new Error(resolveSendErrorMessage(response.error, response.errorCode))
        }
      } else {
        const response = await api.sendMessage({
          ...baseRequest,
          invocationContext: 'interactive'
        })
        if (!response.success) {
          console.error('[ChatStore] sendMessage (tab) API failed', {
            spaceId,
            conversationId,
            errorCode: response.errorCode,
            error: response.error
          })
          throw new Error(resolveSendErrorMessage(response.error, response.errorCode))
        }
      }
    } catch (error) {
      const reason = toErrorMessage(error, i18n.t('Failed to send message'))
      console.error('[ChatStore] Failed to send message to conversation:', error)
      // Update session error state
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: reason,
          isGenerating: false,
          isThinking: false,
          activePlanTabId: session.activePlanTabId,
        })
        return { sessions: newSessions }
      })
    }
  },

  clearConversationQueue: (conversationId: string) => {
    set((state) => {
      const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
      queuedTurnsByConversation.delete(conversationId)
      const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
      queueDispatchingByConversation.delete(conversationId)
      const queueErrorByConversation = new Map(state.queueErrorByConversation)
      queueErrorByConversation.delete(conversationId)
      const queueSuppressedRestoreByConversation = new Map(state.queueSuppressedRestoreByConversation)
      const inFlightTurnId = state.queueInFlightTurnByConversation.get(conversationId)
      if (inFlightTurnId) {
        const suppressed = new Set(queueSuppressedRestoreByConversation.get(conversationId) || [])
        suppressed.add(inFlightTurnId)
        queueSuppressedRestoreByConversation.set(conversationId, suppressed)
      }
      return {
        queuedTurnsByConversation,
        queueDispatchingByConversation,
        queueErrorByConversation,
        queueSuppressedRestoreByConversation
      }
    })
  },

  removeQueuedTurn: (conversationId: string, turnId: string) => {
    set((state) => {
      const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
      const queue = queuedTurnsByConversation.get(conversationId) || []
      if (queue.length === 0) return state

      const nextQueue = queue.filter((turn) => turn.id !== turnId)
      if (nextQueue.length > 0) {
        queuedTurnsByConversation.set(conversationId, nextQueue)
      } else {
        queuedTurnsByConversation.delete(conversationId)
      }

      const queueErrorByConversation = new Map(state.queueErrorByConversation)
      if (nextQueue.length === 0) {
        queueErrorByConversation.delete(conversationId)
      }
      const queueSuppressedRestoreByConversation = new Map(state.queueSuppressedRestoreByConversation)
      const inFlightTurnId = state.queueInFlightTurnByConversation.get(conversationId)
      if (inFlightTurnId === turnId) {
        const suppressed = new Set(queueSuppressedRestoreByConversation.get(conversationId) || [])
        suppressed.add(turnId)
        queueSuppressedRestoreByConversation.set(conversationId, suppressed)
      }

      return {
        queuedTurnsByConversation,
        queueErrorByConversation,
        queueSuppressedRestoreByConversation
      }
    })
  },

  sendQueuedTurn: async (conversationId: string, turnId: string): Promise<QueueSendResult> => {
    const snapshot = get()
    const queue = snapshot.queuedTurnsByConversation.get(conversationId) || []
    const targetIndex = queue.findIndex((turn) => turn.id === turnId)
    const targetTurn = targetIndex >= 0 ? queue[targetIndex] : undefined
    if (!targetTurn) {
      return {
        accepted: false,
        guided: false,
        fallbackToNewRun: false,
        error: 'Queued turn not found'
      }
    }

    if (snapshot.queueDispatchingByConversation.get(conversationId)) {
      return {
        accepted: false,
        guided: false,
        fallbackToNewRun: false,
        error: 'Queue is already dispatching'
      }
    }

    set((state) => {
      const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
      queueDispatchingByConversation.set(conversationId, true)
      const queueInFlightTurnByConversation = new Map(state.queueInFlightTurnByConversation)
      queueInFlightTurnByConversation.set(conversationId, turnId)
      const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
      const currentQueue = queuedTurnsByConversation.get(conversationId) || []
      const nextQueue = currentQueue.filter((turn) => turn.id !== turnId)
      if (nextQueue.length > 0) {
        queuedTurnsByConversation.set(conversationId, nextQueue)
      } else {
        queuedTurnsByConversation.delete(conversationId)
      }
      const queueErrorByConversation = new Map(state.queueErrorByConversation)
      queueErrorByConversation.delete(conversationId)
      return {
        queueDispatchingByConversation,
        queueInFlightTurnByConversation,
        queuedTurnsByConversation,
        queueErrorByConversation
      }
    })

    let result: DispatchResult | GuideDispatchResult = { accepted: false, error: 'Unknown dispatch error' }
    let attemptedGuidedDispatch = false
    let fallbackToNewRun = false
    let guidedDelivery: 'session_send' | 'ask_user_question_answer' | undefined
    try {
      const latestSession = get().sessions.get(conversationId) || createEmptySessionState()
      if (canStartNewRun(latestSession)) {
        result = await get().dispatchTurnInternal(targetTurn)
      } else {
        attemptedGuidedDispatch = true
        const guidedResult = await get().dispatchGuidedTurnInternal(targetTurn)
        if (
          !guidedResult.accepted &&
          guidedResult.errorCode &&
          GUIDE_FALLBACK_TO_NEW_RUN_ERROR_CODES.has(guidedResult.errorCode)
        ) {
          fallbackToNewRun = true
          result = await get().dispatchTurnInternal(targetTurn)
        } else {
          if (guidedResult.accepted) {
            guidedDelivery = guidedResult.delivery
          }
          result = guidedResult
        }
      }
    } finally {
      set((state) => {
        const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
        queueDispatchingByConversation.delete(conversationId)
        const queueInFlightTurnByConversation = new Map(state.queueInFlightTurnByConversation)
        queueInFlightTurnByConversation.delete(conversationId)
        const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
        const currentQueue = queuedTurnsByConversation.get(conversationId) || []
        const queueErrorByConversation = new Map(state.queueErrorByConversation)
        const queueSuppressedRestoreByConversation = new Map(state.queueSuppressedRestoreByConversation)
        const suppressedRestoreSet = queueSuppressedRestoreByConversation.get(conversationId)
        const shouldRestore = !(suppressedRestoreSet && suppressedRestoreSet.has(targetTurn.id))
        if (suppressedRestoreSet?.has(targetTurn.id)) {
          const nextSuppressed = new Set(suppressedRestoreSet)
          nextSuppressed.delete(targetTurn.id)
          if (nextSuppressed.size > 0) {
            queueSuppressedRestoreByConversation.set(conversationId, nextSuppressed)
          } else {
            queueSuppressedRestoreByConversation.delete(conversationId)
          }
        }

        const nonRetriable = isNonRetriableDispatchError(result)

        if (result.accepted) {
          queueErrorByConversation.delete(conversationId)
        } else {
          if (nonRetriable) {
            queueErrorByConversation.set(conversationId, result.error)
          } else if (shouldRestore) {
            const recoveredQueue = [...currentQueue]
            const insertIndex = Math.min(Math.max(targetIndex, 0), recoveredQueue.length)
            recoveredQueue.splice(insertIndex, 0, targetTurn)
            queuedTurnsByConversation.set(conversationId, recoveredQueue)
            queueErrorByConversation.set(conversationId, result.error)
          } else {
            queueErrorByConversation.delete(conversationId)
          }
        }

        return {
          queueDispatchingByConversation,
          queueInFlightTurnByConversation,
          queuedTurnsByConversation,
          queueErrorByConversation,
          queueSuppressedRestoreByConversation
        }
      })
    }
    return {
      accepted: result.accepted,
      guided: attemptedGuidedDispatch && result.accepted && !fallbackToNewRun,
      fallbackToNewRun: fallbackToNewRun && result.accepted,
      ...(guidedDelivery ? { delivery: guidedDelivery } : {}),
      ...(!result.accepted ? { error: result.error } : {})
    }
  },

  clearQueueError: (conversationId: string) => {
    set((state) => {
      const queueErrorByConversation = new Map(state.queueErrorByConversation)
      queueErrorByConversation.delete(conversationId)
      return { queueErrorByConversation }
    })
  },

  dispatchTurnInternal: async (turn: QueuedUserTurn): Promise<DispatchResult> => {
    const { spaceId, conversationId, content, images, fileContexts, thinkingEnabled, aiBrowserEnabled, invocationContext } = turn
    if (!spaceId || !conversationId) {
      return { accepted: false, error: '[ChatStore] spaceId and conversationId are required' }
    }
    const snapshot = get()
    const spaceState = snapshot.spaceStates.get(spaceId)
    const conversationMeta = spaceState?.conversations.find((conversation) => conversation.id === conversationId)
    if (!spaceState || !conversationMeta) {
      const reason = resolveSendErrorMessage(undefined, SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH)
      console.warn('[ChatStore] dispatchTurnInternal blocked by space mapping guard', {
        phase: 'renderer_dispatch_validation',
        spaceId,
        conversationId,
        errorCode: SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH
      })
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: reason,
          isGenerating: false,
          isThinking: false,
          isStreaming: false,
          activePlanTabId: session.activePlanTabId
        })
        return { sessions: newSessions }
      })
      return {
        accepted: false,
        error: reason,
        errorCode: SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH
      }
    }

    const cachedConversation = snapshot.conversationCache.get(conversationId)
    if (cachedConversation && cachedConversation.spaceId !== spaceId) {
      const reason = resolveSendErrorMessage(undefined, SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH)
      console.warn('[ChatStore] dispatchTurnInternal blocked by cache space mismatch', {
        phase: 'renderer_dispatch_validation',
        spaceId,
        conversationId,
        cachedSpaceId: cachedConversation.spaceId,
        errorCode: SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH
      })
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: reason,
          isGenerating: false,
          isThinking: false,
          isStreaming: false,
          activePlanTabId: session.activePlanTabId
        })
        return { sessions: newSessions }
      })
      return {
        accepted: false,
        error: reason,
        errorCode: SPACE_ROUTING_ERROR_CODES.SPACE_CONVERSATION_MISMATCH
      }
    }

    const conversationProfileId =
      toNonEmptyProfileId(cachedConversation?.ai?.profileId) ??
      toNonEmptyProfileId(conversationMeta.ai?.profileId)
    const aiSetupState = getAiSetupState(useAppStore.getState().config, conversationProfileId)
    if (!aiSetupState.configured) {
      console.warn('[ChatStore] dispatchTurnInternal blocked by ai setup guard', {
        spaceId,
        conversationId,
        conversationProfileId: conversationProfileId || null,
        reason: aiSetupState.reason
      })
      const reason = i18n.t('Please configure AI profile first')
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: reason,
          isGenerating: false,
          isThinking: false,
          isStreaming: false,
          activePlanTabId: session.activePlanTabId
        })
        return { sessions: newSessions }
      })
      return { accepted: false, error: reason }
    }

    const snapshotSession = get().sessions.get(conversationId)
    const effectiveMode = normalizeChatMode(turn.mode, undefined, snapshotSession?.mode || 'code')
    const context = invocationContext || 'interactive'
    if (context !== 'interactive' && context !== 'workflow-step') {
      return { accepted: false, error: `Unsupported invocationContext from renderer: ${context}` }
    }

    const nowIso = new Date().toISOString()
    const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content,
      timestamp: nowIso,
      images
    }

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        const latestSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          mode: effectiveMode,
          lifecycle: 'running',
          terminalReason: null,
          isGenerating: true,
          isThinking: true,
          activePlanTabId: latestSession?.activePlanTabId,
        })
        return { sessions: newSessions }
      })

      // Add user message to UI immediately
      set((state) => {
        const newCache = new Map(state.conversationCache)
        const cached = newCache.get(conversationId)
        if (cached) {
          newCache.set(conversationId, {
            ...cached,
            messages: [...cached.messages, userMessage],
            updatedAt: nowIso
          })
        }

        const newSpaceStates = new Map(state.spaceStates)
        const spaceState = newSpaceStates.get(spaceId)
        if (spaceState) {
          newSpaceStates.set(spaceId, {
            ...spaceState,
            conversations: spaceState.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, messageCount: c.messageCount + 1, updatedAt: nowIso }
                : c
            )
          })
        }
        return { spaceStates: newSpaceStates, conversationCache: newCache }
      })

      const baseRequest = {
        spaceId,
        conversationId,
        message: content,
        responseLanguage: getCurrentLanguage(),
        images,
        aiBrowserEnabled,
        thinkingEnabled,
        mode: effectiveMode,
        planEnabled: effectiveMode === 'plan',
        canvasContext: undefined as CanvasContext | undefined,
        fileContexts
      }

      const response = context === 'workflow-step'
        ? await api.sendWorkflowStepMessage(baseRequest)
        : await api.sendMessage({
          ...baseRequest,
          invocationContext: 'interactive'
        })
      if (!response.success) {
        const transportError = new Error(
          resolveSendErrorMessage(response.error, response.errorCode)
        ) as Error & { errorCode?: string }
        if (response.errorCode) {
          transportError.errorCode = response.errorCode
        }
        throw transportError
      }

      return { accepted: true }
    } catch (error) {
      const typedError = error as Error & { errorCode?: string }
      const errorCode =
        typeof typedError?.errorCode === 'string' ? typedError.errorCode : undefined
      const reason = toErrorMessage(error, 'Failed to send message')
      console.error('[ChatStore] Failed to dispatch turn:', error)
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: reason,
          isGenerating: false,
          isThinking: false,
          isStreaming: false,
          activePlanTabId: session.activePlanTabId
        })

        const newCache = new Map(state.conversationCache)
        const cached = newCache.get(conversationId)
        let removedOptimisticMessage = false
        if (cached) {
          const nextMessages = cached.messages.filter((message) => {
            if (message.id !== userMessageId) return true
            removedOptimisticMessage = true
            return false
          })
          if (removedOptimisticMessage) {
            newCache.set(conversationId, {
              ...cached,
              messages: nextMessages,
              messageCount: nextMessages.length,
              updatedAt: new Date().toISOString()
            })
          }
        }

        const newSpaceStates = new Map(state.spaceStates)
        if (removedOptimisticMessage) {
          const spaceState = newSpaceStates.get(spaceId)
          if (spaceState) {
            newSpaceStates.set(spaceId, {
              ...spaceState,
              conversations: spaceState.conversations.map((conversation) =>
                conversation.id === conversationId
                  ? {
                    ...conversation,
                    messageCount: Math.max(0, conversation.messageCount - 1),
                    updatedAt: new Date().toISOString()
                  }
                  : conversation
              )
            })
          }
        }

        return {
          sessions: newSessions,
          conversationCache: newCache,
          spaceStates: newSpaceStates
        }
      })
      return {
        accepted: false,
        error: reason,
        ...(errorCode ? { errorCode } : {})
      }
    }
  },

  dispatchGuidedTurnInternal: async (turn: QueuedUserTurn): Promise<GuideDispatchResult> => {
    const { spaceId, conversationId } = turn
    const content = turn.content.trim()
    const activeRunId = get().sessions.get(conversationId)?.activeRunId || null
    if (!spaceId || !conversationId) {
      return { accepted: false, error: '[ChatStore] spaceId and conversationId are required' }
    }
    if (!activeRunId) {
      return {
        accepted: false,
        error: i18n.t('No active run found for guided update.'),
        errorCode: 'ASK_USER_QUESTION_NO_ACTIVE_SESSION'
      }
    }
    if (!content) {
      return { accepted: false, error: i18n.t('Guide message cannot be empty') }
    }
    if ((turn.images && turn.images.length > 0) || (turn.fileContexts && turn.fileContexts.length > 0)) {
      return {
        accepted: false,
        error: i18n.t('Guide live update supports text only. Attachments remain queued for next turn.')
      }
    }

    const nowIso = new Date().toISOString()
    const userMessageId = `msg-guided-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content,
      timestamp: nowIso,
      guidedMeta: {
        runId: activeRunId
      }
    }

    set((state) => {
      const newCache = new Map(state.conversationCache)
      const cached = newCache.get(conversationId)
      if (cached) {
        newCache.set(conversationId, {
          ...cached,
          messages: [...cached.messages, userMessage],
          updatedAt: nowIso
        })
      }

      const newSpaceStates = new Map(state.spaceStates)
      const spaceState = newSpaceStates.get(spaceId)
      if (spaceState) {
        newSpaceStates.set(spaceId, {
          ...spaceState,
          conversations: spaceState.conversations.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  messageCount: conversation.messageCount + 1,
                  updatedAt: nowIso
                }
              : conversation
          )
        })
      }
      return { conversationCache: newCache, spaceStates: newSpaceStates }
    })

    let result: GuideDispatchResult = { accepted: false, error: 'Failed to guide message' }
    try {
      const response = await api.guideMessage({
        spaceId,
        conversationId,
        message: content,
        runId: activeRunId,
        clientMessageId: userMessageId
      })
      if (!response.success) {
        result = {
          accepted: false,
          error: toGuideErrorMessage(response.error, response.errorCode),
          errorCode: response.errorCode
        }
      } else {
        result = { accepted: true, delivery: response.data?.delivery }
      }
    } catch (error) {
      const reason = toErrorMessage(error, 'Failed to guide message')
      console.error('[ChatStore] Failed to dispatch guided turn:', error)
      result = { accepted: false, error: reason }
    }

    if (!result.accepted) {
      set((state) => {
        const newCache = new Map(state.conversationCache)
        const cached = newCache.get(conversationId)
        if (cached) {
          const nextMessages = cached.messages.filter((message) => message.id !== userMessageId)
          newCache.set(conversationId, {
            ...cached,
            messages: nextMessages,
            messageCount: nextMessages.length,
            updatedAt: new Date().toISOString()
          })
        }

        const newSpaceStates = new Map(state.spaceStates)
        const spaceState = newSpaceStates.get(spaceId)
        if (spaceState) {
          newSpaceStates.set(spaceId, {
            ...spaceState,
            conversations: spaceState.conversations.map((conversation) =>
              conversation.id === conversationId
                ? {
                    ...conversation,
                    messageCount: Math.max(0, conversation.messageCount - 1),
                    updatedAt: new Date().toISOString()
                  }
                : conversation
            )
          })
        }
        return { conversationCache: newCache, spaceStates: newSpaceStates }
      })
    }

    return result
  },

  submitTurn: async (turnInput) => {
    const hasContent = Boolean(
      turnInput.content.trim() ||
      (turnInput.images && turnInput.images.length > 0) ||
      (turnInput.fileContexts && turnInput.fileContexts.length > 0)
    )
    if (!hasContent) return

    const turn: QueuedUserTurn = {
      ...turnInput,
      id: `queued-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode: normalizeChatMode(turnInput.mode, undefined, 'code'),
      createdAt: Date.now()
    }

    const enqueueTurn = (errorMessage: string | null) => {
      set((state) => {
        const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
        const queue = queuedTurnsByConversation.get(turn.conversationId) || []
        queuedTurnsByConversation.set(turn.conversationId, [...queue, turn])

        const queueErrorByConversation = new Map(state.queueErrorByConversation)
        if (errorMessage) {
          queueErrorByConversation.set(turn.conversationId, errorMessage)
        } else {
          queueErrorByConversation.delete(turn.conversationId)
        }
        return { queuedTurnsByConversation, queueErrorByConversation }
      })
    }

    const existingQueue = get().queuedTurnsByConversation.get(turn.conversationId) || []
    if (existingQueue.length > 0) {
      enqueueTurn(null)
      void get().flushQueuedTurns(turn.conversationId, 'submit')
      return
    }

    const session = get().sessions.get(turn.conversationId) || createEmptySessionState()
    if (!canStartNewRun(session)) {
      enqueueTurn(null)
      return
    }

    const result = await get().dispatchTurnInternal(turn)
    if (result.accepted) {
      set((state) => {
        const queueErrorByConversation = new Map(state.queueErrorByConversation)
        queueErrorByConversation.delete(turn.conversationId)
        return { queueErrorByConversation }
      })
      return
    }

    if (isNonRetriableDispatchError(result)) {
      set((state) => {
        const queueErrorByConversation = new Map(state.queueErrorByConversation)
        queueErrorByConversation.set(turn.conversationId, result.error)
        return { queueErrorByConversation }
      })
      return
    }

    enqueueTurn(result.error)
  },

  flushQueuedTurns: async (conversationId: string, _trigger: QueueDispatchTrigger) => {
    const snapshot = get()
    if (snapshot.queueDispatchingByConversation.get(conversationId)) {
      return
    }

    const queue = snapshot.queuedTurnsByConversation.get(conversationId) || []
    if (queue.length === 0) {
      return
    }

    const session = snapshot.sessions.get(conversationId) || createEmptySessionState()
    if (!canStartNewRun(session)) {
      return
    }

    const headTurn = queue[0]
    set((state) => {
      const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
      queueDispatchingByConversation.set(conversationId, true)
      return { queueDispatchingByConversation }
    })

    let result: DispatchResult = { accepted: false, error: 'Unknown dispatch error' }
    try {
      result = await get().dispatchTurnInternal(headTurn)
    } finally {
      set((state) => {
        const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
        queueDispatchingByConversation.delete(conversationId)

        const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
        const currentQueue = queuedTurnsByConversation.get(conversationId) || []
        const queueErrorByConversation = new Map(state.queueErrorByConversation)

        const nonRetriable = isNonRetriableDispatchError(result)
        if (result.accepted || nonRetriable) {
          const nextQueue =
            currentQueue[0]?.id === headTurn.id
              ? currentQueue.slice(1)
              : currentQueue.filter((turn) => turn.id !== headTurn.id)
          if (nextQueue.length > 0) {
            queuedTurnsByConversation.set(conversationId, nextQueue)
          } else {
            queuedTurnsByConversation.delete(conversationId)
          }
          if (result.accepted) {
            queueErrorByConversation.delete(conversationId)
          } else {
            queueErrorByConversation.set(conversationId, result.error)
          }
        } else {
          queueErrorByConversation.set(conversationId, result.error)
        }

        return {
          queueDispatchingByConversation,
          queuedTurnsByConversation,
          queueErrorByConversation
        }
      })
    }
  },

  executePlan: async (spaceId, conversationId, planContent) => {
    if (!spaceId || !conversationId) {
      console.error('[ChatStore] spaceId and conversationId are required to execute plan')
      return
    }

    try {
      const prompt = `${i18n.t('Execute according to the following plan')}:\n\n${planContent}`
      await get().sendMessageToConversation(
        spaceId,
        conversationId,
        prompt,
        undefined,
        false,
        undefined,
        undefined,
        'code'
      )

      // Only clear activePlanTabId after successful send
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          newSessions.set(conversationId, {
            ...session,
            activePlanTabId: undefined,
          })
        }
        return { sessions: newSessions }
      })
    } catch (error) {
      console.error('[ChatStore] Failed to execute plan:', error)
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          newSessions.set(conversationId, {
            ...session,
            error: 'Failed to execute plan',
            isGenerating: false,
            isThinking: false,
          })
        }
        return { sessions: newSessions }
      })
    }
  },

  // Stop generation for a specific conversation
  stopGeneration: async (conversationId?: string) => {
    // Convert potential null to undefined for type compatibility with api.stopGeneration(string | undefined)
    const targetId = conversationId || get().getCurrentSpaceState().currentConversationId || undefined
    try {
      await api.stopGeneration(targetId || undefined)

      if (targetId) {
        set((state) => {
          const newSessions = new Map(state.sessions)
          const session = newSessions.get(targetId)
          if (session) {
            const cancelledTools = cancelRunningTools(session.toolStatusById)
            newSessions.set(targetId, {
              ...session,
              lifecycle: 'stopped',
              terminalReason: 'stopped',
              isGenerating: false,
              isThinking: false,
              isStreaming: false,
              toolStatusById: cancelledTools,
              pendingToolApproval: null,
              askUserQuestionsById: {},
              askUserQuestionOrder: [],
              activeAskUserQuestionId: null
            })
          }
          return { sessions: newSessions }
        })
        useTaskStore.getState().finalizeTasksOnTerminal('stopped')
        await get().flushQueuedTurns(targetId, 'stop_generation')
      }
    } catch (error) {
      console.error('Failed to stop generation:', error)
    }
  },

  // Approve tool for a specific conversation
  approveTool: async (conversationId: string) => {
    try {
      await api.approveTool(conversationId)
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          newSessions.set(conversationId, { ...session, pendingToolApproval: null })
        }
        return { sessions: newSessions }
      })
    } catch (error) {
      console.error('Failed to approve tool:', error)
    }
  },

  // Reject tool for a specific conversation
  rejectTool: async (conversationId: string) => {
    try {
      await api.rejectTool(conversationId)
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          newSessions.set(conversationId, { ...session, pendingToolApproval: null })
        }
        return { sessions: newSessions }
      })
    } catch (error) {
      console.error('Failed to reject tool:', error)
    }
  },

  // Answer AskUserQuestion for a specific conversation
  answerQuestion: async (conversationId: string, answer: AskUserQuestionAnswerPayload) => {
    try {
      const session = get().sessions.get(conversationId)
      const payload: AskUserQuestionAnswerPayload = {
        ...answer,
        runId: session?.activeRunId || undefined
      }
      const response = await api.answerQuestion(conversationId, payload)
      if (!response.success) {
        const reason = response.error || 'Failed to submit answer'
        set((state) => {
          const newSessions = new Map(state.sessions)
          const session = newSessions.get(conversationId)
          if (!session) return state

          const askUserQuestionsById = { ...session.askUserQuestionsById }
          const existingItem = askUserQuestionsById[answer.toolCallId]
          if (existingItem) {
            askUserQuestionsById[answer.toolCallId] = {
              ...existingItem,
              status: 'failed',
              updatedAt: Date.now(),
              errorCode: response.errorCode,
              toolCall: {
                ...existingItem.toolCall,
                status: 'error',
                error: reason,
                output: reason
              }
            }
          }
          const askUserQuestionOrder = ensureAskUserQuestionOrder(
            session.askUserQuestionOrder,
            askUserQuestionsById
          )
          const activeAskUserQuestionId = resolveActiveAskUserQuestionId(
            session.activeAskUserQuestionId,
            askUserQuestionOrder,
            askUserQuestionsById
          )

          newSessions.set(conversationId, {
            ...session,
            isGenerating: false,
            isStreaming: false,
            askUserQuestionsById,
            askUserQuestionOrder,
            activeAskUserQuestionId
          })
          return { sessions: newSessions }
        })
        return
      }

      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          const askUserQuestionsById = { ...session.askUserQuestionsById }
          const existingItem = askUserQuestionsById[answer.toolCallId]
          if (existingItem) {
            askUserQuestionsById[answer.toolCallId] = {
              ...existingItem,
              status: 'resolved',
              updatedAt: Date.now()
            }
            delete askUserQuestionsById[answer.toolCallId]
          }
          const askUserQuestionOrder = ensureAskUserQuestionOrder(
            session.askUserQuestionOrder.filter((id) => id !== answer.toolCallId),
            askUserQuestionsById
          )
          const activeAskUserQuestionId = resolveActiveAskUserQuestionId(
            session.activeAskUserQuestionId === answer.toolCallId
              ? null
              : session.activeAskUserQuestionId,
            askUserQuestionOrder,
            askUserQuestionsById
          )
          newSessions.set(conversationId, {
            ...session,
            askUserQuestionsById,
            askUserQuestionOrder,
            activeAskUserQuestionId
          })
        }
        return { sessions: newSessions }
      })
    } catch (error) {
      console.error('Failed to answer question:', error)
      throw error
    }
  },

  dismissAskUserQuestion: (conversationId: string, toolCallId?: string) => {
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId)
      if (!session) return state

      if (!toolCallId) {
        newSessions.set(conversationId, {
          ...session,
          askUserQuestionsById: {},
          askUserQuestionOrder: [],
          activeAskUserQuestionId: null
        })
        return { sessions: newSessions }
      }

      const askUserQuestionsById = { ...session.askUserQuestionsById }
      delete askUserQuestionsById[toolCallId]
      const askUserQuestionOrder = ensureAskUserQuestionOrder(
        session.askUserQuestionOrder.filter((id) => id !== toolCallId),
        askUserQuestionsById
      )
      const activeAskUserQuestionId = resolveActiveAskUserQuestionId(
        session.activeAskUserQuestionId === toolCallId ? null : session.activeAskUserQuestionId,
        askUserQuestionOrder,
        askUserQuestionsById
      )

      newSessions.set(conversationId, {
        ...session,
        askUserQuestionsById,
        askUserQuestionOrder,
        activeAskUserQuestionId
      })
      return { sessions: newSessions }
    })
  },

  setActiveAskUserQuestion: (conversationId: string, toolCallId: string) => {
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId)
      if (!session) return state
      if (!session.askUserQuestionsById[toolCallId]) return state

      newSessions.set(conversationId, {
        ...session,
        activeAskUserQuestionId: toolCallId
      })
      return { sessions: newSessions }
    })
  },

  // Run barrier event - marks a new active run before any run-scoped events are processed
  handleAgentRunStart: (data) => {
    const { conversationId, runId, startedAt } = data
    const incomingMode = normalizeChatMode(
      (data as AgentEventBase & { mode?: ChatMode }).mode,
      undefined,
      get().getConversationMode(conversationId)
    )
    let replayEvents: PendingRunEvent[] = []

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()
      const pendingRunEvents = prunePendingRunEvents(session.pendingRunEvents)
      replayEvents = pendingRunEvents
        .filter(event => event.runId === runId)
        .sort((a, b) => a.receivedAt - b.receivedAt)

      const remainingPending = pendingRunEvents.filter(event => event.runId !== runId)
      newSessions.set(conversationId, {
        ...createEmptySessionState(),
        mode: incomingMode,
        activeRunId: runId,
        lifecycle: 'running',
        terminalReason: null,
        isGenerating: true,
        isThinking: true,
        pendingRunEvents: remainingPending,
        availableToolsSnapshot: {
          runId,
          snapshotVersion: 0,
          emittedAt: startedAt,
          tools: [],
          toolCount: 0
        }
      })
      return { sessions: newSessions }
    })

    // Replay buffered run events once barrier is established
    for (const event of replayEvents) {
      switch (event.kind) {
        case 'process':
          get().handleAgentProcess(event.payload as AgentProcessEvent)
          break
        case 'message':
          get().handleAgentMessage(event.payload as AgentEventBase & { content: string; isComplete: boolean })
          break
        case 'tool_call':
          get().handleAgentToolCall(event.payload as AgentEventBase & ToolCall)
          break
        case 'tool_result':
          get().handleAgentToolResult(event.payload as AgentEventBase & { toolCallId?: string; toolId?: string; result: string; isError: boolean })
          break
        case 'thought':
          get().handleAgentThought(event.payload as AgentEventBase & { thought: Thought })
          break
        case 'error':
          get().handleAgentError(event.payload as AgentEventBase & { error: string })
          break
        case 'compact':
          get().handleAgentCompact(event.payload as AgentEventBase & { trigger: 'manual' | 'auto'; preTokens: number })
          break
        case 'tools_available':
          get().handleAgentToolsAvailable(event.payload as AgentEventBase & { runId: string; snapshotVersion: number; emittedAt: string; tools: string[]; toolCount: number })
          break
        case 'complete':
          void get().handleAgentComplete(event.payload as AgentCompleteEvent)
          break
        default:
          break
      }
    }
  },

  handleAgentProcess: (data) => {
    const { conversationId, runId, kind } = data
    const payload =
      data.payload && typeof data.payload === 'object'
        ? (data.payload as Record<string, unknown>)
        : {}
    let accepted = false

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'process',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }
      accepted = true

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        processTrace: [...session.processTrace, toProcessTraceNode(data)]
      })
      return { sessions: newSessions }
    })

    if (!accepted) {
      return
    }

    if (kind === 'tool_call') {
      const toolCallPayload =
        payload.toolCall && typeof payload.toolCall === 'object'
          ? (payload.toolCall as Record<string, unknown>)
          : payload
      get().handleAgentToolCall({
        ...data,
        ...(toolCallPayload as unknown as ToolCall)
      } as AgentEventBase & ToolCall)
      return
    }

    if (kind === 'tool_result') {
      const toolResultPayload =
        payload.toolResult && typeof payload.toolResult === 'object'
          ? (payload.toolResult as Record<string, unknown>)
          : payload
      get().handleAgentToolResult({
        ...data,
        ...(toolResultPayload as unknown as {
          toolCallId?: string
          toolId?: string
          result: string
          isError: boolean
        })
      })
      return
    }

    const thought = extractThoughtFromProcessEvent(data)
    if (!thought) {
      return
    }
    get().handleAgentThought({
      ...data,
      thought
    })
  },

  // Handle agent message - update session-specific streaming content
  // Supports both incremental (delta) and full (content) modes for backward compatibility
  handleAgentMessage: (data) => {
    const { conversationId, runId, content, delta, isStreaming, isNewTextBlock } = data as AgentEventBase & {
      runId?: string
      content?: string
      delta?: string
      isComplete: boolean
      isStreaming?: boolean
      isNewTextBlock?: boolean  // Signal from content_block_start (type='text')
    }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'message',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      // New text block signal: increment version number
      // StreamingBubble detects version change to reset activeSnapshotLen
      const newTextBlockVersion = isNewTextBlock
        ? (session.textBlockVersion || 0) + 1
        : (session.textBlockVersion || 0)

      // Incremental mode: append delta to existing content
      // Full mode: replace directly (backward compatible)
      const newContent = delta
        ? (session.streamingContent || '') + delta
        : (content ?? session.streamingContent)

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        lifecycle: 'running',
        streamingContent: newContent,
        isStreaming: isStreaming ?? false,
        textBlockVersion: newTextBlockVersion,
        isGenerating: true
      })
      return { sessions: newSessions }
    })
  },

  // Handle tool call for a specific conversation
  handleAgentToolCall: (data) => {
    const { conversationId, runId } = data as AgentEventBase & ToolCall & { runId?: string; toolCallId?: string }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'tool_call',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      const toolCallId = ((data as any).toolCallId as string | undefined) || (data as any).id
      if (!toolCallId) {
        return state
      }

      const normalizedStatus = normalizeToolStatus((data as any).status)
      const incomingToolCall: ToolCall = {
        ...(data as ToolCall),
        id: toolCallId,
        status: normalizedStatus
      }

      const toolStatusById: Record<string, ToolStatus> = {
        ...session.toolStatusById,
        [toolCallId]: normalizedStatus
      }
      const toolCallsById: Record<string, ToolCall> = {
        ...session.toolCallsById,
        [toolCallId]: incomingToolCall
      }

      // Apply orphan result if it arrived before tool_call
      const orphanResult = session.orphanToolResults[toolCallId]
      const orphanToolResults = { ...session.orphanToolResults }
      if (orphanResult) {
        const orphanStatus: ToolStatus = orphanResult.isError ? 'error' : 'success'
        toolStatusById[toolCallId] = orphanStatus
        toolCallsById[toolCallId] = {
          ...incomingToolCall,
          status: orphanStatus,
          output: orphanResult.result,
          error: orphanResult.isError ? orphanResult.result : undefined
        }
        delete orphanToolResults[toolCallId]
      }

      const isAskUserQuestion = incomingToolCall.name?.toLowerCase() === 'askuserquestion'
      const resolvedToolCall = toolCallsById[toolCallId]
      const isToolStillRunning = isRunningLikeToolStatus(toolStatusById[toolCallId])
      let pendingToolApproval = session.pendingToolApproval
      if (incomingToolCall.requiresApproval) {
        pendingToolApproval = isToolStillRunning ? resolvedToolCall : null
      } else if (session.pendingToolApproval?.id === toolCallId) {
        pendingToolApproval = null
      }

      const askUserQuestionsById = { ...session.askUserQuestionsById }
      let askUserQuestionOrder = [...session.askUserQuestionOrder]
      if (isAskUserQuestion) {
        if (isToolStillRunning) {
          askUserQuestionsById[toolCallId] = {
            id: toolCallId,
            toolCall: resolvedToolCall,
            status: 'pending',
            runId: runId ?? session.activeRunId,
            updatedAt: Date.now()
          }
          if (!askUserQuestionOrder.includes(toolCallId)) {
            askUserQuestionOrder.push(toolCallId)
          }
        } else {
          const finalizedStatus = toolStatusById[toolCallId] === 'error' ? 'failed' : 'resolved'
          if (finalizedStatus === 'failed') {
            askUserQuestionsById[toolCallId] = {
              id: toolCallId,
              toolCall: resolvedToolCall,
              status: 'failed',
              runId: runId ?? session.activeRunId,
              updatedAt: Date.now()
            }
            if (!askUserQuestionOrder.includes(toolCallId)) {
              askUserQuestionOrder.push(toolCallId)
            }
          } else {
            delete askUserQuestionsById[toolCallId]
            askUserQuestionOrder = askUserQuestionOrder.filter((id) => id !== toolCallId)
          }
        }
      }
      askUserQuestionOrder = ensureAskUserQuestionOrder(askUserQuestionOrder, askUserQuestionsById)
      const activeAskUserQuestionId = resolveActiveAskUserQuestionId(
        session.activeAskUserQuestionId,
        askUserQuestionOrder,
        askUserQuestionsById
      )

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        lifecycle: 'running',
        isGenerating: true,
        toolStatusById,
        toolCallsById,
        orphanToolResults,
        pendingToolApproval,
        askUserQuestionsById,
        askUserQuestionOrder,
        activeAskUserQuestionId
      })
      return { sessions: newSessions }
    })
  },

  // Handle tool result for a specific conversation
  handleAgentToolResult: (data) => {
    const { conversationId, runId, result, isError } = data as AgentEventBase & {
      runId?: string
      toolCallId?: string
      toolId?: string
      result: string
      isError: boolean
    }
    const toolCallId = (data as any).toolCallId || (data as any).toolId

    if (!toolCallId) return

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'tool_result',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      const toolStatusById = {
        ...session.toolStatusById,
        [toolCallId]: isError ? 'error' : 'success'
      } as Record<string, ToolStatus>
      const toolCallsById = { ...session.toolCallsById }
      const existingToolCall = toolCallsById[toolCallId]
      if (existingToolCall) {
        toolCallsById[toolCallId] = {
          ...existingToolCall,
          status: isError ? 'error' : 'success',
          output: result,
          error: isError ? result : undefined
        }
      }

      // Out-of-order tool_result arrives before tool_call
      const orphanToolResults = { ...session.orphanToolResults }
      if (!existingToolCall) {
        orphanToolResults[toolCallId] = { result, isError }
      }

      const isAskUserQuestion =
        existingToolCall?.name?.toLowerCase() === 'askuserquestion' ||
        session.askUserQuestionsById[toolCallId] != null
      const askUserQuestionsById = { ...session.askUserQuestionsById }
      let askUserQuestionOrder = [...session.askUserQuestionOrder]
      if (isAskUserQuestion) {
        const baseToolCall = toolCallsById[toolCallId] || {
          id: toolCallId,
          name: 'AskUserQuestion',
          status: isError ? 'error' : 'success',
          input: {}
        }
        if (isError) {
          askUserQuestionsById[toolCallId] = {
            id: toolCallId,
            toolCall: {
              ...baseToolCall,
              status: 'error',
              output: result,
              error: result
            },
            status: 'failed',
            runId: runId ?? session.activeRunId,
            updatedAt: Date.now()
          }
          if (!askUserQuestionOrder.includes(toolCallId)) {
            askUserQuestionOrder.push(toolCallId)
          }
        } else {
          delete askUserQuestionsById[toolCallId]
          for (const [id, item] of Object.entries(askUserQuestionsById)) {
            if (item.status === 'failed') {
              delete askUserQuestionsById[id]
            }
          }
          askUserQuestionOrder = askUserQuestionOrder.filter((id) => (
            id !== toolCallId &&
            askUserQuestionsById[id] != null &&
            askUserQuestionsById[id].status !== 'failed'
          ))
        }
      }
      askUserQuestionOrder = ensureAskUserQuestionOrder(askUserQuestionOrder, askUserQuestionsById)
      const activeAskUserQuestionId = resolveActiveAskUserQuestionId(
        session.activeAskUserQuestionId,
        askUserQuestionOrder,
        askUserQuestionsById
      )

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        lifecycle: 'running',
        toolStatusById,
        toolCallsById,
        orphanToolResults,
        askUserQuestionsById,
        askUserQuestionOrder,
        activeAskUserQuestionId
      })
      return { sessions: newSessions }
    })
  },

  // Handle error for a specific conversation
  handleAgentError: (data) => {
    const { conversationId, runId, error } = data as AgentEventBase & { runId?: string; error: string }
    let shouldFinalizeTasks = false

    // Add error thought to session
    const errorThought: Thought = {
      id: `thought-error-${Date.now()}`,
      type: 'error',
      content: error,
      timestamp: new Date().toISOString(),
      isError: true
    }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'error',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      shouldFinalizeTasks = true
      const toolStatusById = cancelRunningTools(session.toolStatusById)

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        lifecycle: 'error',
        terminalReason: 'error',
        error,
        isGenerating: false,
        isThinking: false,
        isStreaming: false,
        toolStatusById,
        pendingToolApproval: null,
        askUserQuestionsById: {},
        askUserQuestionOrder: [],
        activeAskUserQuestionId: null,
        thoughts: [...session.thoughts, errorThought]
      })
      return { sessions: newSessions }
    })

    if (shouldFinalizeTasks) {
      useTaskStore.getState().finalizeTasksOnTerminal('error')
      void get().flushQueuedTurns(conversationId, 'agent_error')
    }
  },

  // Terminal event for a run
  handleAgentComplete: async (data: AgentCompleteEvent) => {
    const { spaceId, conversationId, runId, reason } = data
    const terminalReason: TerminalReason = reason ?? 'completed'
    const applyFinalContentFallback = (finalContent?: string): boolean => {
      if (typeof finalContent !== 'string' || finalContent.trim().length === 0) {
        return false
      }
      const now = new Date().toISOString()
      set((state) => {
        const newCache = new Map(state.conversationCache)
        const cachedConversation = newCache.get(conversationId)
        const newSpaceStates = new Map(state.spaceStates)
        if (cachedConversation) {
          const messages = [...(cachedConversation.messages || [])]
          const lastMessage = messages[messages.length - 1]
          if (lastMessage?.role === 'assistant') {
            messages[messages.length - 1] = {
              ...lastMessage,
              content: finalContent,
              terminalReason
            }
          } else {
            messages.push({
              id: `fallback-assistant-${Date.now()}`,
              role: 'assistant',
              content: finalContent,
              timestamp: now,
              terminalReason
            })
          }

          const updatedConversation: Conversation = {
            ...cachedConversation,
            messages,
            messageCount: messages.length,
            updatedAt: now
          }
          newCache.set(conversationId, updatedConversation)

          const currentSpaceState = newSpaceStates.get(spaceId)
          if (currentSpaceState) {
            newSpaceStates.set(spaceId, {
              ...currentSpaceState,
              conversations: currentSpaceState.conversations.map((c) =>
                c.id === conversationId
                  ? {
                      ...c,
                      updatedAt: now,
                      messageCount: messages.length,
                      preview: finalContent.slice(0, 50)
                    }
                  : c
              )
            })
          }
        }

        const newSessions = new Map(state.sessions)
        const currentSession = newSessions.get(conversationId)
        if (currentSession) {
          newSessions.set(conversationId, {
            ...currentSession,
            isGenerating: false,
            isStreaming: false,
            isThinking: false,
            streamingContent: '',
            pendingToolApproval: null,
            askUserQuestionsById: {},
            askUserQuestionOrder: [],
            activeAskUserQuestionId: null,
            compactInfo: null
          })
        }
        return {
          spaceStates: newSpaceStates,
          sessions: newSessions,
          conversationCache: newCache
        }
      })
      return true
    }

    let waitForPendingQuestion = false
    let shouldFinalizeTasks = false
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'complete',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (runId && session.activeRunId && session.activeRunId !== runId) {
        return state
      }

      shouldFinalizeTasks = true
      const hasPendingQuestion = session.askUserQuestionOrder.some((id) => {
        const item = session.askUserQuestionsById[id]
        return item?.status === 'pending'
      })
      waitForPendingQuestion = hasPendingQuestion && terminalReason === 'completed'
      const lifecycle: AgentRunLifecycle =
        terminalReason === 'stopped'
          ? 'stopped'
          : terminalReason === 'error'
            ? 'error'
            : 'completed'
      const cancelledTools = cancelRunningTools(session.toolStatusById)

      if (!waitForPendingQuestion) {
        newSessions.set(conversationId, {
          ...session,
          activeRunId: runId ?? session.activeRunId,
          lifecycle,
          terminalReason,
          isStreaming: false,
          isThinking: false,
          isGenerating: false,
          toolStatusById: cancelledTools,
          pendingToolApproval: null,
          askUserQuestionsById: {},
          askUserQuestionOrder: [],
          activeAskUserQuestionId: null
        })
      } else {
        newSessions.set(conversationId, {
          ...session,
          activeRunId: runId ?? session.activeRunId,
          lifecycle,
          terminalReason,
          isGenerating: false,
          isStreaming: false,
          isThinking: false,
          pendingToolApproval: null
        })
      }
      return { sessions: newSessions }
    })

    if (shouldFinalizeTasks) {
      useTaskStore.getState().finalizeTasksOnTerminal(terminalReason)
    }
    if (!shouldFinalizeTasks) {
      return
    }

    // Wait for user answer in AskUserQuestion branch
    if (waitForPendingQuestion) {
      return
    }

    // Reload conversation from backend (Single Source of Truth)
    // Backend has already saved the complete message with thoughts
    try {
      let conversationReloaded = false
      const [conversationResponse, changeSetsResponse] = await Promise.all([
        api.getConversation(spaceId, conversationId),
        api.listChangeSets(spaceId, conversationId)
      ])
      if (conversationResponse.success && conversationResponse.data) {
        conversationReloaded = true
        const updatedConversation = conversationResponse.data as ConversationWithAi & { mode?: ChatMode }
        const updatedConversationMode = normalizeChatMode(updatedConversation.mode)

        // Extract updated metadata
        const updatedMeta: ConversationMetaWithAi = {
          id: updatedConversation.id,
          spaceId: updatedConversation.spaceId,
          title: updatedConversation.title,
          mode: updatedConversationMode,
          createdAt: updatedConversation.createdAt,
          updatedAt: updatedConversation.updatedAt,
          messageCount: updatedConversation.messages?.length || 0,
          preview: updatedConversation.messages?.length
            ? updatedConversation.messages[updatedConversation.messages.length - 1].content.slice(0, 50)
            : undefined,
          ai: updatedConversation.ai
        }

        // Now atomically: update cache, metadata, AND clear session state
        // This prevents flash by doing all in one render
        set((state) => {
          // Update cache with fresh data
          const newCache = new Map(state.conversationCache)
          newCache.set(conversationId, {
            ...updatedConversation,
            mode: updatedConversationMode
          } as Conversation)

          // Update metadata in space state
          const newSpaceStates = new Map(state.spaceStates)
          const currentSpaceState = newSpaceStates.get(spaceId)
          if (currentSpaceState) {
            newSpaceStates.set(spaceId, {
              ...currentSpaceState,
              conversations: currentSpaceState.conversations.map((c) =>
                c.id === conversationId ? updatedMeta : c
              )
            })
          }

          // Clear session state atomically with conversation update
          const newSessions = new Map(state.sessions)
          const currentSession = newSessions.get(conversationId)
          if (currentSession) {
            newSessions.set(conversationId, {
              ...currentSession,
              mode: updatedConversationMode,
              isGenerating: false,
              streamingContent: '',
              pendingToolApproval: null,
              askUserQuestionsById: {},
              askUserQuestionOrder: [],
              activeAskUserQuestionId: null,
              compactInfo: null  // Clear temporary compact notification
            })
          }

          return {
            spaceStates: newSpaceStates,
            sessions: newSessions,
            conversationCache: newCache
          }
        })

        // Auto-open plan tab if the last message is a plan response
        await autoOpenPlanTab(updatedConversation, spaceId, conversationId, get, set)
      }

      if (!conversationReloaded) {
        applyFinalContentFallback(data.finalContent)
      }

      if (changeSetsResponse.success && changeSetsResponse.data) {
        const changeSets = changeSetsResponse.data as ChangeSet[]
        set((state) => {
          const newChangeSets = new Map(state.changeSets)
          newChangeSets.set(conversationId, changeSets)
          return { changeSets: newChangeSets }
        })
      }
    } catch (error) {
      console.error('[ChatStore] Failed to reload conversation:', error)
      const appliedFallback = applyFinalContentFallback(data.finalContent)
      if (!appliedFallback) {
        // Even on error without fallback, must clear state to avoid stale content
        set((state) => {
          const newSessions = new Map(state.sessions)
          const currentSession = newSessions.get(conversationId)
          if (currentSession) {
            newSessions.set(conversationId, {
              ...currentSession,
              isGenerating: false,
              streamingContent: '',
              pendingToolApproval: null,
              askUserQuestionsById: {},
              askUserQuestionOrder: [],
              activeAskUserQuestionId: null,
              compactInfo: null  // Clear temporary compact notification
            })
          }
          return { sessions: newSessions }
        })
      }
    }

    await get().flushQueuedTurns(conversationId, 'agent_complete')
  },

  handleAgentMode: (data) => {
    const { spaceId, conversationId, runId, mode } = data
    const nextMode = normalizeChatMode(mode)

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && session.activeRunId && session.activeRunId !== runId) {
        return state
      }

      newSessions.set(conversationId, {
        ...session,
        mode: nextMode,
        modeSwitching: false
      })

      const newCache = new Map(state.conversationCache)
      const cachedConversation = newCache.get(conversationId) as (Conversation & { mode?: ChatMode }) | undefined
      if (cachedConversation) {
        newCache.set(conversationId, {
          ...cachedConversation,
          mode: nextMode
        })
      }

      const newSpaceStates = new Map(state.spaceStates)
      const targetSpaceState = newSpaceStates.get(spaceId)
      if (targetSpaceState) {
        newSpaceStates.set(spaceId, {
          ...targetSpaceState,
          conversations: targetSpaceState.conversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, mode: nextMode }
              : conversation
          )
        })
      }

      return {
        sessions: newSessions,
        conversationCache: newCache,
        spaceStates: newSpaceStates
      }
    })
  },

  // Load change sets for a conversation
  loadChangeSets: async (spaceId, conversationId) => {
    try {
      const response = await api.listChangeSets(spaceId, conversationId)
      if (response.success && response.data) {
        const changeSets = response.data as ChangeSet[]
        set((state) => {
          const newChangeSets = new Map(state.changeSets)
          newChangeSets.set(conversationId, changeSets)
          return { changeSets: newChangeSets }
        })
      }
    } catch (error) {
      console.error('[ChatStore] Failed to load change sets:', error)
    }
  },

  // Accept change set (all or single file)
  acceptChangeSet: async (params) => {
    const refreshChangeSets = async () => {
      try {
        const response = await api.listChangeSets(params.spaceId, params.conversationId)
        if (response.success && response.data) {
          const changeSets = response.data as ChangeSet[]
          set((state) => {
            const newChangeSets = new Map(state.changeSets)
            newChangeSets.set(params.conversationId, changeSets)
            return { changeSets: newChangeSets }
          })
        }
      } catch (error) {
        console.error('[ChatStore] Failed to refresh change sets:', error)
      }
    }

    try {
      const response = await api.acceptChangeSet(params)
      if (response.success && response.data) {
        const updated = response.data as ChangeSet
        set((state) => {
          const newChangeSets = new Map(state.changeSets)
          const existing = newChangeSets.get(params.conversationId) || []
          const next = existing.map((cs) => (cs.id === updated.id ? updated : cs))
          newChangeSets.set(params.conversationId, next)
          return { changeSets: newChangeSets }
        })
        return updated
      }
    } catch (error) {
      console.error('[ChatStore] Failed to accept change set:', error)
    }
    await refreshChangeSets()
    return null
  },

  // Rollback change set (all or single file)
  rollbackChangeSet: async (params) => {
    try {
      const response = await api.rollbackChangeSet(params)
      if (response.success && response.data) {
        const result = response.data as { changeSet: ChangeSet | null; conflicts: string[] }
        if (result.changeSet) {
          set((state) => {
            const newChangeSets = new Map(state.changeSets)
            const existing = newChangeSets.get(params.conversationId) || []
            const next = existing.map((cs) => (cs.id === result.changeSet!.id ? result.changeSet! : cs))
            newChangeSets.set(params.conversationId, next)
            return { changeSets: newChangeSets }
          })
        }
        if (result.changeSet && result.conflicts.length === 0) {
          window.dispatchEvent(new CustomEvent('artifacts:refresh', { detail: { spaceId: params.spaceId } }))
        }
        return result
      }
    } catch (error) {
      console.error('[ChatStore] Failed to rollback change set:', error)
    }
    // Refresh from server on failure
    try {
      const response = await api.listChangeSets(params.spaceId, params.conversationId)
      if (response.success && response.data) {
        set((state) => {
          const newChangeSets = new Map(state.changeSets)
          newChangeSets.set(params.conversationId, response.data as ChangeSet[])
          return { changeSets: newChangeSets }
        })
      }
    } catch (refreshError) {
      console.error('[ChatStore] Failed to refresh change sets:', refreshError)
    }
    return { changeSet: null, conflicts: [] }
  },

  // Handle thought for a specific conversation
  handleAgentThought: (data) => {
    const { conversationId, runId, thought } = data as AgentEventBase & { runId?: string; thought: Thought }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'thought',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      // Check if thought with same type+id already exists (avoid duplicates after recovery)
      // Use composite key to allow tool_use and tool_result with same id
      const existingKeys = new Set(session.thoughts.map(t => getThoughtKey(t)))
      const thoughtKey = getThoughtKey(thought)
      if (existingKeys.has(thoughtKey)) {
        return state // No change
      }

      const newThoughts = [...session.thoughts, thought]

      // Rebuild parallel groups
      const parallelGroups = buildParallelGroups(newThoughts)

      // Track active sub-agents (Task tools without corresponding tool_result)
      const taskToolIds = new Set(
        newThoughts
          .filter(t => t.type === 'tool_use' && t.toolName === 'Task')
          .map(t => t.id)
      )
      const completedTaskIds = new Set(
        newThoughts
          .filter(t => t.type === 'tool_result' && taskToolIds.has(t.id))
          .map(t => t.id)
      )
      const activeAgentIds = Array.from(taskToolIds).filter(id => !completedTaskIds.has(id))

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        lifecycle: 'running',
        thoughts: newThoughts,
        parallelGroups,
        activeAgentIds,
        isThinking: true,
        isGenerating: true
      })
      return { sessions: newSessions }
    })
  },

  // Handle compact notification - context was compressed
  handleAgentCompact: (data) => {
    const { conversationId, runId, trigger, preTokens } = data as AgentEventBase & {
      runId?: string
      trigger: 'manual' | 'auto'
      preTokens: number
    }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'compact',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (!isEventRunAccepted(session, runId)) {
        return state
      }

      newSessions.set(conversationId, {
        ...session,
        activeRunId: runId ?? session.activeRunId,
        compactInfo: { trigger, preTokens }
      })
      return { sessions: newSessions }
    })
  },

  // Handle tools snapshot for current run
  handleAgentToolsAvailable: (data) => {
    const { conversationId, runId, snapshotVersion, emittedAt, tools, toolCount } = data

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      if (runId && !session.activeRunId) {
        newSessions.set(conversationId, {
          ...session,
          pendingRunEvents: enqueuePendingRunEvent(session, {
            kind: 'tools_available',
            runId,
            payload: data,
            receivedAt: Date.now()
          })
        })
        return { sessions: newSessions }
      }

      if (runId && session.activeRunId && session.activeRunId !== runId) {
        return state
      }

      const currentSnapshot = session.availableToolsSnapshot
      if (
        currentSnapshot.runId === runId &&
        currentSnapshot.snapshotVersion > snapshotVersion
      ) {
        return state
      }

      newSessions.set(conversationId, {
        ...session,
        availableToolsSnapshot: {
          runId,
          snapshotVersion,
          emittedAt,
          tools,
          toolCount
        }
      })
      return { sessions: newSessions }
    })
  },

  // Reset all state (use sparingly - e.g., logout)
  reset: () => {
    set({
      spaceStates: new Map(),
      conversationCache: new Map(),
      sessions: new Map(),
      changeSets: new Map(),
      currentSpaceId: null,
      artifacts: [],
      loadingConversationCounts: new Map(),
      queuedTurnsByConversation: new Map(),
      queueDispatchingByConversation: new Map(),
      queueErrorByConversation: new Map(),
      queueInFlightTurnByConversation: new Map(),
      queueSuppressedRestoreByConversation: new Map()
    })
  },

  // Reset a specific space's state (use when needed)
  resetSpace: (spaceId: string) => {
    set((state) => {
      const targetConversationIds = new Set(
        (state.spaceStates.get(spaceId)?.conversations || []).map((conversation) => conversation.id)
      )
      const newSpaceStates = new Map(state.spaceStates)
      newSpaceStates.delete(spaceId)
      const newChangeSets = new Map(state.changeSets)
      for (const [conversationId, changeSets] of newChangeSets.entries()) {
        if (changeSets.some(cs => cs.spaceId === spaceId)) {
          newChangeSets.delete(conversationId)
        }
      }
      const queuedTurnsByConversation = new Map(state.queuedTurnsByConversation)
      const queueDispatchingByConversation = new Map(state.queueDispatchingByConversation)
      const queueErrorByConversation = new Map(state.queueErrorByConversation)
      const queueInFlightTurnByConversation = new Map(state.queueInFlightTurnByConversation)
      const queueSuppressedRestoreByConversation = new Map(state.queueSuppressedRestoreByConversation)
      for (const conversationId of targetConversationIds) {
        queuedTurnsByConversation.delete(conversationId)
        queueDispatchingByConversation.delete(conversationId)
        queueErrorByConversation.delete(conversationId)
        queueInFlightTurnByConversation.delete(conversationId)
        queueSuppressedRestoreByConversation.delete(conversationId)
      }
      return {
        spaceStates: newSpaceStates,
        changeSets: newChangeSets,
        queuedTurnsByConversation,
        queueDispatchingByConversation,
        queueErrorByConversation,
        queueInFlightTurnByConversation,
        queueSuppressedRestoreByConversation
      }
    })
  }
}))

/**
 * Selector: Get current session's isGenerating state
 * Use this in components that need to react to generation state changes
 */
export function useIsGenerating(): boolean {
  return useChatStore((state) => {
    const spaceState = state.currentSpaceId
      ? state.spaceStates.get(state.currentSpaceId)
      : null
    if (!spaceState?.currentConversationId) return false
    const session = state.sessions.get(spaceState.currentConversationId)
    return session?.isGenerating ?? false
  })
}
