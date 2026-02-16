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
import type { Thought, ParallelGroup, ToolStatus } from '../../types'
import { useTranslation } from '../../i18n'
import {
  getThoughtKey,
  truncateText,
  extractFileName,
  extractCommand,
  extractSearchTerm,
  extractUrl
} from '../../utils/thought-utils'

interface ThoughtProcessProps {
  thoughts: Thought[]
  parallelGroups?: Map<string, ParallelGroup>
  toolStatusById?: Record<string, ToolStatus>
  isThinking: boolean
  /**
   * Display mode:
   * - 'realtime': Real-time mode during generation, default expanded, supports streaming updates
   * - 'completed': Completed mode after generation, default collapsed, static display
   */
  mode?: 'realtime' | 'completed'
  /** Default expanded state (only used in completed mode) */
  defaultExpanded?: boolean
}

export function filterThoughtsForDisplay(
  thoughts: Thought[],
  options?: { hideTask?: boolean }
): Thought[] {
  const hideTask = options?.hideTask ?? true
  return thoughts.filter(
    (t) =>
      t.type !== 'result' &&
      t.toolName !== 'TodoWrite' &&
      (!hideTask || t.toolName !== 'Task') &&
      t.visibility !== 'debug'
  )
}

// Thought type to icon mapping
const THOUGHT_ICONS: Record<string, typeof Zap> = {
  thinking: Lightbulb,
  tool_result: CheckCircle2,
  text: MessageSquare,
  system: Info,
  error: XCircle,
  result: Check,
}

function getThoughtIcon(type: Thought['type'], toolName?: string) {
  if (type === 'tool_use') return toolName ? getToolIcon(toolName) : Braces
  return THOUGHT_ICONS[type] ?? Zap
}

// Thought type to color class mapping
const THOUGHT_COLORS: Record<string, string> = {
  thinking: 'text-blue-400',
  tool_use: 'text-amber-400',
  tool_result: 'text-green-400',
  text: 'text-foreground',
  system: 'text-muted-foreground',
  error: 'text-destructive',
  result: 'text-primary',
}

function getThoughtColor(type: Thought['type'], isError?: boolean): string {
  if (isError) return 'text-destructive'
  return THOUGHT_COLORS[type] ?? 'text-muted-foreground'
}

// Thought type to translation key mapping
const THOUGHT_LABEL_KEYS: Record<string, string> = {
  thinking: 'Thinking',
  tool_use: 'Tool call',
  tool_result: 'Tool result',
  text: 'AI',
  system: 'System',
  error: 'Error',
  result: 'Complete',
}

