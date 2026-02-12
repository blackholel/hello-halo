/**
 * Chat Tab Viewer - Displays a conversation in a Canvas tab
 *
 * This component allows multiple conversations to be open simultaneously
 * in the Canvas tab system, alongside files and browser tabs.
 *
 * Features:
 * - Subscribes to specific conversation state by conversationId
 * - Reuses MessageList and InputArea components
 * - Independent scroll and input state per tab
 * - Supports streaming responses and tool calls
 */

import { useCallback, useEffect } from 'react'
import { useChatStore } from '../../../stores/chat.store'
import { useSmartScroll } from '../../../hooks/useSmartScroll'
import { MessageList } from '../../chat/MessageList'
import { InputArea } from '../../chat/InputArea'
import { AskUserQuestionPanel } from '../../chat/AskUserQuestionPanel'
import { ScrollToBottomButton } from '../../chat/ScrollToBottomButton'
import { Sparkles } from '../../icons/ToolIcons'
import { ChangeReviewBar } from '../../diff'
import type { TabState } from '../../../services/canvas-lifecycle'
import type { ImageAttachment, FileContextAttachment } from '../../../types'
import { useTranslation } from '../../../i18n'

interface ChatTabViewerProps {
  tab: TabState
}

export function ChatTabViewer({ tab }: ChatTabViewerProps) {
  const { t } = useTranslation()
  const { conversationId, spaceId } = tab

  // Get conversation and session from store
  const conversation = useChatStore(state =>
    conversationId ? state.conversationCache.get(conversationId) : null
  )
  const session = useChatStore(state =>
    conversationId ? state.sessions.get(conversationId) : null
  )
  const isLoadingConversation = useChatStore(state => state.isLoadingConversation)

  // Store actions
  const sendMessageToConversation = useChatStore(state => state.sendMessageToConversation)
  const stopGeneration = useChatStore(state => state.stopGeneration)
  const selectConversation = useChatStore(state => state.selectConversation)
  const getCachedConversation = useChatStore(state => state.getCachedConversation)
  const changeSets = useChatStore(state => state.changeSets)
  const loadChangeSets = useChatStore(state => state.loadChangeSets)
  const acceptChangeSet = useChatStore(state => state.acceptChangeSet)
  const rollbackChangeSet = useChatStore(state => state.rollbackChangeSet)
  const answerQuestion = useChatStore(state => state.answerQuestion)
  const dismissAskUserQuestion = useChatStore(state => state.dismissAskUserQuestion)

  // Load conversation if not in cache
  useEffect(() => {
    if (conversationId && !getCachedConversation(conversationId)) {
      selectConversation(conversationId)
    }
  }, [conversationId, getCachedConversation, selectConversation])

  // Load change sets for this conversation (Canvas tab context)
  useEffect(() => {
    if (conversationId && spaceId) {
      loadChangeSets(spaceId, conversationId)
    }
  }, [conversationId, spaceId, loadChangeSets])

  // Extract session state with defaults
  const {
    isGenerating = false,
    streamingContent = '',
    isStreaming = false,
    thoughts = [],
    parallelGroups = new Map(),
    isThinking = false,
    compactInfo = null,
    error = null,
    textBlockVersion = 0,
    pendingAskUserQuestion = null,
    failedAskUserQuestion = null
  } = session || {}

  const currentChangeSets = conversationId ? (changeSets.get(conversationId) || []) : []
  const activeChangeSet = currentChangeSets[0]

  // Smart auto-scroll
  const {
    containerRef,
    bottomRef,
    showScrollButton,
    scrollToBottom,
    handleScroll
  } = useSmartScroll({
    threshold: 100,
    deps: [conversation?.messages, streamingContent, thoughts]
  })

  // Handle send message - directly to target conversation without global context switching
  const handleSend = useCallback(async (
    content: string,
    images?: ImageAttachment[],
    thinkingEnabled?: boolean,
    fileContexts?: FileContextAttachment[]
  ) => {
    if (!conversationId || !spaceId) return
    if ((!content.trim() && (!images || images.length === 0) && (!fileContexts || fileContexts.length === 0)) || isGenerating) return

    // Send directly to the target conversation - no global context switching needed
    await sendMessageToConversation(spaceId, conversationId, content, images, thinkingEnabled, fileContexts)
  }, [conversationId, spaceId, isGenerating, sendMessageToConversation])

  // Handle stop generation
  const handleStop = useCallback(async () => {
    if (conversationId) {
      await stopGeneration(conversationId)
    }
  }, [conversationId, stopGeneration])

  const messages = conversation?.messages || []
  const hasMessages = messages.length > 0 || streamingContent || isThinking

  // Loading state
  if (!conversation && isLoadingConversation) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">{t('Loading conversation...')}</p>
          </div>
        </div>
      </div>
    )
  }

  // Error state - conversation not found
  if (!conversation && conversationId) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <p className="text-sm text-muted-foreground">{t('Conversation not found')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-auto py-6 px-3"
        >
          {!hasMessages ? (
            <EmptyState />
          ) : (
            <>
              <MessageList
                messages={messages}
                streamingContent={streamingContent}
                isGenerating={isGenerating}
                isStreaming={isStreaming}
                thoughts={thoughts}
                parallelGroups={parallelGroups}
                isThinking={isThinking}
                compactInfo={compactInfo}
                error={error}
                isCompact={true}
                textBlockVersion={textBlockVersion}
              />
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Scroll to bottom button */}
        <ScrollToBottomButton
          visible={showScrollButton && hasMessages}
          onClick={() => scrollToBottom('smooth')}
        />
      </div>

      {/* Input area */}
      {activeChangeSet && (
        <ChangeReviewBar
          changeSet={activeChangeSet}
          onAcceptAll={() => acceptChangeSet({
            spaceId: activeChangeSet.spaceId,
            conversationId: activeChangeSet.conversationId,
            changeSetId: activeChangeSet.id
          })}
          onAcceptFile={(filePath) => acceptChangeSet({
            spaceId: activeChangeSet.spaceId,
            conversationId: activeChangeSet.conversationId,
            changeSetId: activeChangeSet.id,
            filePath
          })}
          onRollbackFile={(filePath, force) => rollbackChangeSet({
            spaceId: activeChangeSet.spaceId,
            conversationId: activeChangeSet.conversationId,
            changeSetId: activeChangeSet.id,
            filePath,
            force
          })}
        />
      )}
      {pendingAskUserQuestion && conversationId && (
        <AskUserQuestionPanel
          toolCall={pendingAskUserQuestion}
          onSubmit={(answer) => answerQuestion(conversationId, answer)}
          isCompact={true}
        />
      )}
      {!isGenerating && !pendingAskUserQuestion && failedAskUserQuestion && conversationId && (
        <AskUserQuestionPanel
          toolCall={failedAskUserQuestion}
          failureReason={failedAskUserQuestion.error || failedAskUserQuestion.output}
          submitLabel={t('Send')}
          onSubmit={async (answer) => {
            dismissAskUserQuestion(conversationId)
            if (!spaceId) return
            await sendMessageToConversation(
              spaceId,
              conversationId,
              answer,
              undefined,
              false,
              undefined,
              false,
              false
            )
          }}
          isCompact={true}
        />
      )}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        placeholder={t('Continue conversation...')}
        isCompact={true}
      />
    </div>
  )
}

// Empty state for chat tab
function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <Sparkles className="w-8 h-8 text-primary/70" />
      <p className="mt-4 text-sm text-muted-foreground">
        {t('Continue the conversation here')}
      </p>
    </div>
  )
}
