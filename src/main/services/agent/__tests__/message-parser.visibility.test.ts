import { describe, expect, it } from 'vitest'
import { parseSDKMessages } from '../message-parser'

describe('message-parser visibility', () => {
  it('marks hook/system raw events as debug visibility', () => {
    const hookStarted = parseSDKMessages({
      type: 'system',
      subtype: 'hook_started',
      hook_id: 'hook-1',
      hook_name: 'pre-commit',
      hook_event: 'before_tool'
    })

    expect(hookStarted).toHaveLength(1)
    expect(hookStarted[0].visibility).toBe('debug')
  })

  it('keeps user-facing system summaries as user visibility', () => {
    const initThoughts = parseSDKMessages({
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet'
    })
    const taskThoughts = parseSDKMessages({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'running',
      summary: 'Running task'
    })

    expect(initThoughts[0]?.visibility).toBe('user')
    expect(taskThoughts[0]?.visibility).toBe('user')
  })
})
