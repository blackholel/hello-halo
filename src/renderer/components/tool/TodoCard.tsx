/**
 * TodoCard - Visual representation of AI task planning
 * Displays todo items created by TodoWrite tool in a clear, intuitive checklist format
 *
 * Design principles:
 * - Simple and intuitive - users see a familiar task list
 * - Non-intrusive - appears naturally in the thought flow
 * - Real-time updates - status changes animate smoothly
 */

import { useMemo } from 'react'
import {
  Circle,
  CheckCircle2,
  Loader2,
  ListTodo,
  PauseCircle,
} from 'lucide-react'
import { useTranslation } from '../../i18n'

// Note: Loader2 is used for in_progress task icon animation

// Todo item status from Claude Code SDK
type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'paused'

interface TodoItem {
  content: string
  status: TodoStatus
  activeForm?: string  // Present tense form for in_progress display
}

interface TodoCardProps {
  todos: TodoItem[]
}

function normalizeTodoStatus(status: unknown): TodoStatus {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'completed':
    case 'paused':
      return status
    default:
      console.warn('[TodoCard] Unknown todo status, fallback to pending:', status)
      return 'pending'
  }
}

// Get icon and style for todo status
function getTodoStatusDisplay(status: TodoStatus) {
  switch (status) {
    case 'pending':
      return {
        Icon: Circle,
        color: 'text-muted-foreground/50',
        bgColor: 'bg-transparent',
        textStyle: 'text-muted-foreground',
      }
    case 'in_progress':
      return {
        Icon: Loader2,
        color: 'text-primary',
        bgColor: 'bg-primary/10',
        textStyle: 'text-foreground font-medium',
        spin: true,
      }
    case 'completed':
      return {
        Icon: CheckCircle2,
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
        textStyle: 'text-muted-foreground line-through',
      }
    case 'paused':
      return {
        Icon: PauseCircle,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        textStyle: 'text-foreground/80',
      }
    default:
      return {
        Icon: Circle,
        color: 'text-muted-foreground/50',
        bgColor: 'bg-transparent',
        textStyle: 'text-muted-foreground',
      }
  }
}

// Single todo item
function TodoItemRow({ item, index }: { item: TodoItem; index: number }) {
  const display = getTodoStatusDisplay(item.status)
  const Icon = display.Icon

  // Show activeForm when in progress, otherwise show content
  const displayText = item.status === 'in_progress' && item.activeForm
    ? item.activeForm
    : item.content

  return (
    <div
      className={`
        flex items-start gap-2.5 px-3 py-2 rounded-xl transition-all duration-200
        ${display.bgColor}
        ${item.status === 'in_progress' ? 'animate-fade-in' : ''}
      `}
    >
      <Icon
        size={14}
        className={`
          flex-shrink-0 mt-0.5
          ${display.color}
          ${display.spin ? 'animate-spin' : ''}
        `}
      />
      <span className={`text-[13px] leading-relaxed ${display.textStyle}`}>
        {displayText}
      </span>
    </div>
  )
}

export function TodoCard({ todos }: TodoCardProps) {
  const { t } = useTranslation()
  // Calculate progress stats
  const stats = useMemo(() => {
    const total = todos.length
    const completed = todos.filter(t => t.status === 'completed').length
    const inProgress = todos.filter(t => t.status === 'in_progress').length
    const pending = todos.filter(t => t.status === 'pending').length
    const paused = todos.filter(t => t.status === 'paused').length
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0

    return { total, completed, inProgress, pending, paused, progress }
  }, [todos])

  if (todos.length === 0) {
    return null
  }

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl border border-border/30 bg-secondary/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/15 bg-secondary/15">
          <div className="flex items-center gap-2">
            <ListTodo size={14} className="text-primary/60" />
            <span className="text-[13px] font-medium text-foreground/80">{t('Task plan')}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            {stats.completed > 0 && (
              <span className="text-green-500">{t('{{count}} completed', { count: stats.completed })}</span>
            )}
            {stats.inProgress > 0 && (
              <span className="text-primary">{t('{{count}} in progress', { count: stats.inProgress })}</span>
            )}
            {stats.pending > 0 && (
              <span>{t('{{count}} pending', { count: stats.pending })}</span>
            )}
            {stats.paused > 0 && (
              <span className="text-amber-500">{t('{{count}} paused', { count: stats.paused })}</span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {stats.total > 0 && (
          <div className="h-0.5 bg-secondary/20">
            <div
              className="h-full bg-halo-success/70 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${stats.progress}%` }}
            />
          </div>
        )}

        {/* Todo items */}
        <div className="p-2 space-y-0.5">
          {todos.map((item, index) => (
            <TodoItemRow key={index} item={item} index={index} />
          ))}
        </div>

      </div>
    </div>
  )
}

// Parse TodoWrite tool input to TodoItem array
export function parseTodoInput(input: Record<string, unknown>): TodoItem[] {
  const todos = input.todos as Array<{
    content: string
    status: string
    activeForm?: string
  }> | undefined

  if (!todos || !Array.isArray(todos)) {
    return []
  }

  return todos.map(t => ({
    content: t.content || '',
    status: normalizeTodoStatus(t.status),
    activeForm: t.activeForm,
  }))
}
