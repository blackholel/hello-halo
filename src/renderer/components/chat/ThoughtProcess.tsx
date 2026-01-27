/**
 * ThoughtProcess - Displays main agent reasoning process in real-time
 * Shows thinking, tool usage, and intermediate results as they happen
 *
 * Note: Sub-agents (Task tools) are now rendered separately as SubAgentCard
 * This component only handles main agent's thoughts (non-Task tools)
 */

import { useState, useRef, useEffect, useMemo, memo } from 'react'
import {
  Lightbulb,
  Braces,
  CheckCircle2,
  MessageSquare,
  Info,
  XCircle,
  Check,
  Zap,
  ChevronDown,
  Loader2,
  GitBranch,
} from 'lucide-react'
import { getToolIcon } from '../icons/ToolIcons'
import { TodoCard, parseTodoInput } from '../tool/TodoCard'
import type { Thought, ParallelGroup } from '../../types'
import { useTranslation } from '../../i18n'
import {
  truncateText,
  extractFileName,
  extractCommand,
  extractSearchTerm,
  extractUrl
} from '../../utils/thought-utils'

interface ThoughtProcessProps {
  thoughts: Thought[]
  parallelGroups?: Map<string, ParallelGroup>
  isThinking: boolean
}

// Get icon component for thought type
function getThoughtIcon(type: Thought['type'], toolName?: string) {
  switch (type) {
    case 'thinking':
      return Lightbulb
    case 'tool_use':
      return toolName ? getToolIcon(toolName) : Braces
    case 'tool_result':
      return CheckCircle2
    case 'text':
      return MessageSquare
    case 'system':
      return Info
    case 'error':
      return XCircle
    case 'result':
      return Check
    default:
      return Zap
  }
}

// Get color class for thought type
function getThoughtColor(type: Thought['type'], isError?: boolean): string {
  if (isError) return 'text-destructive'

  switch (type) {
    case 'thinking':
      return 'text-blue-400'
    case 'tool_use':
      return 'text-amber-400'
    case 'tool_result':
      return 'text-green-400'
    case 'text':
      return 'text-foreground'
    case 'system':
      return 'text-muted-foreground'
    case 'error':
      return 'text-destructive'
    case 'result':
      return 'text-primary'
    default:
      return 'text-muted-foreground'
  }
}

// Get label for thought type - returns translation key
function getThoughtLabelKey(type: Thought['type']): string {
  switch (type) {
    case 'thinking':
      return 'Thinking'
    case 'tool_use':
      return 'Tool call'
    case 'tool_result':
      return 'Tool result'
    case 'text':
      return 'AI'
    case 'system':
      return 'System'
    case 'error':
      return 'Error'
    case 'result':
      return 'Complete'
    default:
      return 'AI'
  }
}

// Get human-friendly action summary for collapsed header (isThinking=true only)
function getActionSummaryData(thoughts: Thought[]): { key: string; params?: Record<string, unknown> } {
  for (let i = thoughts.length - 1; i >= 0; i--) {
    const t = thoughts[i]
    if (t.type === 'tool_use' && t.toolName) {
      const input = t.toolInput
      switch (t.toolName) {
        case 'Read': return { key: 'Reading {{file}}...', params: { file: extractFileName(input?.file_path, 20) } }
        case 'Write': return { key: 'Writing {{file}}...', params: { file: extractFileName(input?.file_path, 20) } }
        case 'Edit': return { key: 'Editing {{file}}...', params: { file: extractFileName(input?.file_path, 20) } }
        case 'Grep': return { key: 'Searching {{pattern}}...', params: { pattern: extractSearchTerm(input?.pattern, 15) } }
        case 'Glob': return { key: 'Matching {{pattern}}...', params: { pattern: extractSearchTerm(input?.pattern, 15) } }
        case 'Bash': return { key: 'Executing {{command}}...', params: { command: extractCommand(input?.command, 20) } }
        case 'WebFetch': return { key: 'Fetching {{url}}...', params: { url: extractUrl(input?.url, 20) } }
        case 'WebSearch': return { key: 'Searching {{query}}...', params: { query: extractSearchTerm(input?.query, 15) } }
        case 'TodoWrite': return { key: 'Updating tasks...' }
        case 'Task': return { key: 'Executing {{task}}...', params: { task: extractSearchTerm(input?.description, 15) } }
        case 'NotebookEdit': return { key: 'Editing {{file}}...', params: { file: extractFileName(input?.notebook_path, 20) } }
        case 'AskUserQuestion': return { key: 'Waiting for user response...' }
        default: return { key: 'Processing...' }
      }
    }
    if (t.type === 'thinking') {
      return { key: 'Thinking...' }
    }
  }
  return { key: 'Thinking...' }
}

