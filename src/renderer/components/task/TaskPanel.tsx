/**
 * TaskPanel - Global task panel component
 * Displays all tasks from TodoWrite in a collapsible sidebar panel
 *
 * Features:
 * - Progress bar showing completion percentage
 * - Collapsible task list
 * - Real-time status updates
 * - Agent linking support
 */

import { useState, useMemo, memo, useEffect } from 'react'
import {
  ListTodo,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Circle,
} from 'lucide-react'
import { TaskItem } from './TaskItem'
import { useTaskStore } from '../../stores/task.store'
import { useTranslation } from '../../i18n'

interface TaskPanelProps {
  className?: string
  defaultExpanded?: boolean
  onAgentClick?: (agentId: string) => void
}

export const TaskPanel = memo(function TaskPanel({
  className = '',
  defaultExpanded = true,
  onAgentClick
}: TaskPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const tasks = useTaskStore(state => state.tasks)
  const activeTaskId = useTaskStore(state => state.activeTaskId)
  const getProgress = useTaskStore(state => state.getProgress)

  const progress = useMemo(() => getProgress(), [tasks, getProgress])

  // Auto-collapse when all tasks are completed
  useEffect(() => {
    if (progress.percentage === 100 && tasks.length > 0) {
      setIsExpanded(false)
    }
  }, [progress.percentage, tasks.length])

  // Don't render if no tasks
  if (tasks.length === 0) {
    return null
  }

  return (
    <div className={`animate-fade-in ${className}`}>
      <div className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
        {/* Header - clickable to expand/collapse */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 border-b border-border/20
                     bg-secondary/10 hover:bg-secondary/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown size={16} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={16} className="text-muted-foreground" />
            )}
            <ListTodo size={16} className="text-primary" />
            <span className="text-sm font-medium text-foreground">
              {t('Task Progress')}
            </span>
          </div>

          {/* Status summary */}
          <div className="flex items-center gap-3 text-xs">
            {progress.completed > 0 && (
              <span className="flex items-center gap-1 text-green-500">
                <CheckCircle2 size={12} />
                {progress.completed}
              </span>
            )}
            {progress.inProgress > 0 && (
              <span className="flex items-center gap-1 text-primary">
                <Loader2 size={12} className="animate-spin" />
                {progress.inProgress}
              </span>
            )}
            {progress.pending > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Circle size={12} />
                {progress.pending}
              </span>
            )}
            <span className="text-muted-foreground font-medium">
              {progress.percentage}%
            </span>
          </div>
        </button>

        {/* Progress bar */}
        <div className="h-0.5 bg-secondary/20">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500 ease-out"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>

        {/* Task list - collapsible */}
        {isExpanded && (
          <div className="p-1.5 space-y-0.5 max-h-[250px] overflow-y-auto">
            {tasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                isActive={task.id === activeTaskId}
                onAgentClick={onAgentClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
