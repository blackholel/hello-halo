import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../api', () => ({
  api: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    sendWorkflowStepMessage: vi.fn().mockResolvedValue({ success: true }),
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
  default: { t: (key: string) => key },
  getCurrentLanguage: () => 'ja'
}))

vi.mock('../../utils/thought-utils', () => ({
  buildParallelGroups: vi.fn().mockReturnValue(new Map()),
  getThoughtKey: vi.fn().mockReturnValue('k')
}))

import { api } from '../../api'
import { useAppStore } from '../app.store'
import { useChatStore } from '../chat.store'

function seedConversation(spaceId: string, conversationId: string): void {
  const now = new Date().toISOString()
  useChatStore.setState({
    currentSpaceId: spaceId,
    spaceStates: new Map([
      [
        spaceId,
        {
          conversations: [
            {
              id: conversationId,
              spaceId,
              title: 'Response Language',
              createdAt: now,
              updatedAt: now,
              messageCount: 0,
              preview: ''
            }
          ],
          currentConversationId: conversationId
        }
      ]
    ]),
    conversationCache: new Map([
      [
        conversationId,
        {
          id: conversationId,
          spaceId,
          title: 'Response Language',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: []
        }
      ]
    ])
  })
}

describe('chat.store responseLanguage request building', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    vi.clearAllMocks()
    useAppStore.setState({
      config: {
        api: {
          provider: 'anthropic',
          apiKey: 'test-key',
          apiUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5-20250929'
        }
      }
    } as any)
  })

  it('sendMessageToConversation interactive 请求包含 responseLanguage', async () => {
    seedConversation('space-1', 'conv-1')
    await useChatStore.getState().sendMessageToConversation(
      'space-1',
      'conv-1',
      'hello',
      undefined,
      false,
      undefined,
      false,
      'code',
      'interactive'
    )

    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect((api.sendMessage as Mock).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv-1',
        message: 'hello',
        responseLanguage: 'ja',
        invocationContext: 'interactive'
      })
    )
  })

  it('sendMessageToConversation workflow-step 请求包含 responseLanguage', async () => {
    seedConversation('space-1', 'conv-2')
    await useChatStore.getState().sendMessageToConversation(
      'space-1',
      'conv-2',
      'step run',
      undefined,
      false,
      undefined,
      false,
      'code',
      'workflow-step'
    )

    expect(api.sendWorkflowStepMessage).toHaveBeenCalledTimes(1)
    expect((api.sendWorkflowStepMessage as Mock).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv-2',
        message: 'step run',
        responseLanguage: 'ja'
      })
    )
  })
})
