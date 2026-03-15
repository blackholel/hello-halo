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

import { useCallback, useEffect, useMemo } from 'react'
import { useChatStore } from '../../../stores/chat.store'
import { useAppStore } from '../../../stores/app.store'
import { useSpaceStore } from '../../../stores/space.store'
import { useAIBrowserStore } from '../../../stores/ai-browser.store'
import { useSmartScroll } from '../../../hooks/useSmartScroll'
import { useCanvasLifecycle } from '../../../hooks/useCanvasLifecycle'
import { MessageList } from '../../chat/MessageList'
import { InputArea } from '../../chat/InputArea'
import { AskUserQuestionPanel } from '../../chat/AskUserQuestionPanel'
import { ScrollToBottomButton } from '../../chat/ScrollToBottomButton'
import { Sparkles } from '../../icons/ToolIcons'
import { ChangeReviewBar } from '../../diff'
import type { TabState } from '../../../services/canvas-lifecycle'
import type { ChatMode, ConversationAiConfig, FileContextAttachment, ImageAttachment, ToolCall } from '../../../types'
import { useTranslation } from '../../../i18n'

interface ChatTabViewerProps {
  tab: TabState
}

export function ChatTabViewer({ tab }: ChatTabViewerProps) {
  const { t } = useTranslation()
  const { conversationId, spaceId, workDir: tabWorkDir } = tab
  const { openPlan } = useCanvasLifecycle()
  const appConfig = useAppStore(state => state.config)
  const aiBrowserEnabled = useAIBrowserStore(state => state.enabled)
  const { currentSpace, spaces, haloSpace } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    spaces: state.spaces,
    haloSpace: state.haloSpace
  }))

  const resolvedWorkDir = tabWorkDir ?? (() => {
    if (!spaceId) return undefined
    if (currentSpace?.id === spaceId) return currentSpace.path
    const matched = spaces.find(space => space.id === spaceId)
    if (matched) return matched.path
    if (haloSpace?.id === spaceId) return haloSpace.path
    return undefined
  })()

  useEffect(() => {
    if (!spaceId || resolvedWorkDir) return
    console.warn(`[ChatTabViewer] Missing workDir for space ${spaceId}, composer suggestions may be empty`)
  }, [resolvedWorkDir, spaceId])

  // Get conversation and session from store
  const conversation = useChatStore(state =>
    conversationId
      ? (() => {
          const cached = state.conversationCache.get(conversationId) || null
          if (!cached) return null
          if (spaceId && cached.spaceId !== spaceId) {
            return null
          }
          return cached
        })()
      : null
  )
  const modelSwitcherConversation = conversationId
    ? {
        id: conversationId,
        ai: (conversation as ({ ai?: ConversationAiConfig } | null))?.ai
      }
    : null
  const session = useChatStore(state =>
    conversationId ? state.sessions.get(conversationId) : null
  )
  const isLoadingConversation = useChatStore(state =>
    conversationId ? state.isConversationLoading(conversationId) : false
  )

  // Store actions
  const submitTurn = useChatStore(state => state.submitTurn)
  const executePlan = useChatStore(state => state.executePlan)
  const stopGeneration = useChatStore(state => state.stopGeneration)
  const hydrateConversation = useChatStore(state => state.hydrateConversation)
  const getCachedConversation = useChatStore(state => state.getCachedConversation)
  const changeSets = useChatStore(state => state.changeSets)
  const loadChangeSets = useChatStore(state => state.loadChangeSets)
  const acceptChangeSet = useChatStore(state => state.acceptChangeSet)
  const rollbackChangeSet = useChatStore(state => state.rollbackChangeSet)
  const answerQuestion = useChatStore(state => state.answerQuestion)
  const dismissAskUserQuestion = useChatStore(state => state.dismissAskUserQuestion)
  const setConversationMode = useChatStore(state => state.setConversationMode)
  const sendQueuedTurn = useChatStore(state => state.sendQueuedTurn)
  const removeQueuedTurn = useChatStore(state => state.removeQueuedTurn)
  const clearConversationQueue = useChatStore(state => state.clearConversationQueue)
  const clearQueueError = useChatStore(state => state.clearQueueError)
  const queuedTurns = useChatStore(state =>
    conversationId ? state.getQueuedTurns(conversationId) : []
  )
  const queueItems = useMemo(
    () => queuedTurns
      .map((turn) => ({
        id: turn.id,
        content: turn.content,
        images: turn.images,
        fileContexts: turn.fileContexts,
        hasImages: Boolean(turn.images && turn.images.length > 0),
        hasFileContexts: Boolean(turn.fileContexts && turn.fileContexts.length > 0)
      })),
    [queuedTurns]
  )
  const queueError = useChatStore(state =>
    conversationId ? state.getQueueError(conversationId) : null
  )

  // Load conversation if not in cache
  useEffect(() => {
    if (conversationId && spaceId && !getCachedConversation(conversationId)) {
      hydrateConversation(spaceId, conversationId)
    }
  }, [conversationId, spaceId, getCachedConversation, hydrateConversation])

  // Load change sets for this conversation (Canvas tab context)
  useEffect(() => {
    if (conversationId && spaceId) {
      loadChangeSets(spaceId, conversationId)
    }
  }, [conversationId, spaceId, loadChangeSets])

  // Extract session state with defaults
  const {
    isGenerating = false,
    activeRunId = null,
    streamingContent = '',
    isStreaming = false,
    thoughts = [],
    processTrace = [],
    parallelGroups = new Map(),
    isThinking = false,
    compactInfo = null,
    error = null,
    textBlockVersion = 0,
    toolStatusById = {},
    availableToolsSnapshot,
    askUserQuestionsById = {},
    askUserQuestionOrder = [],
    activeAskUserQuestionId = null,
    mode = 'code',
    modeSwitching = false
  } = session || {}

  const askUserQuestionItems = askUserQuestionOrder
    .map((id) => askUserQuestionsById[id])
    .filter(Boolean) as Array<{
    id: string
    toolCall: ToolCall
    status: 'pending' | 'failed' | 'resolved'
  }>
  const activeAskUserQuestionItem =
    (activeAskUserQuestionId && askUserQuestionsById[activeAskUserQuestionId]) ||
    askUserQuestionItems[0] ||
    null
  const pendingAskUserQuestion =
    activeAskUserQuestionItem?.status === 'pending' ? activeAskUserQuestionItem.toolCall : null
  const derivedFailedAskUserQuestion =
    activeAskUserQuestionItem?.status === 'failed' ? activeAskUserQuestionItem.toolCall : null

  const currentChangeSets = conversationId ? (changeSets.get(conversationId) || []) : []
  const activeChangeSet = currentChangeSets.find((changeSet) => changeSet.status !== 'rolled_back')
  // Smart auto-scroll
  const {
    containerRef,
    bottomRef,
    showScrollButton,
    scrollToBottom,
    handleScroll
  } = useSmartScroll({
    threshold: 100,
    deps: [conversation?.messages, streamingContent, thoughts, processTrace]
  })

  // Handle send message - directly to target conversation without global context switching
  const handleSend = useCallback(async (
    content: string,
    images?: ImageAttachment[],
    thinkingEnabled?: boolean,
    fileContexts?: FileContextAttachment[],
    mode?: ChatMode
  ) => {
    if (!conversationId || !spaceId) return
    if (!content.trim() && (!images || images.length === 0) && (!fileContexts || fileContexts.length === 0)) return

    await submitTurn({
      spaceId,
      conversationId,
      content,
      images,
      fileContexts,
      thinkingEnabled,
      aiBrowserEnabled,
      mode
    })
  }, [aiBrowserEnabled, conversationId, spaceId, submitTurn])

  // Handle stop generation
  const handleStop = useCallback(async () => {
    if (conversationId) {
      await stopGeneration(conversationId)
    }
  }, [conversationId, stopGeneration])

  const messages = conversation?.messages || []
  const hasMessages = messages.length > 0 || Boolean(streamingContent) || isThinking

  const handleModeChange = useCallback((nextMode: ChatMode) => {
    if (!conversationId || !spaceId) {
      return
    }
    void setConversationMode(spaceId, conversationId, nextMode)
  }, [conversationId, setConversationMode, spaceId])

  const handleOpenPlanInCanvas = useCallback(async (planContent: string) => {
    if (!spaceId || !conversationId) {
      console.error('[ChatTabViewer] Missing conversation binding for plan tab')
      return
    }

    await openPlan(planContent, t('Plan'), spaceId, conversationId, resolvedWorkDir)
  }, [conversationId, openPlan, resolvedWorkDir, spaceId, t])

  const handleExecutePlan = useCallback(async (planContent: string) => {
    if (!spaceId || !conversationId || isGenerating) {
      return
    }
    await executePlan(spaceId, conversationId, planContent)
  }, [conversationId, executePlan, isGenerating, spaceId])

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
                activeRunId={activeRunId}
                isStreaming={isStreaming}
                thoughts={thoughts}
                processTrace={processTrace}
                parallelGroups={parallelGroups}
                isThinking={isThinking}
                compactInfo={compactInfo}
                error={error}
                isCompact={true}
                textBlockVersion={textBlockVersion}
                toolStatusById={toolStatusById}
                availableToolsSnapshot={availableToolsSnapshot}
                onOpenPlanInCanvas={handleOpenPlanInCanvas}
                onExecutePlan={handleExecutePlan}
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
          onSubmit={(answer) => {
            if (typeof answer === 'string') {
              throw new Error('Expected structured AskUserQuestion payload')
            }
            return answerQuestion(conversationId, answer)
          }}
          isCompact={true}
        />
      )}
      {!isGenerating && !pendingAskUserQuestion && derivedFailedAskUserQuestion && conversationId && (
        <AskUserQuestionPanel
          toolCall={derivedFailedAskUserQuestion}
          failureReason={derivedFailedAskUserQuestion.error || derivedFailedAskUserQuestion.output}
          submitLabel={t('Send')}
          submitAsText={true}
          onSubmit={async (answer) => {
            if (typeof answer !== 'string') {
              throw new Error('Expected manual answer text')
            }
            dismissAskUserQuestion(conversationId, derivedFailedAskUserQuestion.id)
            if (!spaceId) return
            await submitTurn({
              spaceId,
              conversationId,
              content: answer,
              thinkingEnabled: false,
              aiBrowserEnabled,
              mode: 'code'
            })
          }}
          isCompact={true}
        />
      )}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        hasConversationStarted={hasMessages}
        queueItems={queueItems}
        queueError={queueError}
        onSendQueueItem={(turnId) => {
          if (!conversationId) {
            return Promise.resolve({
              accepted: false,
              guided: false,
              fallbackToNewRun: false,
              error: 'No active conversation'
            })
          }
          return sendQueuedTurn(conversationId, turnId)
        }}
        onEditQueueItem={(turnId) => {
          if (!conversationId) return
          removeQueuedTurn(conversationId, turnId)
        }}
        onRemoveQueueItem={(turnId) => {
          if (!conversationId) return
          removeQueuedTurn(conversationId, turnId)
        }}
        onClearQueue={() => {
          if (!conversationId) return
          clearConversationQueue(conversationId)
        }}
        onClearQueueError={() => {
          if (!conversationId) return
          clearQueueError(conversationId)
        }}
        modeSwitching={modeSwitching}
        placeholder={t('Ask Kite anything, / for commands')}
        isCompact={true}
        spaceId={spaceId ?? null}
        workDir={resolvedWorkDir}
        mode={mode}
        onModeChange={handleModeChange}
        conversation={modelSwitcherConversation}
        config={appConfig}
      />
    </div>
  )
}

