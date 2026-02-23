import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../api', () => ({
  api: {
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

describe('chat.store updateConversationAi', () => {
  beforeEach(() => {
    useChatStore.setState({
      currentSpaceId: 'space-1',
      spaceStates: new Map([[
        'space-1',
        {
          conversations: [{
            id: 'conv-1',
            spaceId: 'space-1',
            title: 'Conversation',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            messageCount: 0,
            ai: { profileId: 'p1', modelOverride: '' }
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
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 0,
          messages: [],
          ai: { profileId: 'p1', modelOverride: '' }
        }
      ]]),
      sessions: new Map(),
      changeSets: new Map(),
      loadingConversationCounts: new Map(),
      artifacts: [],
      isLoading: false
    })
    vi.clearAllMocks()
  })

  it('同步更新 cache 和 metadata 的 ai 配置', async () => {
    ;(api.updateConversation as Mock).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'conv-1',
        spaceId: 'space-1',
        title: 'Conversation',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        messageCount: 0,
        messages: [],
        ai: { profileId: 'p2', modelOverride: 'model-x' }
      }
    })

    const ok = await useChatStore.getState().updateConversationAi('space-1', 'conv-1', {
      profileId: 'p2',
      modelOverride: 'model-x'
    })

    expect(ok).toBe(true)

    const meta = useChatStore.getState().getConversations()[0]
    const cached = useChatStore.getState().getCachedConversation('conv-1')

    expect(meta.ai).toEqual({ profileId: 'p2', modelOverride: 'model-x' })
    expect(cached?.ai).toEqual({ profileId: 'p2', modelOverride: 'model-x' })
    expect(meta.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(cached?.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('后端失败时返回 false 且不改本地状态', async () => {
    ;(api.updateConversation as Mock).mockResolvedValueOnce({ success: false, error: 'bad request' })

    const ok = await useChatStore.getState().updateConversationAi('space-1', 'conv-1', {
      profileId: 'p2',
      modelOverride: 'model-x'
    })

    expect(ok).toBe(false)
    const meta = useChatStore.getState().getConversations()[0]
    expect(meta.ai).toEqual({ profileId: 'p1', modelOverride: '' })
  })
})
