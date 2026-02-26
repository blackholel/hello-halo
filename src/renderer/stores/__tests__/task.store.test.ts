import { beforeEach, describe, expect, it } from 'vitest'
import type { Thought } from '../../types'
import { useTaskStore } from '../task.store'

function createTodoThought(statuses: Array<'pending' | 'in_progress' | 'completed' | 'paused'>): Thought {
  return {
    id: `todo-${Date.now()}`,
    type: 'tool_use',
    content: 'TodoWrite',
    timestamp: new Date().toISOString(),
    toolName: 'TodoWrite',
    toolInput: {
      todos: statuses.map((status, index) => ({
        content: `Task ${index + 1}`,
        status,
        activeForm: status === 'in_progress' ? `Working on task ${index + 1}` : undefined
      }))
    }
  }
}

describe('Task Store terminal finalization', () => {
  beforeEach(() => {
    useTaskStore.getState().reset()
  })

  it('converts in_progress tasks to completed when terminal reason is completed', () => {
    const thought = createTodoThought(['completed', 'in_progress'])
    useTaskStore.getState().updateTasksFromThoughts([thought])

    useTaskStore.getState().finalizeTasksOnTerminal('completed')

    const tasks = useTaskStore.getState().tasks
    expect(tasks.map((task) => task.status)).toEqual(['completed', 'completed'])
    expect(useTaskStore.getState().getProgress().percentage).toBe(100)
  })

  it('converts in_progress tasks to paused when terminal reason is stopped', () => {
    const thought = createTodoThought(['completed', 'in_progress'])
    useTaskStore.getState().updateTasksFromThoughts([thought])

    useTaskStore.getState().finalizeTasksOnTerminal('stopped')

    const tasks = useTaskStore.getState().tasks
    expect(tasks.map((task) => task.status)).toEqual(['completed', 'paused'])
  })
})
