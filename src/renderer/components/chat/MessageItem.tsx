/**
 * MessageItem - Single message display with enhanced streaming visualization
 * Includes collapsible thought process for assistant messages
 *
 * Working State Design:
 * - During generation: subtle breathing glow + "AI working" indicator
 * - The indicator is gentle, not intrusive, letting user focus on content
 * - When complete: indicator fades out smoothly
 */

import { useState, useCallback } from 'react'
import {
  Sparkles,
  Copy,
  Check,
} from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageImages } from './ImageAttachmentPreview'
import { TokenUsageIndicator } from './TokenUsageIndicator'
import { PlanCard } from './PlanCard'
import type { Message } from '../../types'
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

export function MessageItem({ message, previousCost = 0, isInContainer = false, isWorking = false, isWaitingMore = false, workDir, onOpenPlanInCanvas }: MessageItemProps) {
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
