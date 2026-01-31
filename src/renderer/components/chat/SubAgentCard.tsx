/**
 * SubAgentCard - Independent card for sub-agent (Task tool) display
 * Renders as a separate card at the same level as ThoughtProcess
 * Shows sub-agent description, status, and thought process
 */

import { useState, memo } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { getToolIcon } from '../icons/ToolIcons'
import type { Thought } from '../../types'
import { useTranslation } from '../../i18n'
import {
  truncateText,
  extractFileName,
  extractCommand,
  extractSearchTerm
} from '../../utils/thought-utils'

interface SubAgentCardProps {
  agentId: string
  description: string
  subagentType?: string
  thoughts: Thought[]
  isRunning: boolean
  hasError: boolean
}

// Get brief description for a thought
function getThoughtBrief(thought: Thought): string {
  if (thought.type !== 'tool_use' || !thought.toolName) {
    return thought.content?.substring(0, 50) || ''
  }

  const input = thought.toolInput
  switch (thought.toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return extractFileName(input?.file_path)
    case 'Grep':
    case 'Glob':
      return extractSearchTerm(input?.pattern)
    case 'Bash':
      return extractCommand(input?.command)
    case 'WebFetch':
      return extractSearchTerm(input?.url)
    case 'WebSearch':
      return extractSearchTerm(input?.query)
    default:
      return thought.toolName
  }
}

// Collapsed summary component for sub-agent card
function CollapsedSummary({
  toolUseThoughts,
  allThoughts,
  hasError,
  t
}: {
  toolUseThoughts: Thought[]
  allThoughts: Thought[]
  hasError: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  // Find the last running tool (no result yet)
  const runningTool = [...toolUseThoughts].reverse().find(tool => {
    const hasResult = allThoughts.some(th => th.type === 'tool_result' && th.id === tool.id)
    return !hasResult
  })

  if (runningTool) {
    const Icon = runningTool.toolName ? getToolIcon(runningTool.toolName) : Bot
    const brief = getThoughtBrief(runningTool)
    return (
      <div className="px-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={12} className="flex-shrink-0" />
        <span className="truncate">
          <span className="text-foreground/70">{runningTool.toolName}</span>
          {brief && <span className="ml-1">{brief}</span>}
          ...
        </span>
      </div>
    )
  }

  // Find error tool if hasError
  if (hasError) {
    const errorTool = [...toolUseThoughts].reverse().find(tool => {
      const result = allThoughts.find(th => th.type === 'tool_result' && th.id === tool.id)
      return result?.isError
    })
    if (errorTool) {
      return (
        <div className="px-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <XCircle size={12} className="text-destructive flex-shrink-0" />
          <span className="text-destructive truncate">
            {t('Error in {{tool}}', { tool: errorTool.toolName })}
          </span>
        </div>
      )
    }
  }

  // All completed - show last operation
  const lastTool = toolUseThoughts[toolUseThoughts.length - 1]
  const LastIcon = lastTool?.toolName ? getToolIcon(lastTool.toolName) : CheckCircle2
  const lastBrief = lastTool ? getThoughtBrief(lastTool) : ''

  return (
    <div className="px-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <LastIcon size={12} className="text-green-500 flex-shrink-0" />
      <span className="truncate">
        {lastTool?.toolName && <span className="text-foreground/70">{lastTool.toolName}</span>}
        {lastBrief && <span className="ml-1">{lastBrief}</span>}
      </span>
    </div>
  )
}

// Compact thought item for sub-agent card
const CompactThoughtItem = memo(function CompactThoughtItem({
  thought,
  allThoughts
}: {
  thought: Thought
  allThoughts: Thought[]
}) {
  const Icon = thought.toolName ? getToolIcon(thought.toolName) : Bot
  const brief = getThoughtBrief(thought)

  // Check if this tool has completed
  const hasResult = allThoughts.some(
    t => t.type === 'tool_result' && t.id === thought.id
  )
  const resultThought = allThoughts.find(
    t => t.type === 'tool_result' && t.id === thought.id
  )
  const hasError = resultThought?.isError

  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <Icon size={12} className="text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground truncate flex-1">
        {thought.toolName && (
          <span className="text-foreground/70">{thought.toolName}</span>
        )}
        {brief && <span className="ml-1 text-muted-foreground/70">{brief}</span>}
      </span>
      {!hasResult && thought.status === 'running' && (
        <Loader2 size={10} className="animate-spin text-primary flex-shrink-0" />
      )}
      {hasResult && !hasError && (
        <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" />
      )}
      {hasError && (
        <XCircle size={10} className="text-destructive flex-shrink-0" />
      )}
    </div>
  )
})

