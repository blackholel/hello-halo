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
import type { Conversation, ConversationMeta, Message, ToolCall, Artifact, Thought, AgentEventBase, ImageAttachment, CompactInfo, CanvasContext, FileContextAttachment, ParallelGroup, ChangeSet } from '../types'
import { canvasLifecycle } from '../services/canvas-lifecycle'
import { buildParallelGroups, getThoughtKey } from '../utils/thought-utils'

// LRU cache size limit
const CONVERSATION_CACHE_SIZE = 10

// Per-space state (conversations metadata belong to a space)
interface SpaceState {
  conversations: ConversationMeta[]  // Lightweight metadata, no messages
  currentConversationId: string | null
}

// Per-session runtime state (isolated per conversation, persists across space switches)
interface SessionState {
  isGenerating: boolean
  streamingContent: string
  isStreaming: boolean  // True during token-level text streaming
  thoughts: Thought[]
  isThinking: boolean
  pendingToolApproval: ToolCall | null
  pendingAskUserQuestion: ToolCall | null
  failedAskUserQuestion: ToolCall | null
  error: string | null
  // Compact notification
  compactInfo: CompactInfo | null
  // Text block version - increments on each new text block (for StreamingBubble reset)
  textBlockVersion: number

  // === Tree and parallel group support ===
  // Parallel operation groups (for side-by-side display)
  parallelGroups: Map<string, ParallelGroup>
  // Currently active sub-agent IDs (Task tools that haven't completed)
  activeAgentIds: string[]
}

// Create empty session state
function createEmptySessionState(): SessionState {
  return {
    isGenerating: false,
    streamingContent: '',
    isStreaming: false,
    thoughts: [],
    isThinking: false,
    pendingToolApproval: null,
    pendingAskUserQuestion: null,
    failedAskUserQuestion: null,
    error: null,
    compactInfo: null,
    textBlockVersion: 0,
    // New fields
    parallelGroups: new Map(),
    activeAgentIds: []
  }
}

