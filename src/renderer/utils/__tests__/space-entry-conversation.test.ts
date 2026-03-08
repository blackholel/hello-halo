import { describe, expect, it } from 'vitest'
import type { ConversationMeta } from '../../types'
import { pickEntryConversation } from '../space-entry-conversation'

function createConversationMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'conv-default',
    spaceId: 'space-1',
    title: '默认会话',
    createdAt: '2026-03-08T08:00:00.000Z',
    updatedAt: '2026-03-08T08:00:00.000Z',
    messageCount: 1,
    ...overrides
  }
}

describe('space-entry-conversation', () => {
  it('无会话时返回 null', () => {
    expect(pickEntryConversation([])).toBeNull()
  })

  it('只有历史会话时返回 null（由上层创建新会话）', () => {
    const conversations = [
      createConversationMeta({ id: 'conv-1', messageCount: 9, updatedAt: '2026-03-08T08:05:00.000Z' }),
      createConversationMeta({ id: 'conv-2', messageCount: 3, updatedAt: '2026-03-08T08:03:00.000Z' })
    ]

    expect(pickEntryConversation(conversations)).toBeNull()
  })

  it('存在空白会话时优先返回最新空白会话，而不是首条历史会话', () => {
    const conversations = [
      createConversationMeta({ id: 'conv-history', messageCount: 12, updatedAt: '2026-03-08T09:00:00.000Z' }),
      createConversationMeta({ id: 'conv-draft-old', messageCount: 0, updatedAt: '2026-03-08T08:30:00.000Z' }),
      createConversationMeta({ id: 'conv-draft-new', messageCount: 0, updatedAt: '2026-03-08T10:30:00.000Z' })
    ]

    expect(pickEntryConversation(conversations)?.id).toBe('conv-draft-new')
  })
})
