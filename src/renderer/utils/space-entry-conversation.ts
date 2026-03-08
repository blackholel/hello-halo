import type { ConversationMeta } from '../types'

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Pick reusable draft conversation for initial space entry.
 * A reusable draft is an empty conversation (messageCount === 0).
 * If multiple drafts exist, pick the newest by updatedAt.
 */
export function pickEntryConversation(conversations: ConversationMeta[]): ConversationMeta | null {
  const drafts = conversations.filter((conversation) => conversation.messageCount === 0)
  if (drafts.length === 0) return null

  return drafts.reduce((latest, conversation) => {
    return toTimestamp(conversation.updatedAt) > toTimestamp(latest.updatedAt)
      ? conversation
      : latest
  })
}
