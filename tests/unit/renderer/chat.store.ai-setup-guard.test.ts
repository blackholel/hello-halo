import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../src/renderer/i18n'

const mockSendMessage = vi.fn()
const mockSendWorkflowStepMessage = vi.fn()
const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockStopGeneration = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    sendWorkflowStepMessage: (...args: unknown[]) => mockSendWorkflowStepMessage(...args),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    listChangeSets: (...args: unknown[]) => mockListChangeSets(...args),
    stopGeneration: (...args: unknown[]) => mockStopGeneration(...args)
  }
}))

vi.mock('../../../src/renderer/services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: () => false,
    getTabCount: () => 0,
    getTabs: () => [],
    getActiveTabId: () => null,
    getActiveTab: () => null
  }
}))

import { useChatStore } from '../../../src/renderer/stores/chat.store'

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
              title: 'AI Setup Guard',
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
          title: 'AI Setup Guard',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: []
        }
      ]
    ])
  })
}

describe('chat.store AI setup guard', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockSendMessage.mockReset()
    mockSendWorkflowStepMessage.mockReset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockStopGeneration.mockReset()
    mockSendMessage.mockResolvedValue({ success: true })
    mockSendWorkflowStepMessage.mockResolvedValue({ success: true })
    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockStopGeneration.mockResolvedValue({ success: true })
  })

  it('blocks submitTurn before API call when profile is not configured', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-ai-guard'
    seedConversation(spaceId, conversationId)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'hello',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
    expect(useChatStore.getState().getQueueError(conversationId)).toBe(
      i18n.t('Please configure AI profile first')
    )
    expect(useChatStore.getState().getSession(conversationId).error).toBe(
      i18n.t('Please configure AI profile first')
    )
  })
})
