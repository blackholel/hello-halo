/**
 * MessageItem - Single message display with enhanced streaming visualization
 * Includes collapsible thought process for assistant messages
 *
 * Working State Design:
 * - During generation: subtle breathing glow + "AI working" indicator
 * - The indicator is gentle, not intrusive, letting user focus on content
 * - When complete: indicator fades out smoothly
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Lightbulb,
  Wrench,
  CheckCircle2,
  XCircle,
  Info,
  FileText,
  ChevronRight,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react'
import { getToolIcon } from '../icons/ToolIcons'
import { BrowserTaskCard, isBrowserTool } from '../tool/BrowserTaskCard'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageImages } from './ImageAttachmentPreview'
import { TokenUsageIndicator } from './TokenUsageIndicator'
import { PlanCard } from './PlanCard'
import type { Message, Thought } from '../../types'
import { useTranslation } from '../../i18n'

interface MessageItemProps {
  message: Message
  previousCost?: number  // Previous message's cumulative cost
  hideThoughts?: boolean
  isInContainer?: boolean
  isWorking?: boolean  // True when AI is still generating (not yet complete)
  isWaitingMore?: boolean  // True when content paused (e.g., during tool call), show "..." animation
  workDir?: string  // For skill suggestion card creation
  onExecutePlan?: (planContent: string) => void  // Callback when "Execute Plan" button is clicked
}

// Collapsible thought history component
function ThoughtHistory({ thoughts }: { thoughts: Thought[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()

  // Filter out result type (final reply is in message bubble)
  const displayThoughts = thoughts.filter(t => t.type !== 'result')

  if (displayThoughts.length === 0) return null

  // Stats
  const thinkingCount = thoughts.filter(t => t.type === 'thinking').length
  const toolCount = thoughts.filter(t => t.type === 'tool_use').length

  return (
    <div className="mt-3 border-t border-border/15 pt-2.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full"
      >
        <ChevronRight
          size={10}
          className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <span>{t('View thought process')}</span>
        <span className="text-muted-foreground/30">
          ({thinkingCount > 0 && `${thinkingCount} ${t('thoughts')}`}
          {thinkingCount > 0 && toolCount > 0 && ', '}
          {toolCount > 0 && `${toolCount} ${t('tools')}`})
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2 animate-slide-down">
          {displayThoughts.map((thought) => (
            <ThoughtItem key={thought.id} thought={thought} />
          ))}
        </div>
      )}
    </div>
  )
}

// Single thought item
function ThoughtItem({ thought }: { thought: Thought }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()

  const getTypeInfo = () => {
    switch (thought.type) {
      case 'thinking':
        return { label: t('Thinking'), color: 'text-blue-400', Icon: Lightbulb }
      case 'tool_use':
        return {
          label: `${t('Calling')} ${thought.toolName}`,
          color: 'text-amber-400',
          Icon: thought.toolName ? getToolIcon(thought.toolName) : Wrench
        }
      case 'tool_result':
        return {
          label: t('Tool result'),
          color: thought.isError ? 'text-red-400' : 'text-green-400',
          Icon: thought.isError ? XCircle : CheckCircle2
        }
      case 'system':
        return { label: t('System'), color: 'text-muted-foreground', Icon: Info }
      case 'error':
        return { label: t('Error'), color: 'text-red-400', Icon: XCircle }
      default:
        return { label: thought.type, color: 'text-muted-foreground', Icon: FileText }
    }
  }

  const info = getTypeInfo()
  const content = thought.type === 'tool_use'
    ? JSON.stringify(thought.toolInput, null, 2)
    : thought.type === 'tool_result'
      ? thought.toolOutput
      : thought.content

  const previewLength = 100
  const needsTruncate = content && content.length > previewLength

  return (
    <div className="flex gap-2 text-xs">
      <info.Icon size={14} className={info.color} />
      <div className="flex-1 min-w-0">
        <span className={`font-medium ${info.color}`}>{info.label}</span>
        {content && (
          <div className="mt-0.5 text-muted-foreground/70">
            <span className="whitespace-pre-wrap break-words">
              {isExpanded || !needsTruncate ? content : content.substring(0, previewLength) + '...'}
            </span>
            {needsTruncate && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="ml-1 text-primary/60 hover:text-primary"
              >
                {isExpanded ? t('Collapse') : t('Expand')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageItem({ message, previousCost = 0, hideThoughts = false, isInContainer = false, isWorking = false, isWaitingMore = false, workDir, onExecutePlan }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isStreaming = (message as any).isStreaming
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  // Handle copying message content to clipboard
  const handleCopyMessage = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy message:', err)
    }
  }, [message.content])

  // Extract browser tools from thoughts (tool_use type with browser tool names)
  // Note: Tool calls are stored in thoughts, not in message.toolCalls
  const browserToolCalls = useMemo(() => {
    const thoughts = message.thoughts || []
    return thoughts
      .filter(t => t.type === 'tool_use' && t.toolName && isBrowserTool(t.toolName))
      .map(t => ({
        id: t.id,
        name: t.toolName!,
        status: 'success' as const,  // Thoughts are recorded after completion
        input: t.toolInput || {},
      }))
  }, [message.thoughts])

  // Check if there are running browser tools (based on isWorking state)
  const hasBrowserActivity = isWorking && browserToolCalls.length > 0

  // Message bubble content
  const bubbleClasses = [
    'rounded-2xl px-4 py-3.5 overflow-hidden transition-all duration-300',
    isUser ? 'message-user' : 'message-assistant',
    isStreaming && 'streaming-message',
    isWorking && 'message-working',
    isInContainer ? 'w-full' : 'max-w-[85%]',
  ].filter(Boolean).join(' ')

  const bubble = (
    <div className={bubbleClasses}>
      {/* Working indicator - shows when AI is working */}
      {isWorking && !isUser && (
        <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-border/20 working-indicator-fade">
          <Sparkles size={12} className="text-primary/50 animate-pulse-gentle" />
          <span className="text-[11px] text-muted-foreground/60 font-medium tracking-wide">{t('Halo is working')}</span>
        </div>
      )}

      {/* User message images (displayed before text) */}
      {isUser && message.images && message.images.length > 0 && (
        <MessageImages images={message.images} />
      )}

      {/* Message content with streaming cursor */}
      <div className="break-words leading-relaxed" data-message-content>
        {message.content && (
          isUser ? (
            // User messages: simple whitespace-preserving text
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : message.isPlan ? (
            // Plan mode: structured plan card
            <PlanCard content={message.content} onExecute={onExecutePlan} workDir={workDir} />
          ) : (
            // Assistant messages: full markdown rendering
            <MarkdownRenderer content={message.content} workDir={workDir} />
          )
        )}
        {/* Streaming cursor when actively receiving tokens */}
        {isStreaming && (
          <span className="inline-block w-0.5 h-5 ml-0.5 bg-primary streaming-cursor align-middle" />
        )}
        {/* Waiting dots when content paused but still working (e.g., tool call in progress) */}
        {isWaitingMore && !isStreaming && (
          <span className="waiting-dots ml-1 text-muted-foreground/60" />
        )}
      </div>

      {/* Browser task card - browser tools displayed separately */}
      {browserToolCalls.length > 0 && (
        <BrowserTaskCard
          browserToolCalls={browserToolCalls}
          isActive={isWorking || hasBrowserActivity}
        />
      )}

      {/* Thought history - only for assistant messages with thoughts (when not hidden) */}
      {!hideThoughts && !isUser && message.thoughts && message.thoughts.length > 0 && (
        <ThoughtHistory thoughts={message.thoughts} />
      )}

      {/* Token usage indicator + copy button - only for completed assistant messages with tokenUsage */}
      {!isUser && !isWorking && message.tokenUsage && (
        <div className="flex justify-end items-center gap-1.5 mt-3 pt-2 border-t border-border/10">
          {/* Token usage indicator */}
          <TokenUsageIndicator tokenUsage={message.tokenUsage} previousCost={previousCost} />

          {/* Copy button */}
          <button
            onClick={handleCopyMessage}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground/40
              hover:text-foreground/70 hover:bg-secondary/30 rounded-lg transition-all duration-200"
            title={t('Copy message')}
          >
            {copied ? (
              <>
                <Check size={12} className="text-halo-success" />
                <span className="text-halo-success">{t('Copied')}</span>
              </>
            ) : (
              <Copy size={12} />
            )}
          </button>
        </div>
      )}
    </div>
  )

  // When in container, just return the bubble without wrapper
  if (isInContainer) {
    // Even in container, we need data-message-id for search navigation
    return (
      <div data-message-id={message.id}>
        {bubble}
      </div>
    )
  }

  // Normal case: wrap with flex container
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      data-message-id={message.id}
    >
      {bubble}
    </div>
  )
}
