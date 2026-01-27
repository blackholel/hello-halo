/**
 * Task Store - Global task panel state management
 *
 * Manages the global task list extracted from TodoWrite tool calls.
 * Provides a unified view of all tasks across the conversation.
 *
 * Features:
 * - Extract tasks from TodoWrite thoughts
 * - Track task status (pending, in_progress, completed)
 * - Link tasks to sub-agents
 * - Calculate progress statistics
 */

import { create } from 'zustand'
import type { Thought, TaskItem, TaskStatus, TaskState } from '../types'

// Progress statistics
export interface TaskProgress {
  total: number
  completed: number
  inProgress: number
  pending: number
  percentage: number
}

// Store interface
interface TaskStore extends TaskState {
  // Actions
  updateTasksFromThoughts: (thoughts: Thought[]) => void
  linkTaskToAgent: (taskId: string, agentId: string) => void
  reset: () => void

  // Selectors
  getProgress: () => TaskProgress
}

// Initial state
const initialState: TaskState = {
  tasks: [],
  activeTaskId: null,
  lastUpdated: null
}

/**
 * Extract tasks from TodoWrite tool calls in thoughts
 * Uses the latest TodoWrite call (by timestamp) as the source of truth
 */
export function extractTasksFromThoughts(thoughts: Thought[]): TaskItem[] {
  // Find all TodoWrite tool calls
  const todoWrites = thoughts.filter(
    t => t.type === 'tool_use' && t.toolName === 'TodoWrite' && t.toolInput
  )

  if (todoWrites.length === 0) {
    return []
  }

  // Sort by timestamp descending and take the latest
  const sortedTodoWrites = [...todoWrites].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const latestTodoWrite = sortedTodoWrites[0]
  const input = latestTodoWrite.toolInput as {
    todos?: Array<{
      content: string
      status: string
      activeForm?: string
    }>
  }

  if (!input.todos || !Array.isArray(input.todos)) {
    return []
  }

  const now = new Date().toISOString()

  return input.todos.map((todo, index) => ({
    id: `${latestTodoWrite.id}-${index}`,
    content: todo.content || '',
    status: (todo.status as TaskStatus) || 'pending',
    activeForm: todo.activeForm,
    createdAt: now,
    updatedAt: now,
    sourceThoughtId: latestTodoWrite.id
  }))
}

/**
 * Task Store
 */
export const useTaskStore = create<TaskStore>((set, get) => ({
  ...initialState,

  updateTasksFromThoughts: (thoughts: Thought[]) => {
    const tasks = extractTasksFromThoughts(thoughts)

    // Find the first in_progress task
    const activeTask = tasks.find(t => t.status === 'in_progress')

    set({
      tasks,
      activeTaskId: activeTask?.id ?? null,
      lastUpdated: new Date().toISOString()
    })
  },

  linkTaskToAgent: (taskId: string, agentId: string) => {
    set(state => ({
      tasks: state.tasks.map(task =>
        task.id === taskId
          ? { ...task, linkedAgentId: agentId, updatedAt: new Date().toISOString() }
          : task
      )
    }))
  },

  reset: () => {
    set(initialState)
  },

  getProgress: () => {
    const { tasks } = get()
    const total = tasks.length

    // Single pass through tasks array for better performance
    let completed = 0
    let inProgress = 0
    let pending = 0

    for (const task of tasks) {
      switch (task.status) {
        case 'completed':
          completed++
          break
        case 'in_progress':
          inProgress++
          break
        case 'pending':
          pending++
          break
      }
    }

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

    return { total, completed, inProgress, pending, percentage }
  }
}))
