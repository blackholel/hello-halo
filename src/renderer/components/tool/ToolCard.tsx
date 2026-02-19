/**
 * ToolCard - Displays tool call status with Lucide icons
 * Shows detailed information about tool execution and approval workflow
 */

import { useState } from 'react'
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { ToolIcon } from '../icons/ToolIcons'
import { useChatStore } from '../../stores/chat.store'
import type { ToolCall } from '../../types'
import { useTranslation } from '../../i18n'

interface ToolCardProps {
  toolCall: ToolCall
  conversationId?: string
}

export function ToolCard({ toolCall, conversationId }: ToolCardProps) {
  const { t } = useTranslation()
  const { approveTool, rejectTool } = useChatStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  const statusConfig = {
    pending: {
      icon: Clock,
      text: t('Pending'),
      className: 'tool-pending',
      color: 'text-muted-foreground',
    },
    running: {
      icon: Loader2,
      text: t('Running'),
      className: 'tool-running',
      color: 'text-primary',
      spin: true,
    },
    success: {
      icon: CheckCircle2,
      text: t('Completed'),
      className: 'tool-success',
      color: 'text-green-500',
    },
    error: {
      icon: XCircle,
      text: t('Failed'),
      className: 'tool-error',
      color: 'text-red-500',
    },
    waiting_approval: {
      icon: AlertCircle,
      text: t('Needs confirmation'),
      className: 'tool-waiting',
      color: 'text-yellow-500',
    },
    cancelled: {
      icon: AlertTriangle,
      text: t('Cancelled'),
      className: 'tool-pending',
      color: 'text-muted-foreground',
    },
    unknown: {
      icon: AlertTriangle,
      text: t('Unknown'),
      className: 'tool-pending',
      color: 'text-muted-foreground',
    },
  } as const

  const status = statusConfig[toolCall.status] || statusConfig.unknown
  const StatusIcon = status.icon

  // Tool name to display label mapping
  const TOOL_DISPLAY_NAMES: Record<string, string> = {
    Read: t('Read file'),
    Write: t('Create file'),
    Edit: t('Edit file'),
    Bash: t('Execute command'),
    Grep: t('Search content'),
    Glob: t('Find files'),
    WebFetch: t('Fetch web page'),
    WebSearch: t('Search the web'),
    TodoWrite: t('Task list'),
    Task: t('Subtask'),
    NotebookEdit: t('Edit notebook'),
    AskUserQuestion: t('Ask user'),
  }

  const getToolDisplayName = (name: string): string => {
    return TOOL_DISPLAY_NAMES[name] ?? name
  }

  // Get tool description from input
  const getToolDescription = (): string => {
    if (toolCall.description) return toolCall.description

    const input = toolCall.input
    if (['Read', 'Write', 'Edit'].includes(toolCall.name)) return input.file_path as string
    if (toolCall.name === 'Bash') return input.command as string
    if (toolCall.name === 'Grep') return t('Search: {{pattern}}', { pattern: input.pattern as string })
    if (toolCall.name === 'Glob') return t('Pattern: {{pattern}}', { pattern: input.pattern as string })
    return JSON.stringify(input).slice(0, 50)
  }

  // Handle copy
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toolCall.output || '')
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${status.className}`}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors duration-200"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5">
          {/* Tool icon */}
          <div className={status.color}>
            <ToolIcon name={toolCall.name} size={16} />
          </div>
          {/* Tool name and status */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {getToolDisplayName(toolCall.name)}
            </span>
            <div className={`flex items-center gap-1 ${status.color}`}>
              <StatusIcon
                size={12}
                className={status.spin ? 'animate-spin' : ''}
              />
              <span className="text-xs">{status.text}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {toolCall.status === 'success' && (
            <span className="text-xs text-muted-foreground">
              {isExpanded ? t('Collapse') : t('View')}
            </span>
          )}

          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Description - file path or command */}
      <div className="px-3.5 py-2 text-sm text-muted-foreground border-t border-border/15">
        <code className="text-[11px] bg-secondary/30 px-2 py-0.5 rounded-md font-mono text-muted-foreground/70">
          {getToolDescription()}
        </code>
      </div>

      {/* Progress bar for running */}
      {toolCall.status === 'running' && (
        <div className="h-1 bg-secondary/50 overflow-hidden">
          {toolCall.progress ? (
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${toolCall.progress}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-primary progress-indeterminate" />
          )}
        </div>
      )}

      {/* Approval buttons */}
      {toolCall.status === 'waiting_approval' && (
        <div className="px-3.5 py-3 border-t border-border/15 bg-kite-warning/[0.04]">
          <p className="text-xs text-muted-foreground mb-3">
            {t('This action requires your confirmation to continue')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => conversationId && approveTool(conversationId)}
              disabled={!conversationId}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium
                bg-kite-success/15 text-kite-success rounded-xl
                hover:bg-kite-success/25 active:bg-kite-success/35
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={15} />
              {t('Allow')}
            </button>
            <button
              onClick={() => conversationId && rejectTool(conversationId)}
              disabled={!conversationId}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium
                bg-destructive/10 text-destructive/80 rounded-xl
                hover:bg-destructive/20 active:bg-destructive/30
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <XCircle size={15} />
              {t('Reject')}
            </button>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && toolCall.output && (
        <div className="border-t border-border/15 animate-slide-down">
          <div className="px-3.5 py-2.5">
            <pre className="text-[11px] text-muted-foreground/70 overflow-auto max-h-48 p-3 bg-secondary/15 rounded-xl font-mono whitespace-pre-wrap leading-relaxed">
              {toolCall.output.slice(0, 2000)}
              {toolCall.output.length > 2000 && `\n${t('...(content truncated)')}`}
            </pre>
          </div>
          <div className="flex justify-end gap-2 px-3.5 py-2 border-t border-border/10">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {isCopied ? (
                <>
                  <Check size={14} className="text-green-500" />
                  {t('Copied')}
                </>
              ) : (
                <>
                  <Copy size={14} />
                  {t('Copy')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {toolCall.status === 'error' && toolCall.error && (
        <div className="px-3 py-2.5 border-t border-border bg-red-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-red-400">{toolCall.error}</span>
          </div>
        </div>
      )}
    </div>
  )
}
