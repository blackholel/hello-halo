/**
 * MessageItem - Single message display with enhanced streaming visualization
 * Includes collapsible thought process for assistant messages
 *
 * Working State Design:
 * - During generation: subtle breathing glow + "AI working" indicator
 * - The indicator is gentle, not intrusive, letting user focus on content
 * - When complete: indicator fades out smoothly
 */

import { useState, useCallback, useMemo, memo } from 'react'
import {
  Sparkles,
  Copy,
  Check,
  Bot,
  Zap,
  Terminal
} from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MessageImages } from './ImageAttachmentPreview'
import { TokenUsageIndicator } from './TokenUsageIndicator'
import { PlanCard } from './PlanCard'
import { FileIcon } from '../icons/ToolIcons'
import type { Message } from '../../types'
import { useTranslation } from '../../i18n'
import {
  parseComposerMessageForDisplay,
  type ComposerResourceDisplayLookups
} from '../../utils/composer-resource-chip'

interface MessageItemProps {
  message: Message
  previousCost?: number  // Previous message's cumulative cost
  hideThoughts?: boolean
  isInContainer?: boolean
  isWorking?: boolean  // True when AI is still generating (not yet complete)
  isWaitingMore?: boolean  // True when content paused (e.g., during tool call), show "..." animation
  workDir?: string  // For skill suggestion card creation
  resourceDisplayLookups?: ComposerResourceDisplayLookups
  onOpenPlanInCanvas?: (planContent: string) => void
  onExecutePlan?: (planContent: string) => void
}

const EMPTY_RESOURCE_DISPLAY_LOOKUPS: ComposerResourceDisplayLookups = {
  skills: new Map(),
  commands: new Map(),
  agents: new Map()
}

export const MessageItem = memo(function MessageItem({
  message,
  previousCost = 0,
  isInContainer = false,
  isWorking = false,
  isWaitingMore = false,
  workDir,
  resourceDisplayLookups,
  onOpenPlanInCanvas,
  onExecutePlan
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isStreaming = (message as any).isStreaming
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  const userFileContexts = isUser ? (message.fileContexts || []) : []
  const parsedUserMessage = useMemo(() => {
    if (!isUser || !message.content) return null
    return parseComposerMessageForDisplay(
      message.content,
      resourceDisplayLookups || EMPTY_RESOURCE_DISPLAY_LOOKUPS
    )
  }, [isUser, message.content, resourceDisplayLookups])

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
    'space-studio-message-bubble rounded-2xl px-4 py-3.5 overflow-hidden transition-all duration-300',
    isUser ? 'message-user' : 'message-assistant',
    isUser ? 'space-studio-message-user' : 'space-studio-message-assistant',
    isStreaming && 'streaming-message',
    isWorking && 'message-working',
    isInContainer ? 'w-full' : 'max-w-[85%]',
  ].filter(Boolean).join(' ')

  const bubble = (
    <div className={bubbleClasses}>
      {/* Working indicator - shows when AI is working */}
      {isWorking && !isUser && (
        <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-border/20 working-indicator-fade">
          <Sparkles size={12} className="text-foreground/60 animate-pulse-gentle" />
          <span className="text-[11px] text-muted-foreground/60 font-medium tracking-wide">{t('Kite is working')}</span>
        </div>
      )}

      {/* User message images (displayed before text) */}
      {isUser && message.images && message.images.length > 0 && (
        <MessageImages images={message.images} />
      )}

      {/* User file contexts (read-only chips, shown after send for context awareness) */}
      {userFileContexts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {userFileContexts.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-1.5 pl-2 pr-2 py-1 bg-secondary/50 rounded-lg border border-border/50 text-xs"
              title={file.path}
            >
              <FileIcon extension={file.extension} size={14} />
              <span className="max-w-[180px] truncate text-foreground/80">{file.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Message content with streaming cursor */}
      <div className="break-words leading-relaxed" data-message-content>
        {message.content && (
          isUser ? (
            <>
              {parsedUserMessage && parsedUserMessage.chips.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {parsedUserMessage.chips.map((chip) => {
                    const Icon = chip.type === 'agent' ? Bot : chip.type === 'command' ? Terminal : Zap
                    return (
                      <span
                        key={chip.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1 text-sm text-foreground"
                      >
                        <Icon size={14} />
                        <span className="font-medium">{chip.displayName}</span>
                      </span>
                    )
                  })}
                </div>
              )}
              {(parsedUserMessage?.text ?? message.content) && (
                <span className="whitespace-pre-wrap">{parsedUserMessage?.text ?? message.content}</span>
              )}
            </>
          ) : message.isPlan ? (
            // Plan mode: structured plan card
            <PlanCard
              content={message.content}
              onOpenInCanvas={onOpenPlanInCanvas}
              onExecutePlan={onExecutePlan}
              workDir={workDir}
            />
          ) : (
            // Assistant messages: full markdown rendering
            <MarkdownRenderer content={message.content} workDir={workDir} />
          )
        )}
        {/* Streaming cursor when actively receiving tokens */}
        {isStreaming && (
          <span className="inline-block w-0.5 h-5 ml-0.5 bg-foreground/70 streaming-cursor align-middle" />
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
                <Check size={12} className="text-kite-success" />
                <span className="text-kite-success">{t('Copied')}</span>
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
      <div
        data-message-id={message.id}
        style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' }}
      >
        {bubble}
      </div>
    )
  }

  // Normal case: wrap with flex container
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      data-message-id={message.id}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' }}
    >
      {bubble}
    </div>
  )
}, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.previousCost === next.previousCost &&
    prev.hideThoughts === next.hideThoughts &&
    prev.isInContainer === next.isInContainer &&
    prev.isWorking === next.isWorking &&
    prev.isWaitingMore === next.isWaitingMore &&
    prev.workDir === next.workDir &&
    prev.resourceDisplayLookups === next.resourceDisplayLookups &&
    prev.onOpenPlanInCanvas === next.onOpenPlanInCanvas &&
    prev.onExecutePlan === next.onExecutePlan
  )
})
