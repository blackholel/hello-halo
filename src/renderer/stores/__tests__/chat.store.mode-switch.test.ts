import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../api', () => ({
  api: {
    setAgentMode: vi.fn(),
    updateConversation: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getConversation: vi.fn().mockResolvedValue({ success: false }),
    listChangeSets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSessionState: vi.fn().mockResolvedValue({ success: true, data: { isActive: false, thoughts: [] } }),
    listConversations: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createConversation: vi.fn().mockResolvedValue({ success: true, data: null }),
    deleteConversation: vi.fn().mockResolvedValue({ success: true }),
    stopGeneration: vi.fn().mockResolvedValue(undefined),
    ensureSessionWarm: vi.fn().mockResolvedValue(undefined),
    subscribeToConversation: vi.fn()
  }
}))

vi.mock('../../services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: vi.fn().mockReturnValue(false),
    getTabCount: vi.fn().mockReturnValue(0),
    getTabs: vi.fn().mockReturnValue([]),
    getActiveTabId: vi.fn().mockReturnValue(null),
    getActiveTab: vi.fn().mockReturnValue(null),
    openPlan: vi.fn().mockResolvedValue('plan-tab-1')
  }
}))

vi.mock('../../i18n', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('../../utils/thought-utils', () => ({
  buildParallelGroups: vi.fn().mockReturnValue(new Map()),
  getThoughtKey: vi.fn().mockReturnValue('k')
}))

import { api } from '../../api'
import { useChatStore } from '../chat.store'

function seedRunningConversation(): void {
  useChatStore.setState({
    currentSpaceId: 'space-1',
    spaceStates: new Map([[
      'space-1',
      {
        conversations: [{
          id: 'conv-1',
          spaceId: 'space-1',
          title: 'Conversation',
          mode: 'code',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 0
        }],
        currentConversationId: 'conv-1'
      }
    ]]),
    conversationCache: new Map([[
      'conv-1',
      {
        id: 'conv-1',
        spaceId: 'space-1',
        title: 'Conversation',
        mode: 'code',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 0,
        messages: []
      }
    ]]),
    sessions: new Map([[
      'conv-1',
      {
        activeRunId: 'run-1',
        mode: 'code',
        modeSwitching: false,
        lifecycle: 'running',
        terminalReason: null,
        isGenerating: true,
        streamingContent: '',
        isStreaming: false,
        thoughts: [],
        processTrace: [],
        isThinking: true,
        pendingToolApproval: null,
        pendingAskUserQuestion: null,
        failedAskUserQuestion: null,
        error: null,
        compactInfo: null,
        textBlockVersion: 0,
        toolStatusById: {},
        toolCallsById: {},
        orphanToolResults: {},
        availableToolsSnapshot: {
          runId: 'run-1',
          snapshotVersion: 0,
          emittedAt: null,
          tools: [],
          toolCount: 0
        },
        pendingRunEvents: [],
        parallelGroups: new Map(),
        activeAgentIds: [],
        activePlanTabId: undefined
      }
    ]]),
    changeSets: new Map(),
    loadingConversationCounts: new Map(),
    artifacts: [],
    isLoading: false
  })
}

describe('chat.store setConversationMode', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    seedRunningConversation()
    vi.clearAllMocks()
  })

  it('running conversation: runtime success + persist success', async () => {
    ;(api.setAgentMode as Mock).mockResolvedValueOnce({
      success: true,
      data: { applied: true, mode: 'plan', runId: 'run-1' }
    })
    ;(api.updateConversation as Mock).mockResolvedValueOnce({
      success: true,
      data: { mode: 'plan' }
    })

    const ok = await useChatStore.getState().setConversationMode('space-1', 'conv-1', 'plan')
    expect(ok).toBe(true)
    expect(api.setAgentMode).toHaveBeenNthCalledWith(1, 'conv-1', 'plan', 'run-1')
    expect(api.updateConversation).toHaveBeenCalledWith('space-1', 'conv-1', { mode: 'plan' })
    expect(useChatStore.getState().getSession('conv-1').mode).toBe('plan')
    expect(useChatStore.getState().getSession('conv-1').modeSwitching).toBe(false)
  })

  it('running conversation: no_active_session does not rollback and still persists', async () => {
    ;(api.setAgentMode as Mock).mockResolvedValueOnce({
      success: true,
      data: { applied: false, mode: 'ask', reason: 'no_active_session' }
    })
    ;(api.updateConversation as Mock).mockResolvedValueOnce({
      success: true,
      data: { mode: 'ask' }
    })

    const ok = await useChatStore.getState().setConversationMode('space-1', 'conv-1', 'ask')
    expect(ok).toBe(true)
    expect(api.setAgentMode).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getSession('conv-1').mode).toBe('ask')
  })

  it('running conversation: persist failure triggers runtime compensation rollback', async () => {
    ;(api.setAgentMode as Mock).mockResolvedValueOnce({
      success: true,
      data: { applied: true, mode: 'plan', runId: 'run-1' }
    })
    ;(api.updateConversation as Mock).mockResolvedValueOnce({
      success: false,
      error: 'disk write failed'
    })
    ;(api.setAgentMode as Mock).mockResolvedValueOnce({
      success: true,
      data: { applied: true, mode: 'code', runId: 'run-1' }
    })

    const ok = await useChatStore.getState().setConversationMode('space-1', 'conv-1', 'plan')
    expect(ok).toBe(false)
    expect(api.setAgentMode).toHaveBeenNthCalledWith(2, 'conv-1', 'code', 'run-1')
    expect(useChatStore.getState().getSession('conv-1').mode).toBe('code')
    expect(useChatStore.getState().getSession('conv-1').modeSwitching).toBe(false)
  })
})