// Create empty space state
function createEmptySpaceState(): SpaceState {
  return {
    conversations: [],
    currentConversationId: null
  }
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
  isLoadingConversation: boolean  // Loading full conversation

  // Computed getters
  getCurrentSpaceState: () => SpaceState
  getSpaceState: (spaceId: string) => SpaceState
  getCurrentConversation: () => Conversation | null
  getCurrentConversationMeta: () => ConversationMeta | null
  getCurrentSession: () => SessionState
  getSession: (conversationId: string) => SessionState
  getChangeSets: (conversationId: string) => ChangeSet[]
  getConversations: () => ConversationMeta[]
  getCurrentConversationId: () => string | null
  getCachedConversation: (conversationId: string) => Conversation | null

  // Space actions
  setCurrentSpace: (spaceId: string) => void

  // Conversation actions
  loadConversations: (spaceId: string) => Promise<void>
  createConversation: (spaceId: string, title?: string) => Promise<Conversation | null>
  selectConversation: (conversationId: string) => void
  deleteConversation: (spaceId: string, conversationId: string) => Promise<boolean>
  renameConversation: (spaceId: string, conversationId: string, newTitle: string) => Promise<boolean>

  // Messaging
  sendMessage: (content: string, images?: ImageAttachment[], aiBrowserEnabled?: boolean, thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], planEnabled?: boolean) => Promise<void>
  sendMessageToConversation: (spaceId: string, conversationId: string, content: string, images?: ImageAttachment[], thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], aiBrowserEnabled?: boolean, planEnabled?: boolean) => Promise<void>
  stopGeneration: (conversationId?: string) => Promise<void>

  // Tool approval
  approveTool: (conversationId: string) => Promise<void>
  rejectTool: (conversationId: string) => Promise<void>
  answerQuestion: (conversationId: string, answer: string) => Promise<void>
  dismissAskUserQuestion: (conversationId: string) => void

  // Event handlers (called from App component) - with session IDs
  handleAgentMessage: (data: AgentEventBase & { content: string; isComplete: boolean }) => void
  handleAgentToolCall: (data: AgentEventBase & ToolCall) => void
  handleAgentToolResult: (data: AgentEventBase & { toolId: string; result: string; isError: boolean }) => void
  handleAgentError: (data: AgentEventBase & { error: string }) => void
  handleAgentComplete: (data: AgentEventBase) => void
  handleAgentThought: (data: AgentEventBase & { thought: Thought }) => void
  handleAgentCompact: (data: AgentEventBase & { trigger: 'manual' | 'auto'; preTokens: number }) => void

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

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  spaceStates: new Map<string, SpaceState>(),
  conversationCache: new Map<string, Conversation>(),
  sessions: new Map<string, SessionState>(),
  changeSets: new Map<string, ChangeSet[]>(),
  currentSpaceId: null,
  artifacts: [],
  isLoading: false,
  isLoadingConversation: false,

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
        const conversations = response.data as ConversationMeta[]

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
        const newConversation = response.data as Conversation

        // Extract metadata for the list
        const meta: ConversationMeta = {
          id: newConversation.id,
          spaceId: newConversation.spaceId,
          title: newConversation.title,
          createdAt: newConversation.createdAt,
          updatedAt: newConversation.updatedAt,
          messageCount: newConversation.messages?.length || 0,
          preview: undefined
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

  // Select conversation (changes pointer, loads full conversation on-demand)
  selectConversation: async (conversationId) => {
    const { currentSpaceId, spaceStates, conversationCache } = get()
    if (!currentSpaceId) return

    const spaceState = spaceStates.get(currentSpaceId)
    if (!spaceState) return

    const conversationMeta = spaceState.conversations.find((c) => c.id === conversationId)
    if (!conversationMeta) return

    // Subscribe to conversation events (for remote mode)
    api.subscribeToConversation(conversationId)

    // Update the pointer first
    set((state) => {
      const newSpaceStates = new Map(state.spaceStates)
      newSpaceStates.set(currentSpaceId, {
        ...spaceState,
        currentConversationId: conversationId
      })
      return { spaceStates: newSpaceStates }
    })

    // Load full conversation, session state, and change sets in parallel (async-parallel)
    // These are independent operations that can run concurrently
    const needsConversationLoad = !conversationCache.has(conversationId)

    if (needsConversationLoad) {
      set({ isLoadingConversation: true })
    }

    try {
      // Start both requests in parallel
      const conversationPromise = needsConversationLoad
        ? api.getConversation(currentSpaceId, conversationId)
        : Promise.resolve(null)
      const sessionStatePromise = api.getSessionState(conversationId)
      const changeSetsPromise = api.listChangeSets(currentSpaceId, conversationId)

      const [conversationResponse, sessionResponse, changeSetsResponse] = await Promise.all([
        conversationPromise,
        sessionStatePromise,
        changeSetsPromise
      ])

      // Handle conversation response
      if (conversationResponse?.success && conversationResponse.data) {
        const fullConversation = conversationResponse.data as Conversation

        set((state) => {
          const newCache = new Map(state.conversationCache)
          newCache.set(conversationId, fullConversation)

          // LRU eviction
          if (newCache.size > CONVERSATION_CACHE_SIZE) {
            const firstKey = newCache.keys().next().value
            if (firstKey) newCache.delete(firstKey)
          }

          return { conversationCache: newCache, isLoadingConversation: false }
        })
      } else if (needsConversationLoad) {
        set({ isLoadingConversation: false })
      }

      // Handle session state response
      if (sessionResponse.success && sessionResponse.data) {
        const sessionState = sessionResponse.data as { isActive: boolean; thoughts: Thought[]; spaceId?: string }

        if (sessionState.isActive && sessionState.thoughts.length > 0) {
          set((state) => {
            const newSessions = new Map(state.sessions)
            const existingSession = newSessions.get(conversationId) || createEmptySessionState()

            newSessions.set(conversationId, {
              ...existingSession,
              isGenerating: true,
              isThinking: true,
              thoughts: sessionState.thoughts
            })

            return { sessions: newSessions }
          })
        }
      }

      // Handle change set response
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
      if (needsConversationLoad) {
        set({ isLoadingConversation: false })
      }
    }

    // Warm up V2 Session in background - non-blocking
    // When user sends a message, V2 Session is ready to avoid delay
    try {
      api.ensureSessionWarm(currentSpaceId, conversationId)
        .catch((error) => console.error('[ChatStore] Session warm up failed:', error))
    } catch (error) {
      console.error('[ChatStore] Failed to trigger session warm up:', error)
    }
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

          // Update space state
          const newSpaceStates = new Map(state.spaceStates)
          const existingState = newSpaceStates.get(spaceId) || createEmptySpaceState()
          const newConversations = existingState.conversations.filter((c) => c.id !== conversationId)

          newSpaceStates.set(spaceId, {
            conversations: newConversations,
            currentConversationId:
              existingState.currentConversationId === conversationId
                ? (newConversations[0]?.id || null)
                : existingState.currentConversationId
          })

          return {
            spaceStates: newSpaceStates,
            sessions: newSessions,
            conversationCache: newCache,
            changeSets: newChangeSets
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

  // Send message (with optional images for multi-modal, optional AI Browser and thinking mode, optional file contexts, optional plan mode)
  sendMessage: async (content, images, aiBrowserEnabled, thinkingEnabled, fileContexts, planEnabled) => {
    const conversation = get().getCurrentConversation()
    const conversationMeta = get().getCurrentConversationMeta()
    const { currentSpaceId } = get()

    if ((!conversation && !conversationMeta) || !currentSpaceId) {
      console.error('[ChatStore] No conversation or space selected')
      return
    }

    const conversationId = conversationMeta?.id || conversation?.id
    if (!conversationId) return

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          isGenerating: true,
          isThinking: true
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

      // Send to agent (with images, AI Browser state, thinking mode, plan mode, canvas context, and file contexts)
      await api.sendMessage({
        spaceId: currentSpaceId,
        conversationId,
        message: content,
        images: images,  // Pass images to API
        aiBrowserEnabled,  // Pass AI Browser state to API
        thinkingEnabled,  // Pass thinking mode to API
        planEnabled,  // Pass plan mode to API
        canvasContext: buildCanvasContext(),  // Pass canvas context for AI awareness
        fileContexts: fileContexts  // Pass file contexts for context injection
      })
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
          isThinking: false
        })
        return { sessions: newSessions }
      })
    }
  },

  // Send message to a specific conversation (for Chat Tabs - avoids global context switching)
  sendMessageToConversation: async (spaceId, conversationId, content, images, thinkingEnabled, fileContexts, aiBrowserEnabled, planEnabled) => {
    if (!spaceId || !conversationId) {
      console.error('[ChatStore] spaceId and conversationId are required')
      return
    }

    try {
      // Initialize/reset session state for this conversation
      set((state) => {
        const newSessions = new Map(state.sessions)
        newSessions.set(conversationId, {
          ...createEmptySessionState(),
          isGenerating: true,
          isThinking: true
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

      // Send to agent (without AI Browser for tab context, with thinking mode, plan mode and file contexts)
      await api.sendMessage({
        spaceId,
        conversationId,
        message: content,
        images: images,
        aiBrowserEnabled: aiBrowserEnabled ?? false,
        thinkingEnabled,
        planEnabled,
        canvasContext: undefined, // No canvas context for tab messages
        fileContexts: fileContexts
      })
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
          isThinking: false
        })
        return { sessions: newSessions }
      })
    }
  },

  // Stop generation for a specific conversation
  stopGeneration: async (conversationId?: string) => {
    const targetId = conversationId || get().getCurrentSpaceState().currentConversationId
    try {
      await api.stopGeneration(targetId)

      if (targetId) {
        set((state) => {
          const newSessions = new Map(state.sessions)
          const session = newSessions.get(targetId)
          if (session) {
            newSessions.set(targetId, {
              ...session,
              isGenerating: false,
              isThinking: false,
              pendingAskUserQuestion: null,
              failedAskUserQuestion: null
            })
          }
          return { sessions: newSessions }
        })
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
  answerQuestion: async (conversationId: string, answer: string) => {
    try {
      const response = await api.answerQuestion(conversationId, answer)
      if (!response.success) {
        const reason = response.error || 'Failed to submit answer'
        set((state) => {
          const newSessions = new Map(state.sessions)
          const session = newSessions.get(conversationId)
          if (!session) return state

          const failedToolCall = session.pendingAskUserQuestion
            ? {
                ...session.pendingAskUserQuestion,
                status: 'error' as const,
                error: reason,
                output: reason
              }
            : session.failedAskUserQuestion

          newSessions.set(conversationId, {
            ...session,
            isGenerating: false,
            isStreaming: false,
            pendingAskUserQuestion: null,
            failedAskUserQuestion: failedToolCall
          })
          return { sessions: newSessions }
        })
        return
      }

      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId)
        if (session) {
          newSessions.set(conversationId, {
            ...session,
            pendingAskUserQuestion: null,
            failedAskUserQuestion: null
          })
        }
        return { sessions: newSessions }
      })
    } catch (error) {
      console.error('Failed to answer question:', error)
      throw error
    }
  },

  dismissAskUserQuestion: (conversationId: string) => {
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId)
      if (!session) return state

      newSessions.set(conversationId, {
        ...session,
        pendingAskUserQuestion: null,
        failedAskUserQuestion: null
      })
      return { sessions: newSessions }
    })
  },

  // Handle agent message - update session-specific streaming content
  // Supports both incremental (delta) and full (content) modes for backward compatibility
  handleAgentMessage: (data) => {
    const { conversationId, content, delta, isStreaming, isNewTextBlock } = data as AgentEventBase & {
      content?: string
      delta?: string
      isComplete: boolean
      isStreaming?: boolean
      isNewTextBlock?: boolean  // Signal from content_block_start (type='text')
    }

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

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
        streamingContent: newContent,
        isStreaming: isStreaming ?? false,
        textBlockVersion: newTextBlockVersion
      })
      return { sessions: newSessions }
    })
  },

  // Handle tool call for a specific conversation
  handleAgentToolCall: (data) => {
    const { conversationId, ...toolCall } = data

    // Use case-insensitive comparison for AskUserQuestion tool
    const isAskUserQuestion = toolCall.name?.toLowerCase() === 'askuserquestion'
    if (toolCall.requiresApproval || isAskUserQuestion) {
      set((state) => {
        const newSessions = new Map(state.sessions)
        const session = newSessions.get(conversationId) || createEmptySessionState()
        newSessions.set(conversationId, {
          ...session,
          pendingToolApproval: toolCall.requiresApproval ? (toolCall as ToolCall) : session.pendingToolApproval,
          pendingAskUserQuestion: isAskUserQuestion ? (toolCall as ToolCall) : session.pendingAskUserQuestion,
          failedAskUserQuestion: isAskUserQuestion ? null : session.failedAskUserQuestion
        })
        return { sessions: newSessions }
      })
    }
  },

  // Handle tool result for a specific conversation
  handleAgentToolResult: (data) => {
    const { conversationId, toolId, result, isError } = data
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId)
      if (!session) return state

      if (session.pendingAskUserQuestion?.id !== toolId) {
        return state
      }

      if (isError) {
        newSessions.set(conversationId, {
          ...session,
          pendingAskUserQuestion: null,
          failedAskUserQuestion: {
            ...session.pendingAskUserQuestion,
            status: 'error',
            error: result,
            output: result
          }
        })
        return { sessions: newSessions }
      }

      newSessions.set(conversationId, {
        ...session,
        pendingAskUserQuestion: null,
        failedAskUserQuestion: null
      })
      return { sessions: newSessions }
    })
  },

  // Handle error for a specific conversation
  handleAgentError: (data) => {
    const { conversationId, error } = data

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
      newSessions.set(conversationId, {
        ...session,
        error,
        isGenerating: false,
        isThinking: false,
        pendingAskUserQuestion: null,
        failedAskUserQuestion: null,
        thoughts: [...session.thoughts, errorThought]
      })
      return { sessions: newSessions }
    })
  },

  // Handle complete - reload conversation from backend (Single Source of Truth)
  // Key: Only set isGenerating=false AFTER backend data is loaded to prevent flash
  handleAgentComplete: async (data) => {
    const { spaceId, conversationId } = data

    // Check if there's a pending AskUserQuestion - if so, don't clear it
    // The user needs to see and answer the question first
    const currentSession = get().sessions.get(conversationId)
    const hasPendingQuestion = currentSession?.pendingAskUserQuestion != null

    // First, just stop streaming indicator but keep isGenerating=true
    // This keeps the streaming bubble visible during backend load
    // IMPORTANT: Don't clear pendingAskUserQuestion - it will be cleared when user answers
    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId)
      if (session) {
        newSessions.set(conversationId, {
          ...session,
          isStreaming: false,
          isThinking: false
          // Don't clear pendingAskUserQuestion - let user answer first
          // Keep isGenerating=true and streamingContent until backend loads
        })
      }
      return { sessions: newSessions }
    })

    // If there's a pending AskUserQuestion, don't reload conversation yet
    // Wait for user to answer, then the answer flow will trigger a new completion
    if (hasPendingQuestion) {
      return
    }

    // Reload conversation from backend (Single Source of Truth)
    // Backend has already saved the complete message with thoughts
    try {
      const [conversationResponse, changeSetsResponse] = await Promise.all([
        api.getConversation(spaceId, conversationId),
        api.listChangeSets(spaceId, conversationId)
      ])
      if (conversationResponse.success && conversationResponse.data) {
        const updatedConversation = conversationResponse.data as Conversation

        // Extract updated metadata
        const updatedMeta: ConversationMeta = {
          id: updatedConversation.id,
          spaceId: updatedConversation.spaceId,
          title: updatedConversation.title,
          createdAt: updatedConversation.createdAt,
          updatedAt: updatedConversation.updatedAt,
          messageCount: updatedConversation.messages?.length || 0,
          preview: updatedConversation.messages?.length
            ? updatedConversation.messages[updatedConversation.messages.length - 1].content.slice(0, 50)
            : undefined
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
              pendingAskUserQuestion: null,
              compactInfo: null  // Clear temporary compact notification
            })
          }

          return {
            spaceStates: newSpaceStates,
            sessions: newSessions,
            conversationCache: newCache
          }
        })
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
      // Even on error, must clear state to avoid stale content
      set((state) => {
        const newSessions = new Map(state.sessions)
        const currentSession = newSessions.get(conversationId)
        if (currentSession) {
          newSessions.set(conversationId, {
            ...currentSession,
            isGenerating: false,
            streamingContent: '',
            pendingAskUserQuestion: null,
            failedAskUserQuestion: null,
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
    const { conversationId, thought } = data

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

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
        thoughts: newThoughts,
        parallelGroups,
        activeAgentIds,
        isThinking: true,
        isGenerating: true // Ensure generating state is set
      })
      return { sessions: newSessions }
    })
  },

  // Handle compact notification - context was compressed
  handleAgentCompact: (data) => {
    const { conversationId, trigger, preTokens } = data

    set((state) => {
      const newSessions = new Map(state.sessions)
      const session = newSessions.get(conversationId) || createEmptySessionState()

      newSessions.set(conversationId, {
        ...session,
        compactInfo: { trigger, preTokens }
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
      isLoadingConversation: false
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
