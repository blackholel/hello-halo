export type SessionKey = string

export function buildSessionKey(spaceId: string, conversationId: string): SessionKey {
  return `${spaceId}:${conversationId}`
}