export const SubAgentCard = memo(function SubAgentCard({
  agentId,
  description,
  subagentType,
  thoughts,
  isRunning,
  hasError
}: SubAgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()

  // Filter to only show tool_use thoughts (not results, not thinking)
  const toolUseThoughts = thoughts.filter(t => t.type === 'tool_use')

  // Get status color based on running/error state
  function getStatusColor(): string {
    if (isRunning) return 'border-primary/50 bg-primary/5'
    if (hasError) return 'border-destructive/50 bg-destructive/5'
    return 'border-green-500/50 bg-green-500/5'
  }

  function getLeftBorderColor(): string {
    if (isRunning) return 'bg-primary'
    if (hasError) return 'bg-destructive'
    return 'bg-green-500'
  }

  const statusColor = getStatusColor()
  const leftBorderColor = getLeftBorderColor()

  return (
    <div className={`
      animate-fade-in mb-3 rounded-xl border overflow-hidden
      ${statusColor}
    `}>
      {/* Left color indicator + content */}
      <div className="flex">
        {/* Left color bar */}
        <div className={`w-1 ${leftBorderColor} flex-shrink-0`} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
          >
            {/* Expand icon */}
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            )}

            {/* Bot icon */}
            <Bot
              size={16}
              className={`flex-shrink-0 ${isRunning ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}
            />

            {/* Description */}
            <span className="text-sm font-medium truncate flex-1">
              {truncateText(description, 50)}
            </span>

            {/* Sub-agent type badge */}
            {subagentType && (
              <span className="text-xs text-muted-foreground/60 px-1.5 py-0.5 bg-muted/30 rounded flex-shrink-0">
                {subagentType}
              </span>
            )}

            {/* Status indicator */}
            {isRunning && (
              <Loader2 size={14} className="animate-spin text-primary flex-shrink-0" />
            )}
            {!isRunning && !hasError && (
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            )}
            {hasError && (
              <XCircle size={14} className="text-destructive flex-shrink-0" />
            )}
          </button>

          {/* Collapsed summary - single line text */}
          {!isExpanded && toolUseThoughts.length > 0 && (
            <CollapsedSummary
              toolUseThoughts={toolUseThoughts}
              allThoughts={thoughts}
              hasError={hasError}
              t={t}
            />
          )}

          {/* Expanded content */}
          {isExpanded && (
            <div className="px-3 pb-3 border-t border-border/20">
              {/* Tool operations list */}
              {toolUseThoughts.length > 0 ? (
                <div className="mt-2 space-y-0.5">
                  {toolUseThoughts.slice(-10).map(thought => (
                    <CompactThoughtItem
                      key={thought.id}
                      thought={thought}
                      allThoughts={thoughts}
                    />
                  ))}
                  {toolUseThoughts.length > 10 && (
                    <div className="text-xs text-muted-foreground/50 pt-1">
                      {t('...and {{count}} more operations', { count: toolUseThoughts.length - 10 })}
                    </div>
                  )}
                </div>
              ) : isRunning ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <Loader2 size={12} className="animate-spin" />
                  {t('Starting sub-agent...')}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground/50">
                  {t('No operations recorded')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