function getThoughtLabelKey(type: Thought['type']): string {
  return THOUGHT_LABEL_KEYS[type] ?? 'AI'
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
  isLast,
  toolStatusById = {}
}: {
  thought: Thought
  isLast: boolean
  toolStatusById?: Record<string, ToolStatus>
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()
  const color = getThoughtColor(thought.type, thought.isError)
  const Icon = getThoughtIcon(thought.type, thought.toolName)
  const toolStatus = thought.type === 'tool_use' ? toolStatusById[thought.id] || thought.status : thought.status

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
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
          thought.isError ? 'bg-destructive/15' : 'bg-secondary/60'
        } ${color}`}>
          <Icon size={12} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-border/20 mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3.5 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[11px] font-medium ${color}`}>
            {t(getThoughtLabelKey(thought.type))}
            {thought.toolName && ` · ${thought.toolName}`}
          </span>
          <span className="text-[10px] text-muted-foreground/30 tabular-nums">
            {new Date(thought.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </span>
          {thought.duration && (
            <span className="text-[10px] text-muted-foreground/25 tabular-nums">
              {(thought.duration / 1000).toFixed(1)}s
            </span>
          )}
          {toolStatus === 'running' && (
            <Loader2 size={10} className="animate-spin text-primary" />
          )}
          {toolStatus === 'success' && (
            <CheckCircle2 size={10} className="text-green-500" />
          )}
          {toolStatus === 'error' && (
            <XCircle size={10} className="text-destructive" />
          )}
          {toolStatus === 'cancelled' && (
            <XCircle size={10} className="text-muted-foreground/60" />
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
          <pre className="mt-2 p-2.5 rounded-lg bg-secondary/20 text-[11px] text-muted-foreground/70 overflow-x-auto font-mono">
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
  thoughts,
  toolStatusById = {}
}: {
  group: ParallelGroup
  thoughts: Thought[]
  toolStatusById?: Record<string, ToolStatus>
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
          const status = toolStatusById[thought.id]
            ? (toolStatusById[thought.id] === 'pending' || toolStatusById[thought.id] === 'waiting_approval'
              ? 'running'
              : toolStatusById[thought.id])
            : (result
              ? (result.isError ? 'error' : 'success')
              : 'running')
          const Icon = getToolIcon(thought.toolName || '')

          return (
            <div
              key={thought.id}
              className={`
                p-2.5 rounded-xl border text-xs transition-all duration-200
                ${status === 'running' ? 'border-primary/20 bg-primary/[0.04]' : ''}
                ${status === 'success' ? 'border-halo-success/20 bg-halo-success/[0.04]' : ''}
                ${status === 'error' ? 'border-destructive/20 bg-destructive/[0.04]' : ''}
                ${status === 'cancelled' ? 'border-border/20 bg-secondary/[0.05]' : ''}
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
                {status === 'cancelled' && (
                  <XCircle size={12} className="text-muted-foreground/70" />
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
  toolStatusById = {},
  isThinking,
  mode = 'realtime',
  defaultExpanded
}: ThoughtProcessProps) {
  // In realtime mode, expand when thinking; in completed mode, use defaultExpanded (default false)
  const initialExpanded = mode === 'realtime' ? false : (defaultExpanded ?? false)
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
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

  // Filter thoughts: always hide debug + result + TodoWrite, and only hide Task in realtime mode
  const displayThoughts = useMemo(() => {
    return filterThoughtsForDisplay(thoughts, { hideTask: mode === 'realtime' })
  }, [thoughts, mode])

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

  // Calculate duration for completed mode
  const duration = useMemo(() => {
    if (thoughts.length < 1) return 0
    const first = new Date(thoughts[0].timestamp).getTime()
    const last = new Date(thoughts[thoughts.length - 1].timestamp).getTime()
    return (last - first) / 1000
  }, [thoughts])

  // Completed mode: compact collapsed style (similar to CollapsedThoughtProcess)
  if (mode === 'completed') {
    // Check if there's anything to show
    const hasContent = displayThoughts.length > 0 || (latestTodos && latestTodos.length > 0)
    if (!hasContent) return null

    return (
      <div className="mb-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs
            transition-all duration-200 w-full
            ${isExpanded
              ? 'bg-secondary/50'
              : 'bg-secondary/20 hover:bg-secondary/40'
            }
          `}
        >
          {/* Expand icon */}
          <ChevronDown
            size={11}
            className={`text-muted-foreground/50 transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
          />

          {/* Icon */}
          {errorCount > 0 ? (
            <XCircle size={13} className="text-destructive" />
          ) : (
            <Lightbulb size={13} className="text-primary/60" />
          )}

          {/* Label */}
          <span className="text-muted-foreground/60">{t('Thought process')}</span>

          {/* Stats: time only */}
          <div className="flex items-center gap-1.5 text-muted-foreground/40 tabular-nums">
            <span>{duration.toFixed(1)}s</span>
          </div>
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-1.5 px-3 py-2.5 bg-secondary/15 rounded-xl animate-slide-down">
            {hasDisplayContent && (
              <div
                ref={contentRef}
                className="max-h-[300px] overflow-y-auto"
              >
                {/* Parallel groups first */}
                {displayParallelGroups.map(group => (
                  <ParallelGroupView key={group.id} group={group} thoughts={thoughts} toolStatusById={toolStatusById} />
                ))}

                {/* Regular thoughts */}
                {nonParallelThoughts.map((thought, index) => (
                  <ThoughtItem
                    key={getThoughtKey(thought)}
                    thought={thought}
                    isLast={index === nonParallelThoughts.length - 1 && !latestTodos}
                    toolStatusById={toolStatusById}
                  />
                ))}
              </div>
            )}

            {/* TodoCard at bottom */}
            {latestTodos && latestTodos.length > 0 && (
              <div className={hasDisplayContent ? 'mt-2 pt-2 border-t border-border/20' : ''}>
                <TodoCard todos={latestTodos} />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Realtime mode: full card style with streaming support

  return (
    <div className="animate-fade-in mb-4">
      <div
        className={`
          relative rounded-2xl border overflow-hidden transition-all duration-300
          ${isThinking
            ? 'border-primary/25 bg-primary/[0.03]'
            : errorCount > 0
              ? 'border-destructive/20 bg-destructive/[0.03]'
              : 'border-border/30 bg-secondary/10'
          }
        `}
      >
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/20 transition-colors duration-200"
        >
          {isThinking ? (
            <Loader2 size={14} className="text-primary animate-spin" />
          ) : (
            <CheckCircle2
              size={14}
              className={errorCount > 0 ? 'text-destructive/70' : 'text-halo-success/70'}
            />
          )}

          <span className={`text-[13px] font-medium ${isThinking ? 'text-primary' : 'text-foreground/80'}`}>
            {isThinking ? (() => {
              const data = getActionSummaryData(thoughts)
              return t(data.key, data.params)
            })() : t('Thought process')}
          </span>

          {!isThinking && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 tabular-nums">
              <TimerDisplay startTime={startTime} isThinking={isThinking} />
            </div>
          )}

          <div className="flex-1" />

          <ChevronDown
            size={14}
            className={`text-muted-foreground/40 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="border-t border-border/15">
            {hasDisplayContent && (
              <div
                ref={contentRef}
                className="px-4 pt-3 max-h-[400px] overflow-y-auto"
              >
                {/* Parallel groups first */}
                {displayParallelGroups.map(group => (
                  <ParallelGroupView key={group.id} group={group} thoughts={thoughts} toolStatusById={toolStatusById} />
                ))}

                {/* Regular thoughts */}
                {nonParallelThoughts.map((thought, index) => (
                  <ThoughtItem
                    key={getThoughtKey(thought)}
                    thought={thought}
                    isLast={index === nonParallelThoughts.length - 1 && !latestTodos && !isThinking}
                    toolStatusById={toolStatusById}
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