// Timer display component
function TimerDisplay({ startTime, isThinking }: { startTime: number | null; isThinking: boolean }) {
  const [elapsedTime, setElapsedTime] = useState(0)
  const requestRef = useRef<number>()

  useEffect(() => {
    if (!startTime) return

    const animate = () => {
      setElapsedTime((Date.now() - startTime) / 1000)
      if (isThinking) {
        requestRef.current = requestAnimationFrame(animate)
      }
    }

    if (isThinking) {
      requestRef.current = requestAnimationFrame(animate)
    } else {
      setElapsedTime((Date.now() - startTime) / 1000)
    }

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
    }
  }, [isThinking, startTime])

  return <span>{elapsedTime.toFixed(1)}s</span>
}

// Individual thought item
const ThoughtItem = memo(function ThoughtItem({
  thought,
  isLast
}: {
  thought: Thought
  isLast: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()
  const color = getThoughtColor(thought.type, thought.isError)
  const Icon = getThoughtIcon(thought.type, thought.toolName)

  const maxPreviewLength = 150

  // Build content based on thought type
  function buildContent(): string {
    if (thought.type === 'tool_use') {
      return `${thought.toolName}: ${JSON.stringify(thought.toolInput || {}).substring(0, 100)}`
    }
    if (thought.type === 'tool_result') {
      return (thought.toolOutput || '').substring(0, 200)
    }
    return thought.content
  }
  const content = buildContent()

  const needsTruncate = content.length > maxPreviewLength
  const displayContent = isExpanded ? content : content.substring(0, maxPreviewLength)

  return (
    <div className="flex gap-3 group animate-fade-in">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
          thought.isError ? 'bg-destructive/20' : 'bg-primary/10'
        } ${color}`}>
          <Icon size={14} />
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 bg-border/30 mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${color}`}>
            {t(getThoughtLabelKey(thought.type))}
            {thought.toolName && ` - ${thought.toolName}`}
          </span>
          <span className="text-xs text-muted-foreground/50">
            {new Date(thought.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </span>
          {thought.duration && (
            <span className="text-xs text-muted-foreground/40">
              ({(thought.duration / 1000).toFixed(1)}s)
            </span>
          )}
          {thought.status === 'running' && (
            <Loader2 size={12} className="animate-spin text-primary" />
          )}
        </div>

        {/* Content */}
        {content && (
          <div
            className={`text-sm ${
              thought.type === 'thinking' ? 'text-muted-foreground/70 italic' : 'text-foreground/80'
            } whitespace-pre-wrap break-words`}
          >
            {displayContent}
            {needsTruncate && !isExpanded && '...'}
          </div>
        )}

        {/* Expand button */}
        {needsTruncate && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-primary/60 hover:text-primary mt-1 transition-colors"
          >
            {isExpanded ? t('Collapse') : t('Expand')}
          </button>
        )}

        {/* Tool input details */}
        {thought.type === 'tool_use' && thought.toolInput && isExpanded && (
          <pre className="mt-2 p-2 rounded bg-muted/30 text-xs text-muted-foreground overflow-x-auto">
            {JSON.stringify(thought.toolInput, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
})

// Parallel group component (side-by-side display)
const ParallelGroupView = memo(function ParallelGroupView({
  group,
  thoughts
}: {
  group: ParallelGroup
  thoughts: Thought[]
}) {
  const { t } = useTranslation()
  const toolUses = group.thoughts.filter(t => t.type === 'tool_use')

  if (toolUses.length < 2) return null

  return (
    <div className="my-3">
      {/* Parallel indicator */}
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        <GitBranch size={12} />
        <span>{t('{{count}} parallel operations', { count: toolUses.length })}</span>
        {group.status === 'running' && (
          <Loader2 size={12} className="animate-spin" />
        )}
        {group.status === 'completed' && (
          <CheckCircle2 size={12} className="text-green-500" />
        )}
        {group.status === 'partial_error' && (
          <XCircle size={12} className="text-destructive" />
        )}
      </div>

      {/* Side-by-side cards */}
      <div className="grid grid-cols-2 gap-2">
        {toolUses.map(thought => {
          const result = thoughts.find(
            t => t.type === 'tool_result' && t.id === thought.id
          )
          const status = result
            ? (result.isError ? 'error' : 'success')
            : 'running'
          const Icon = getToolIcon(thought.toolName || '')

          return (
            <div
              key={thought.id}
              className={`
                p-2 rounded-lg border text-xs
                ${status === 'running' ? 'border-primary/30 bg-primary/5' : ''}
                ${status === 'success' ? 'border-green-500/30 bg-green-500/5' : ''}
                ${status === 'error' ? 'border-destructive/30 bg-destructive/5' : ''}
              `}
            >
              <div className="flex items-center gap-2">
                <Icon size={14} />
                <span className="font-medium truncate flex-1">{thought.toolName}</span>
                {status === 'running' && (
                  <Loader2 size={12} className="animate-spin" />
                )}
                {status === 'success' && (
                  <CheckCircle2 size={12} className="text-green-500" />
                )}
                {status === 'error' && (
                  <XCircle size={12} className="text-destructive" />
                )}
              </div>

              {thought.toolInput && (
                <div className="mt-1 text-muted-foreground/70 truncate">
                  {thought.toolName === 'Read' && extractFileName(thought.toolInput.file_path, 20)}
                  {thought.toolName === 'Bash' && extractCommand(thought.toolInput.command, 20)}
                  {thought.toolName === 'Grep' && extractSearchTerm(thought.toolInput.pattern, 15)}
                </div>
              )}
              {status === 'running' && (
                <div className="mt-2 h-1 bg-secondary/50 rounded overflow-hidden">
                  <div className="h-full w-1/3 bg-primary animate-pulse" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

export function ThoughtProcess({
  thoughts,
  parallelGroups,
  isThinking
}: ThoughtProcessProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // Calculate elapsed time from first thought's timestamp
  const startTime = useMemo(() => {
    if (thoughts.length > 0) {
      return new Date(thoughts[0].timestamp).getTime()
    }
    return null
  }, [thoughts.length > 0 ? thoughts[0]?.timestamp : null])

  // Get latest todo data
  const latestTodos = useMemo(() => {
    const todoThoughts = thoughts.filter(
      t => t.type === 'tool_use' && t.toolName === 'TodoWrite' && t.toolInput
    )
    if (todoThoughts.length === 0) return null

    const latest = todoThoughts[todoThoughts.length - 1]
    return parseTodoInput(latest.toolInput!)
  }, [thoughts])

  // Filter thoughts: exclude TodoWrite and result types
  const displayThoughts = useMemo(() => {
    return thoughts.filter(t => t.type !== 'result' && t.toolName !== 'TodoWrite')
  }, [thoughts])

  // Get parallel groups that have multiple items
  const displayParallelGroups = useMemo(() => {
    if (!parallelGroups) return []
    return Array.from(parallelGroups.values())
      .filter(g => g.thoughts.filter(t => t.type === 'tool_use').length > 1)
  }, [parallelGroups])

  // Get IDs of thoughts in parallel groups
  const parallelThoughtIds = useMemo(() => {
    const ids = new Set<string>()
    displayParallelGroups.forEach(g => {
      g.thoughts.forEach(t => ids.add(t.id))
    })
    return ids
  }, [displayParallelGroups])

  // Filter to exclude thoughts in parallel groups
  const nonParallelThoughts = useMemo(() => {
    return displayThoughts.filter(t => !parallelThoughtIds.has(t.id))
  }, [displayThoughts, parallelThoughtIds])

  // Auto-scroll to bottom
  useEffect(() => {
    if (isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [thoughts, isExpanded])

  // Don't render if no thoughts and not thinking
  if (thoughts.length === 0 && !isThinking) {
    return null
  }

  const errorCount = thoughts.filter(t => t.type === 'error').length
  const hasDisplayContent = nonParallelThoughts.length > 0 || displayParallelGroups.length > 0

  return (
    <div className="animate-fade-in mb-4">
      <div
        className={`
          relative rounded-xl border overflow-hidden transition-all duration-300
          ${isThinking
            ? 'border-primary/40 bg-primary/5'
            : errorCount > 0
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border/50 bg-card/30'
          }
        `}
      >
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
        >
          {isThinking ? (
            <Loader2 size={16} className="text-primary animate-spin" />
          ) : (
            <CheckCircle2
              size={16}
              className={errorCount > 0 ? 'text-destructive' : 'text-primary'}
            />
          )}

          <span className={`text-sm font-medium ${isThinking ? 'text-primary' : 'text-foreground'}`}>
            {isThinking ? (() => {
              const data = getActionSummaryData(thoughts)
              return t(data.key, data.params)
            })() : t('Thought process')}
          </span>

          {!isThinking && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <TimerDisplay startTime={startTime} isThinking={isThinking} />
            </div>
          )}

          <div className="flex-1" />

          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="border-t border-border/30">
            {hasDisplayContent && (
              <div
                ref={contentRef}
                className="px-4 pt-3 max-h-[400px] overflow-y-auto"
              >
                {/* Parallel groups first */}
                {displayParallelGroups.map(group => (
                  <ParallelGroupView key={group.id} group={group} thoughts={thoughts} />
                ))}

                {/* Regular thoughts */}
                {nonParallelThoughts.map((thought, index) => (
                  <ThoughtItem
                    key={thought.id}
                    thought={thought}
                    isLast={index === nonParallelThoughts.length - 1 && !latestTodos && !isThinking}
                  />
                ))}
              </div>
            )}

            {/* TodoCard at bottom */}
            {latestTodos && latestTodos.length > 0 && (
              <div className={`px-4 ${hasDisplayContent ? 'pt-2' : 'pt-3'} pb-3`}>
                <TodoCard todos={latestTodos} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
