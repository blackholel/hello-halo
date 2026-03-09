import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSet } from '../../../src/renderer/types'

const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockGetSessionState = vi.fn()
const mockEnsureSessionWarm = vi.fn()
const mockSubscribeToConversation = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    listChangeSets: (...args: unknown[]) => mockListChangeSets(...args),
    getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
    ensureSessionWarm: (...args: unknown[]) => mockEnsureSessionWarm(...args),
    subscribeToConversation: (...args: unknown[]) => mockSubscribeToConversation(...args)
  }
}))

vi.mock('../../../src/renderer/services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: () => false,
    getTabCount: () => 0,
    getTabs: () => [],
    getActiveTabId: () => null,
    getActiveTab: () => null,
    openPlan: vi.fn().mockResolvedValue('tab-plan')
  }
}))

import { useChatStore } from '../../../src/renderer/stores/chat.store'

function buildChangeSet(conversationId: string): ChangeSet {
  return {
    id: 'cs-1',
    spaceId: 'space-1',
    conversationId,
    createdAt: new Date().toISOString(),
    status: 'applied',
    summary: {
      totalFiles: 1,
      totalAdded: 3,
      totalRemoved: 1
    },
    files: [
      {
        id: 'cf-1',
        path: '/workspace/src/demo.ts',
        relativePath: 'src/demo.ts',
        fileName: 'demo.ts',
        type: 'edit',
        status: 'accepted',
        beforeExists: true,
        afterExists: true,
        beforeContent: 'old',
        afterContent: 'new',
        stats: { added: 3, removed: 1 }
      }
    ]
  }
}

describe('chat.store change-set resilience', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockGetSessionState.mockReset()
    mockEnsureSessionWarm.mockReset()
    mockSubscribeToConversation.mockReset()

    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockGetSessionState.mockResolvedValue({ success: true, data: { isActive: false, thoughts: [] } })
    mockEnsureSessionWarm.mockResolvedValue({ success: true })
  })

  it('handleAgentComplete still updates change sets when conversation reload fails', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-complete-resilience'
    const now = new Date().toISOString()
    const changeSet = buildChangeSet(conversationId)

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
                title: 'Resilience',
                createdAt: now,
                updatedAt: now,
                messageCount: 1
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
            title: 'Resilience',
            createdAt: now,
            updatedAt: now,
            messageCount: 1,
            messages: [
              {
                id: 'assistant-1',
                role: 'assistant',
                content: '',
                timestamp: now
              }
            ]
          }
        ]
      ])
    })

    useChatStore.getState().handleAgentRunStart({
      spaceId,
      conversationId,
      runId: 'run-resilience',
      startedAt: now
    })

    mockGetConversation.mockRejectedValueOnce(new Error('conversation endpoint failed'))
    mockListChangeSets.mockResolvedValueOnce({ success: true, data: [changeSet] })

    await useChatStore.getState().handleAgentComplete({
      type: 'complete',
      spaceId,
      conversationId,
      runId: 'run-resilience',
      reason: 'completed',
      finalContent: 'fallback'
    })

    expect(useChatStore.getState().changeSets.get(conversationId)).toEqual([changeSet])
  })

  it('hydrateConversation still updates change sets when conversation request fails', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-hydrate-resilience'
    const now = new Date().toISOString()
    const changeSet = buildChangeSet(conversationId)

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
                title: 'Hydrate Resilience',
                createdAt: now,
                updatedAt: now,
                messageCount: 0
              }
            ],
            currentConversationId: conversationId
          }
        ]
      ])
    })

    mockGetConversation.mockRejectedValueOnce(new Error('conversation hydrate failed'))
    mockListChangeSets.mockResolvedValueOnce({ success: true, data: [changeSet] })

    await useChatStore.getState().hydrateConversation(spaceId, conversationId)

    expect(useChatStore.getState().changeSets.get(conversationId)).toEqual([changeSet])
    expect(mockSubscribeToConversation).toHaveBeenCalledWith(conversationId)
  })
})

