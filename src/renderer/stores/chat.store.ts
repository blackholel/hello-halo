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
import { useTaskStore } from './task.store'
import type {
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
import i18n from '../i18n'
import type { InvocationContext } from '../../shared/resource-access'

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
  planEnabled: boolean
  activePlanTabId?: string
}

// Create empty session state
function createEmptySessionState(): SessionState {
  return {
    activeRunId: null,
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
    planEnabled: false,
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

  // Computed getters
  getCurrentSpaceState: () => SpaceState
  getSpaceState: (spaceId: string) => SpaceState
  getCurrentConversation: () => Conversation | null
  getCurrentConversationMeta: () => ConversationMeta | null
  getCurrentSession: () => SessionState
  getSession: (conversationId: string) => SessionState
  getPlanEnabled: (conversationId: string) => boolean
  setPlanEnabled: (conversationId: string, enabled: boolean) => void
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
  sendMessage: (
    content: string,
    images?: ImageAttachment[],
    aiBrowserEnabled?: boolean,
    thinkingEnabled?: boolean,
    fileContexts?: FileContextAttachment[],
    planEnabled?: boolean,
    invocationContext?: InvocationContext
  ) => Promise<void>
  sendMessageToConversation: (
    spaceId: string,
    conversationId: string,
    content: string,
    images?: ImageAttachment[],
    thinkingEnabled?: boolean,
    fileContexts?: FileContextAttachment[],
    aiBrowserEnabled?: boolean,
    planEnabled?: boolean,
    invocationContext?: InvocationContext
  ) => Promise<void>
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
      const fullConversation = conversationResponse.data as Conversation
      set((state) => {
        const newCache = new Map(state.conversationCache)
        newCache.set(conversationId, fullConversation)
        if (newCache.size > CONVERSATION_CACHE_SIZE) {
          const firstKey = newCache.keys().next().value
          if (firstKey) newCache.delete(firstKey)
        }
        return { conversationCache: newCache }
      })
    }

    if (sessionResponse.success && sessionResponse.data) {
      const sessionState = sessionResponse.data as {
        isActive: boolean
        thoughts: Thought[]
        processTrace?: ProcessTraceNode[]
        spaceId?: string
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
      api.ensureSessionWarm(spaceId, conversationId)
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

  getPlanEnabled: (conversationId: string) => {
    return get().sessions.get(conversationId)?.planEnabled ?? false
  },

  setPlanEnabled: (conversationId: string, enabled: boolean) => {
    set((state) => {
      const newSessions = new Map(state.sessions)
      const previousSession = newSessions.get(conversationId)
      newSessions.set(conversationId, {
        ...(previousSession || createEmptySessionState()),
        planEnabled: enabled,
      })
      return { sessions: newSessions }
    })
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
        const conversations = response.data as ConversationMetaWithAi[]

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
        const newConversation = response.data as ConversationWithAi

        // Extract metadata for the list
        const meta: ConversationMetaWithAi = {
          id: newConversation.id,
          spaceId: newConversation.spaceId,
          title: newConversation.title,
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
          newCache.set(newConversation.id, newConversation)

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
            loadingConversationCounts: newLoadingConversationCounts
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

  // Send message (with optional images for multi-modal, optional AI Browser and thinking mode, optional file contexts, optional plan mode)
  sendMessage: async (content, images, aiBrowserEnabled, thinkingEnabled, fileContexts, planEnabled, invocationContext) => {
    const conversation = get().getCurrentConversation()
    const conversationMeta = get().getCurrentConversationMeta()
    const { currentSpaceId } = get()

    if ((!conversation && !conversationMeta) || !currentSpaceId) {
      console.error('[ChatStore] No conversation or space selected')
      return
    }

    const conversationId = conversationMeta?.id || conversation?.id
    if (!conversationId) return

    const snapshotSession = get().sessions.get(conversationId)
    const effectivePlanEnabled = planEnabled ?? snapshotSession?.planEnabled ?? false

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        const latestSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          lifecycle: 'running',
          terminalReason: null,
          isGenerating: true,
          isThinking: true,
          planEnabled: effectivePlanEnabled,
          activePlanTabId: latestSession?.activePlanTabId,
        })
        return { sessions: newSessions }
      })

      // Add user message to UI immediately (update cache if exists)
      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        images: images  // Include images in message for display
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
        const spaceState = newSpaceStates.get(currentSpaceId)
        if (spaceState) {
          newSpaceStates.set(currentSpaceId, {
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

      // Build Canvas Context for AI awareness
      // This allows AI to naturally understand what the user is currently viewing
      const buildCanvasContext = (): CanvasContext | undefined => {
        if (!canvasLifecycle.getIsOpen() || canvasLifecycle.getTabCount() === 0) {
          return undefined
        }

        const tabs = canvasLifecycle.getTabs()
        const activeTabId = canvasLifecycle.getActiveTabId()
        const activeTab = canvasLifecycle.getActiveTab()

        return {
          isOpen: true,
          tabCount: tabs.length,
          activeTab: activeTab ? {
            type: activeTab.type,
            title: activeTab.title,
            url: activeTab.url,
            path: activeTab.path
          } : null,
          tabs: tabs.map(t => ({
            type: t.type,
            title: t.title,
            url: t.url,
            path: t.path,
            isActive: t.id === activeTabId
          }))
        }
      }

      const context = invocationContext || 'interactive'
      if (context !== 'interactive' && context !== 'workflow-step') {
        throw new Error(`Unsupported invocationContext from renderer: ${context}`)
      }

      const baseRequest = {
        spaceId: currentSpaceId,
        conversationId,
        message: content,
        images: images,  // Pass images to API
        aiBrowserEnabled,  // Pass AI Browser state to API
        thinkingEnabled,  // Pass thinking mode to API
        planEnabled: effectivePlanEnabled,  // Pass plan mode to API
        canvasContext: buildCanvasContext(),  // Pass canvas context for AI awareness
        fileContexts: fileContexts  // Pass file contexts for context injection
      }

      if (context === 'workflow-step') {
        await api.sendWorkflowStepMessage(baseRequest)
      } else {
        await api.sendMessage({
          ...baseRequest,
          invocationContext: 'interactive'
        })
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      // Update session error state
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: 'Failed to send message',
          isGenerating: false,
          isThinking: false,
          planEnabled: session.planEnabled,
          activePlanTabId: session.activePlanTabId,
        })
        return { sessions: newSessions }
      })
    }
  },

  // Send message to a specific conversation (for Chat Tabs - avoids global context switching)
  sendMessageToConversation: async (spaceId, conversationId, content, images, thinkingEnabled, fileContexts, aiBrowserEnabled, planEnabled, invocationContext) => {
    if (!spaceId || !conversationId) {
      console.error('[ChatStore] spaceId and conversationId are required')
      return
    }

    const snapshotSession = get().sessions.get(conversationId)
    const effectivePlanEnabled = planEnabled ?? snapshotSession?.planEnabled ?? false

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        const latestSession = newSessions.get(conversationId)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          lifecycle: 'running',
          terminalReason: null,
          isGenerating: true,
          isThinking: true,
          planEnabled: effectivePlanEnabled,
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
        images: images,
        aiBrowserEnabled: aiBrowserEnabled ?? false,
        thinkingEnabled,
        planEnabled: effectivePlanEnabled,
        canvasContext: undefined as undefined, // No canvas context for tab messages
        fileContexts: fileContexts
      }

      if (context === 'workflow-step') {
        await api.sendWorkflowStepMessage(baseRequest)
      } else {
        await api.sendMessage({
          ...baseRequest,
          invocationContext: 'interactive'
        })
      }
    } catch (error) {
      console.error('Failed to send message to conversation:', error)
      // Update session error state
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          error: 'Failed to send message',
          isGenerating: false,
          isThinking: false,
          planEnabled: session.planEnabled,
          activePlanTabId: session.activePlanTabId,
        })
        return { sessions: newSessions }
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
        false
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
              askUserQuestionsById: {},
              askUserQuestionOrder: [],
              activeAskUserQuestionId: null
            })
          }
          return { sessions: newSessions }
        })
        useTaskStore.getState().finalizeTasksOnTerminal('stopped')
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
        askUserQuestionsById: {},
        askUserQuestionOrder: [],
        activeAskUserQuestionId: null,
        thoughts: [...session.thoughts, errorThought]
      })
      return { sessions: newSessions }
    })

    if (shouldFinalizeTasks) {
      useTaskStore.getState().finalizeTasksOnTerminal('error')
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
          isThinking: false
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
        const updatedConversation = conversationResponse.data as ConversationWithAi

        // Extract updated metadata
        const updatedMeta: ConversationMetaWithAi = {
          id: updatedConversation.id,
          spaceId: updatedConversation.spaceId,
          title: updatedConversation.title,
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
          newCache.set(conversationId, updatedConversation)

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
              isGenerating: false,
              streamingContent: '',
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
      if (appliedFallback) {
        return
      }
      // Even on error without fallback, must clear state to avoid stale content
      set((state) => {
        const newSessions = new Map(state.sessions)
        const currentSession = newSessions.get(conversationId)
        if (currentSession) {
          newSessions.set(conversationId, {
            ...currentSession,
            isGenerating: false,
            streamingContent: '',
            askUserQuestionsById: {},
            askUserQuestionOrder: [],
            activeAskUserQuestionId: null,
            compactInfo: null  // Clear temporary compact notification
          })
        }
        return { sessions: newSessions }
      })
    }
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
      loadingConversationCounts: new Map()
    })
  },

  // Reset a specific space's state (use when needed)
  resetSpace: (spaceId: string) => {
    set((state) => {
      const newSpaceStates = new Map(state.spaceStates)
      newSpaceStates.delete(spaceId)
      const newChangeSets = new Map(state.changeSets)
      for (const [conversationId, changeSets] of newChangeSets.entries()) {
        if (changeSets.some(cs => cs.spaceId === spaceId)) {
          newChangeSets.delete(conversationId)
        }
      }
      return { spaceStates: newSpaceStates, changeSets: newChangeSets }
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
