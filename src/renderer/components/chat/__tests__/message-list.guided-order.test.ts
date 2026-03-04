import { describe, expect, it } from 'vitest'
import type { Message } from '../../../types'
import { splitGuidedMessagesForActiveRun } from '../MessageList'

function createMessage(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content' | 'timestamp'>): Message {
  return {
    ...partial
  } as Message
}

describe('MessageList guided ordering', () => {
  it('moves guided messages for active run into guided section while generating', () => {
    const input: Message[] = [
      createMessage({
        id: 'u-1',
        role: 'user',
        content: 'first',
        timestamp: '2026-03-04T10:00:00.000Z'
      }),
      createMessage({
        id: 'a-1',
        role: 'assistant',
        content: 'processing...',
        timestamp: '2026-03-04T10:00:01.000Z'
      }),
      createMessage({
        id: 'u-guided-current',
        role: 'user',
        content: 'guide current run',
        timestamp: '2026-03-04T10:00:02.000Z',
        guidedMeta: { runId: 'run-1', clientMessageId: 'client-1' }
      }),
      createMessage({
        id: 'u-guided-other',
        role: 'user',
        content: 'guide other run',
        timestamp: '2026-03-04T10:00:03.000Z',
        guidedMeta: { runId: 'run-2' }
      }),
      createMessage({
        id: 'a-placeholder',
        role: 'assistant',
        content: '',
        timestamp: '2026-03-04T10:00:04.000Z'
      })
    ]

    const result = splitGuidedMessagesForActiveRun(input, true, 'run-1')
    expect(result.mainMessages.map((message) => message.id)).toEqual([
      'u-1',
      'a-1',
      'u-guided-other'
    ])
    expect(result.guidedMessages.map((message) => message.id)).toEqual(['u-guided-current'])
  })

  it('keeps original order when not generating', () => {
    const input: Message[] = [
      createMessage({
        id: 'u-1',
        role: 'user',
        content: 'first',
        timestamp: '2026-03-04T10:00:00.000Z'
      }),
      createMessage({
        id: 'u-guided-current',
        role: 'user',
        content: 'guide current run',
        timestamp: '2026-03-04T10:00:02.000Z',
        guidedMeta: { runId: 'run-1', clientMessageId: 'client-1' }
      })
    ]

    const result = splitGuidedMessagesForActiveRun(input, false, 'run-1')
    expect(result.mainMessages.map((message) => message.id)).toEqual([
      'u-1',
      'u-guided-current'
    ])
    expect(result.guidedMessages).toHaveLength(0)
  })
})