// Empty state for chat tab
function EmptyState() {
  const { t } = useTranslation()
  const capabilities = [
    { icon: '💻', title: t('Programming Development') },
    { icon: '📄', title: t('File Processing') },
    { icon: '🔍', title: t('Information Retrieval') },
    { icon: '✨', title: t('Content Creation') },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[24%] left-1/2 -translate-x-1/2 w-52 h-52 rounded-full bg-foreground/5 blur-3xl" />
        <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 w-72 h-28 rounded-full bg-[hsl(var(--space-accent)/0.08)] blur-3xl" />
      </div>

      <div className="relative mb-7 space-studio-reveal" style={{ animationDelay: '0ms' }}>
        <div className="w-16 h-16 rounded-[28px] border border-border/80 bg-background/75 shadow-[0_18px_32px_rgba(24,22,20,0.12)] flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-foreground/90" />
        </div>
        <div className="absolute -inset-3 rounded-[2.2rem] border border-border/40 animate-pulse-gentle" />
      </div>

      <p className="space-studio-empty-badge text-[11px] tracking-[0.36em] uppercase text-muted-foreground/70 space-studio-reveal" style={{ animationDelay: '30ms' }}>
        Workspace
      </p>

      <h2
        className="mt-3 leading-none font-semibold tracking-tight text-foreground space-studio-reveal text-[34px]"
        style={{ animationDelay: '80ms' }}
      >
        {t('Ready to start')}
      </h2>

      <p
        className="mt-2 font-medium text-muted-foreground/80 space-studio-reveal text-xl"
        style={{ animationDelay: '120ms' }}
      >
        {t('Kite Space')}
      </p>

      <p className="mt-4 text-sm text-muted-foreground max-w-md leading-relaxed space-studio-reveal" style={{ animationDelay: '160ms' }}>
        {t('Kite, not just chat, can help you get things done')}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5 max-w-xl space-studio-reveal" style={{ animationDelay: '220ms' }}>
        {capabilities.map((cap, i) => (
          <div key={i} className="space-studio-chip !cursor-default rounded-full px-3.5 py-2.5 text-left">
            <span className="text-xs text-muted-foreground/90">
              <span className="mr-1.5">{cap.icon}</span>
              <span className="font-medium">{cap.title}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 space-studio-reveal" style={{ animationDelay: '260ms' }}>
        <p className="text-[11px] tracking-[0.16em] uppercase text-muted-foreground/60">
          {t('Powered by Claude Code with full Agent capabilities')}
        </p>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground/45 space-studio-reveal" style={{ animationDelay: '300ms' }}>
        {t('Kite has full access to the current space')}
      </p>
    </div>
  )
}
