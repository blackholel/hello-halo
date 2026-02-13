/**
 * TaskItem - Individual task item component
 * Displays a single task with status indicator, content, and optional agent link
 *
 * Design principles:
 * - Clear visual status indicators
 * - Smooth animations for state changes
 * - Compact but readable
 */

import { memo } from 'react'
import {
  Circle,
  CheckCircle2,
  Loader2,
  Bot,
  PauseCircle,
} from 'lucide-react'
import type { TaskItem as TaskItemType } from '../../types'

interface TaskItemProps {
  task: TaskItemType
  isActive?: boolean
  onAgentClick?: (agentId: string) => void
}

// Get icon and style for task status
function getStatusDisplay(status: TaskItemType['status']) {
  switch (status) {
    case 'pending':
      return {
        Icon: Circle,
        iconClass: 'text-muted-foreground/50',
        bgClass: 'bg-transparent',
        textClass: 'text-muted-foreground',
      }
    case 'in_progress':
      return {
        Icon: Loader2,
        iconClass: 'text-primary animate-spin',
        bgClass: 'bg-primary/10',
        textClass: 'text-foreground font-medium',
      }
    case 'completed':
      return {
        Icon: CheckCircle2,
        iconClass: 'text-green-500',
        bgClass: 'bg-green-500/10',
        textClass: 'text-muted-foreground line-through',
      }
    case 'paused':
      return {
        Icon: PauseCircle,
        iconClass: 'text-amber-500',
        bgClass: 'bg-amber-500/10',
        textClass: 'text-foreground/80',
      }
    default:
      return {
        Icon: Circle,
        iconClass: 'text-muted-foreground/50',
        bgClass: 'bg-transparent',
        textClass: 'text-muted-foreground',
      }
  }
}

export const TaskItem = memo(function TaskItem({
  task,
  isActive,
  onAgentClick
}: TaskItemProps) {
  const { Icon, iconClass, bgClass, textClass } = getStatusDisplay(task.status)

  // Show activeForm when in progress, otherwise show content
  const displayText = task.status === 'in_progress' && task.activeForm
    ? task.activeForm
    : task.content

  const isInProgress = task.status === 'in_progress'

  return (
    <div
      className={`
        flex items-start gap-2 px-2 py-1.5 rounded-md transition-all duration-200
        ${bgClass}
        ${isActive ? 'ring-1 ring-primary/30' : ''}
        ${isInProgress ? 'animate-fade-in' : ''}
      `}
    >
      <Icon
        size={16}
        className={`flex-shrink-0 mt-0.5 ${iconClass}`}
      />

      <div className="flex-1 min-w-0">
        <span className={`text-sm leading-relaxed ${textClass}`}>
          {displayText}
        </span>

        {/* Agent link badge */}
        {task.linkedAgentId && (
          <button
            onClick={() => onAgentClick?.(task.linkedAgentId!)}
            className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                       bg-secondary/50 text-muted-foreground hover:bg-secondary
                       transition-colors"
          >
            <Bot size={10} />
            <span>Agent</span>
          </button>
        )}
      </div>
    </div>
  )
})
