/**
 * Task Store Unit Tests
 *
 * Tests for the global task panel state management.
 * Covers task extraction from TodoWrite, status updates, and agent linking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore, extractTasksFromThoughts } from '../../../src/renderer/stores/task.store'
import type { Thought, TaskItem } from '../../../src/renderer/types'

// Helper to create mock thoughts
function createThought(overrides: Partial<Thought> = {}): Thought {
  return {
    id: `thought-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'tool_use',
    content: '',
    timestamp: new Date().toISOString(),
    ...overrides
  }
}

// Helper to create TodoWrite tool input
function createTodoWriteInput(todos: Array<{ content: string; status: string; activeForm?: string }>) {
  return {
    todos
  }
}

describe('Task Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTaskStore.getState().reset()
  })

  describe('extractTasksFromThoughts', () => {
    it('should extract tasks from TodoWrite tool calls', () => {
      const thoughts: Thought[] = [
        createThought({
          id: 'todo-1',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Implement user authentication', status: 'pending' },
            { content: 'Add unit tests', status: 'pending' },
            { content: 'Update documentation', status: 'pending' }
          ])
        })
      ]

      const tasks = extractTasksFromThoughts(thoughts)

      expect(tasks).toHaveLength(3)
      expect(tasks[0].content).toBe('Implement user authentication')
      expect(tasks[0].status).toBe('pending')
      expect(tasks[1].content).toBe('Add unit tests')
      expect(tasks[2].content).toBe('Update documentation')
    })

    it('should use the latest TodoWrite when multiple exist', () => {
      const thoughts: Thought[] = [
        createThought({
          id: 'todo-1',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task A', status: 'pending' },
            { content: 'Task B', status: 'pending' }
          ]),
          timestamp: '2024-01-01T00:00:00Z'
        }),
        createThought({
          id: 'todo-2',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task A', status: 'completed' },
            { content: 'Task B', status: 'in_progress', activeForm: 'Adding Task B' },
            { content: 'Task C', status: 'pending' }
          ]),
          timestamp: '2024-01-01T00:01:00Z'
        })
      ]

      const tasks = extractTasksFromThoughts(thoughts)

      expect(tasks).toHaveLength(3)
      expect(tasks[0].status).toBe('completed')
      expect(tasks[1].status).toBe('in_progress')
      expect(tasks[1].activeForm).toBe('Adding Task B')
      expect(tasks[2].content).toBe('Task C')
    })

    it('should return empty array when no TodoWrite exists', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'Read',
          toolInput: { file_path: '/some/file.ts' }
        }),
        createThought({
          type: 'text',
          content: 'Some text response'
        })
      ]

      const tasks = extractTasksFromThoughts(thoughts)

      expect(tasks).toHaveLength(0)
    })

    it('should preserve activeForm for in_progress tasks', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }
          ])
        })
      ]

      const tasks = extractTasksFromThoughts(thoughts)

      expect(tasks[0].activeForm).toBe('Running tests')
    })

    it('should include sourceThoughtId for traceability', () => {
      const thoughts: Thought[] = [
        createThought({
          id: 'todo-source-123',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Some task', status: 'pending' }
          ])
        })
      ]

      const tasks = extractTasksFromThoughts(thoughts)

      expect(tasks[0].sourceThoughtId).toBe('todo-source-123')
    })
  })

  describe('updateTasksFromThoughts', () => {
    it('should update store state with extracted tasks', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'pending' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Working on Task 2' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(2)
      expect(state.activeTaskId).toBe(state.tasks[1].id) // in_progress task
    })

    it('should set activeTaskId to the first in_progress task', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'completed' },
            { content: 'Task 2', status: 'in_progress' },
            { content: 'Task 3', status: 'pending' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)

      const state = useTaskStore.getState()
      const activeTask = state.tasks.find(t => t.id === state.activeTaskId)
      expect(activeTask?.content).toBe('Task 2')
    })

    it('should clear activeTaskId when no task is in_progress', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'completed' },
            { content: 'Task 2', status: 'pending' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)

      const state = useTaskStore.getState()
      expect(state.activeTaskId).toBeNull()
    })
  })

  describe('linkTaskToAgent', () => {
    it('should link a task to a sub-agent by ID', () => {
      // First, set up some tasks
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Implement feature X', status: 'in_progress' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)
      const taskId = useTaskStore.getState().tasks[0].id

      // Link to agent
      useTaskStore.getState().linkTaskToAgent(taskId, 'agent-123')

      const state = useTaskStore.getState()
      expect(state.tasks[0].linkedAgentId).toBe('agent-123')
    })

    it('should not throw when linking non-existent task', () => {
      expect(() => {
        useTaskStore.getState().linkTaskToAgent('non-existent', 'agent-123')
      }).not.toThrow()
    })
  })

  describe('getProgress', () => {
    it('should calculate correct progress percentage', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'completed' },
            { content: 'Task 2', status: 'completed' },
            { content: 'Task 3', status: 'in_progress' },
            { content: 'Task 4', status: 'pending' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)

      const progress = useTaskStore.getState().getProgress()

      expect(progress.total).toBe(4)
      expect(progress.completed).toBe(2)
      expect(progress.inProgress).toBe(1)
      expect(progress.pending).toBe(1)
      expect(progress.percentage).toBe(50) // 2/4 = 50%
    })

    it('should return 0 percentage when no tasks', () => {
      const progress = useTaskStore.getState().getProgress()

      expect(progress.total).toBe(0)
      expect(progress.percentage).toBe(0)
    })

    it('should return 100 percentage when all completed', () => {
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'completed' },
            { content: 'Task 2', status: 'completed' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)

      const progress = useTaskStore.getState().getProgress()

      expect(progress.percentage).toBe(100)
    })
  })

  describe('reset', () => {
    it('should clear all tasks and reset state', () => {
      // Set up some tasks first
      const thoughts: Thought[] = [
        createThought({
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: createTodoWriteInput([
            { content: 'Task 1', status: 'in_progress' }
          ])
        })
      ]

      useTaskStore.getState().updateTasksFromThoughts(thoughts)
      expect(useTaskStore.getState().tasks).toHaveLength(1)

      // Reset
      useTaskStore.getState().reset()

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(0)
      expect(state.activeTaskId).toBeNull()
      expect(state.lastUpdated).toBeNull()
    })
  })
})
