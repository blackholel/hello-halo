import { describe, expect, it } from 'vitest'
import type { Message, Thought } from '../../../types'
import { getMessageThoughtsForDisplay } from '../MessageList'

describe('MessageList thought priority', () => {
  it('prefers persisted message.thoughts when both thoughts and processTrace exist', () => {
    const persistedThoughts: Thought[] = [
      {
        id: 'task-tool-1',
        type: 'tool_use',
        content: 'Sub-agent: run task',
        timestamp: '2026-02-16T10:00:00.000Z',
        toolName: 'Task',
        parentToolUseId: 'parent-1'
      }
    ]

    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-02-16T10:00:10.000Z',
      thoughts: persistedThoughts,
      processTrace: [
        {
          type: 'process',
          kind: 'tool_call',
          ts: '2026-02-16T10:00:00.000Z',
          payload: {
            toolCallId: 'task-tool-1',
            name: 'Task',
            input: { description: 'run task' }
          }
        }
      ]
    }

    const resolved = getMessageThoughtsForDisplay(message)
    expect(resolved).toBe(persistedThoughts)
    expect(resolved[0]?.parentToolUseId).toBe('parent-1')
  })

  it('falls back to processTrace reconstruction when message.thoughts is empty', () => {
    const message: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-02-16T10:00:10.000Z',
      thoughts: [],
      processTrace: [
        {
          type: 'process',
          kind: 'tool_call',
          ts: '2026-02-16T10:00:00.000Z',
          payload: {
            toolCallId: 'read-1',
            name: 'Read',
            input: { file_path: '/tmp/a.ts' }
          }
        }
      ]
    }

    const resolved = getMessageThoughtsForDisplay(message)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      id: 'read-1',
      type: 'tool_use',
      toolName: 'Read'
    })
  })
})
