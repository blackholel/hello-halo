import { describe, expect, it } from 'vitest'
import type { Thought } from '../../../types'
import { filterThoughtsForDisplay } from '../ThoughtProcess'

describe('ThoughtProcess visibility filtering', () => {
  it('hides debug thoughts and duplicate Task/TodoWrite/result nodes', () => {
    const thoughts: Thought[] = [
      {
        id: 't-debug',
        type: 'system',
        content: 'hook raw output',
        timestamp: new Date().toISOString(),
        visibility: 'debug'
      },
      {
        id: 't-task',
        type: 'tool_use',
        content: 'Task tool',
        timestamp: new Date().toISOString(),
        toolName: 'Task'
      },
      {
        id: 't-todo',
        type: 'tool_use',
        content: 'TodoWrite',
        timestamp: new Date().toISOString(),
        toolName: 'TodoWrite'
      },
      {
        id: 't-result',
        type: 'result',
        content: 'final',
        timestamp: new Date().toISOString()
      },
      {
        id: 't-user',
        type: 'thinking',
        content: 'visible',
        timestamp: new Date().toISOString(),
        visibility: 'user'
      }
    ]

    const filtered = filterThoughtsForDisplay(thoughts)
    expect(filtered.map((t) => t.id)).toEqual(['t-user'])
  })

  it('keeps Task thoughts when hideTask=false (completed mode)', () => {
    const thoughts: Thought[] = [
      {
        id: 't-task',
        type: 'tool_use',
        content: 'Task tool',
        timestamp: new Date().toISOString(),
        toolName: 'Task'
      },
      {
        id: 't-user',
        type: 'thinking',
        content: 'visible',
        timestamp: new Date().toISOString(),
        visibility: 'user'
      }
    ]

    const filtered = filterThoughtsForDisplay(thoughts, { hideTask: false })
    expect(filtered.map((t) => t.id)).toEqual(['t-task', 't-user'])
  })
})
