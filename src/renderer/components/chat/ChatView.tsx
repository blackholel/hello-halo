/**
 * Chat View - Main chat interface
 * Uses session-based state for multi-conversation support
 * Supports onboarding mode with mock AI response
 * Features smart auto-scroll (stops when user reads history)
 *
 * Layout modes:
 * - Full width (isCompact=false): Centered content with max-width
 * - Compact mode (isCompact=true): Sidebar-style when Canvas is open
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSpaceStore } from '../../stores/space.store'
import { useChatStore } from '../../stores/chat.store'
import { useAppStore } from '../../stores/app.store'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useAIBrowserStore } from '../../stores/ai-browser.store'
import { useCanvasLifecycle } from '../../hooks/useCanvasLifecycle'
import { useSmartScroll } from '../../hooks/useSmartScroll'
import { MessageList } from './MessageList'
import { InputArea } from './InputArea'
import { AskUserQuestionPanel } from './AskUserQuestionPanel'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { Sparkles } from '../icons/ToolIcons'
import { ChangeReviewBar } from '../diff'
import {
  ONBOARDING_ARTIFACT_NAME,
  getOnboardingAiResponse,
  getOnboardingHtmlArtifact,
  getOnboardingPrompt,
} from '../onboarding/onboardingData'
import { api } from '../../api'
import type { ChatMode, FileContextAttachment, ImageAttachment, ToolCall } from '../../types'
import { useTranslation } from '../../i18n'
import { getAiSetupState } from '../../../shared/types/ai-profile'

interface ChatViewProps {
  isCompact?: boolean
}

export function ChatView({ isCompact = false }: ChatViewProps) {
  const { t } = useTranslation()
  const { currentSpace } = useSpaceStore()
  const {
    currentSpaceId,
    changeSets,
    getCurrentConversation,
    getCurrentConversationMeta,
    getCurrentConversationId,
    getCurrentSession,
    loadChangeSets,
    acceptChangeSet,
    rollbackChangeSet,
    submitTurn,
    executePlan,
    stopGeneration,
    answerQuestion,
    dismissAskUserQuestion,
    setConversationMode,
    getQueuedTurns,
    sendQueuedTurn,
    removeQueuedTurn,
    clearConversationQueue,
    getQueueError,
    clearQueueError
  } = useChatStore()
  const { openPlan } = useCanvasLifecycle()
  const { appConfig, setView } = useAppStore((state) => ({
    appConfig: state.config,
    setView: state.setView
  }))

  // Onboarding state
  const {
    isActive: isOnboarding,
    currentStep,
    nextStep,
    setMockAnimating,
    setMockThinking,
    isMockAnimating,
    isMockThinking
  } = useOnboardingStore()

  // Mock onboarding state
  const [mockUserMessage, setMockUserMessage] = useState<string | null>(null)
  const [mockAiResponse, setMockAiResponse] = useState<string | null>(null)
  const [mockStreamingContent, setMockStreamingContent] = useState<string>('')

  // Clear mock state when onboarding completes
  useEffect(() => {
    if (!isOnboarding) {
      setMockUserMessage(null)
      setMockAiResponse(null)
      setMockStreamingContent('')
    }
  }, [isOnboarding])

  // Handle search result navigation - scroll to message and highlight search term
  useEffect(() => {
    const handleNavigateToMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{ messageId: string; query: string }>
      const { messageId, query } = customEvent.detail

      console.log(`[ChatView] Attempting to navigate to message: ${messageId}`)

      // Remove previous highlights from all messages
      document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight')
      })
      // Replace each mark element with its text content (preserving surrounding content)
      document.querySelectorAll('.search-term-highlight').forEach(el => {
        const textNode = document.createTextNode(el.textContent || '')
        el.replaceWith(textNode)
      })

      // Find the message element
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
      if (!messageElement) {
        console.warn(`[ChatView] Message element not found for ID: ${messageId}`)
        return
      }

      console.log(`[ChatView] Found message element, scrolling and highlighting`)

      // Scroll into view smoothly
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Add highlight animation
      messageElement.classList.add('search-highlight')
      setTimeout(() => {
        messageElement.classList.remove('search-highlight')
      }, 2000)

      // Highlight search terms in the message (simple text highlight)
      const contentElement = messageElement.querySelector('[data-message-content]')
      if (contentElement && query) {
        try {
          // Create a regexp with word boundaries
          const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
          const originalHTML = contentElement.innerHTML

          // Only highlight if we have content and haven't already highlighted
          if (!originalHTML.includes('search-term-highlight')) {
            contentElement.innerHTML = originalHTML.replace(
              regex,
              '<mark class="search-term-highlight bg-yellow-400/30 font-semibold rounded px-0.5">$1</mark>'
            )
            console.log(`[ChatView] Highlighted search term: "${query}"`)
          }
        } catch (error) {
          console.error(`[ChatView] Error highlighting search term:`, error)
        }
      }
    }

    // Clear all search highlights when requested
    const handleClearHighlights = () => {
      console.log(`[ChatView] Clearing all search highlights`)
      document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight')
      })
      // Replace each mark element with its text content (preserving surrounding content)
      document.querySelectorAll('.search-term-highlight').forEach(el => {
        const textNode = document.createTextNode(el.textContent || '')
        el.replaceWith(textNode)
      })
    }

    window.addEventListener('search:navigate-to-message', handleNavigateToMessage)
    window.addEventListener('search:clear-highlights', handleClearHighlights)
    return () => {
      window.removeEventListener('search:navigate-to-message', handleNavigateToMessage)
      window.removeEventListener('search:clear-highlights', handleClearHighlights)
    }
  }, [])

  // Get current conversation and its session state
  const currentConversation = getCurrentConversation()
  const currentConversationMeta = getCurrentConversationMeta()
  const currentConversationId = getCurrentConversationId()
  const queueItems = currentConversationId
    ? getQueuedTurns(currentConversationId).map((turn) => ({
        id: turn.id,
        content: turn.content,
        images: turn.images,
        fileContexts: turn.fileContexts,
        hasImages: Boolean(turn.images && turn.images.length > 0),
        hasFileContexts: Boolean(turn.fileContexts && turn.fileContexts.length > 0)
      }))
    : []
  const queueError = currentConversationId ? getQueueError(currentConversationId) : null
  const modelSwitcherConversation = currentConversationId
    ? {
        id: currentConversationId,
        ai: currentConversation?.ai ?? currentConversationMeta?.ai
      }
    : null
  const isLoadingConversation = useChatStore(state =>
    currentConversationId ? state.isConversationLoading(currentConversationId) : false
  )
  const session = getCurrentSession()
  const {
    isGenerating,
    activeRunId,
    streamingContent,
    isStreaming,
    thoughts,
    processTrace,
    parallelGroups,
    isThinking,
    compactInfo,
    error,
    textBlockVersion,
    mode,
    modeSwitching,
    toolStatusById,
    availableToolsSnapshot,
    askUserQuestionsById,
    askUserQuestionOrder,
    activeAskUserQuestionId
  } = session

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
  const failedAskUserQuestion =
    activeAskUserQuestionItem?.status === 'failed' ? activeAskUserQuestionItem.toolCall : null

  // Smart auto-scroll: only scrolls when user is at bottom
  const {
    containerRef,
    bottomRef,
    showScrollButton,
    scrollToBottom,
    handleScroll
  } = useSmartScroll({
    threshold: 100,
    deps: [currentConversation?.messages, streamingContent, thoughts, mockStreamingContent]
  })

  const onboardingPrompt = getOnboardingPrompt(t)
  const onboardingResponse = getOnboardingAiResponse(t)
  const onboardingHtml = getOnboardingHtmlArtifact(t)

  // Handle mock onboarding send
  const handleOnboardingSend = useCallback(async () => {
    if (!currentSpace) return

    // Step 1: Show user message immediately
    setMockUserMessage(onboardingPrompt)

    // Step 2: Start "thinking" phase (2.5 seconds) - no spotlight during this time
    setMockThinking(true)
    setMockAnimating(true)
    await new Promise(resolve => setTimeout(resolve, 2000))
    setMockThinking(false)

    // Step 3: Stream mock AI response
    const response = onboardingResponse
    for (let i = 0; i <= response.length; i++) {
      setMockStreamingContent(response.slice(0, i))
      await new Promise(resolve => setTimeout(resolve, 15))
    }

    // Step 4: Complete response
    setMockAiResponse(response)
    setMockStreamingContent('')

    // Step 5: Write the actual HTML file to disk BEFORE stopping animation
    // This ensures the file exists when ArtifactRail tries to load it
    try {
      await api.writeOnboardingArtifact(
        currentSpace.id,
        ONBOARDING_ARTIFACT_NAME,
        onboardingHtml
      )

      // Also save the conversation to disk
      await api.saveOnboardingConversation(currentSpace.id, onboardingPrompt, onboardingResponse)
      
      // Small delay to ensure file system has synced
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (err) {
      console.error('Failed to write onboarding artifact:', err)
    }

    // Step 6: Animation done
    // Note: Don't call nextStep() here - it's already called by Spotlight's handleHoleClick
    // We just need to stop the animation so the Spotlight can show the artifact
    setMockAnimating(false)
  }, [currentSpace, onboardingHtml, onboardingPrompt, onboardingResponse, setMockAnimating, setMockThinking])

  // AI Browser state
  const { enabled: aiBrowserEnabled } = useAIBrowserStore()

  // Handle send (with optional images for multi-modal messages, optional thinking mode, optional file contexts, optional plan mode)
  const handleSend = async (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], mode?: ChatMode) => {
    // In onboarding mode, intercept and play mock response
    if (isOnboarding && currentStep === 'send-message') {
      handleOnboardingSend()
      return
    }

    const hasContent = content.trim() || (images && images.length > 0) || (fileContexts && fileContexts.length > 0)
    if (!hasContent || !currentSpaceId || !currentConversationId) return

    await submitTurn({
      spaceId: currentSpaceId,
      conversationId: currentConversationId,
      content,
      images,
      fileContexts,
      thinkingEnabled,
      mode,
      aiBrowserEnabled
    })
  }

  const handleModeChange = useCallback((nextMode: ChatMode) => {
    const conversationId = getCurrentConversationId()
    if (!conversationId || !currentSpaceId) {
      return
    }
    void setConversationMode(currentSpaceId, conversationId, nextMode)
  }, [currentSpaceId, getCurrentConversationId, setConversationMode])

  // Handle stop - stops the current conversation's generation
  const handleStop = async () => {
    if (currentConversationId) {
      await stopGeneration(currentConversationId)
    }
  }

  const handleOpenPlanInCanvas = async (planContent: string) => {
    const conversationId = getCurrentConversationId()
    if (!currentSpaceId || !conversationId) {
      console.error('[ChatView] No active conversation to open plan in canvas')
      return
    }

    await openPlan(planContent, t('Plan'), currentSpaceId, conversationId, currentSpace?.path)
  }

  const handleExecutePlan = useCallback(async (planContent: string) => {
    const conversationId = getCurrentConversationId()
    if (!currentSpaceId || !conversationId || isGenerating) {
      return
    }
    await executePlan(currentSpaceId, conversationId, planContent)
  }, [currentSpaceId, executePlan, getCurrentConversationId, isGenerating])

  // Combine real messages with mock onboarding messages
  const realMessages = currentConversation?.messages || []
  const displayMessages = mockUserMessage
    ? [
        ...realMessages,
        { id: 'onboarding-user', role: 'user' as const, content: mockUserMessage, timestamp: new Date().toISOString() },
        ...(mockAiResponse
          ? [{ id: 'onboarding-ai', role: 'assistant' as const, content: mockAiResponse, timestamp: new Date().toISOString() }]
          : [])
      ]
    : realMessages

  const displayStreamingContent = mockStreamingContent || streamingContent
  const displayIsGenerating = isMockAnimating || isGenerating
  const displayIsThinking = isMockThinking || isThinking
  const displayIsStreaming = isStreaming  // Only real streaming (not mock)
  const hasMessages = displayMessages.length > 0 || Boolean(displayStreamingContent) || displayIsThinking
  const aiSetupState = getAiSetupState(appConfig)
  const currentConversationSpaceId = currentSpaceId
  const currentChangeSets = currentConversationId ? (changeSets.get(currentConversationId) || []) : []
  const activeChangeSet = currentChangeSets[0]

  // Track previous compact state for smooth transitions
  const prevCompactRef = useRef(isCompact)
  const isTransitioningLayout = prevCompactRef.current !== isCompact

  useEffect(() => {
    prevCompactRef.current = isCompact
  }, [isCompact])

  useEffect(() => {
    if (currentConversationId && currentSpaceId) {
      loadChangeSets(currentSpaceId, currentConversationId)
    }
  }, [currentConversationId, currentSpaceId, loadChangeSets])

  return (
    <div
      className={`
        space-studio-chatview flex-1 flex flex-col h-full
        transition-[padding] duration-300 ease-out
      `}
    >
      {/* Messages area wrapper - relative for button positioning */}
      <div className="flex-1 relative overflow-hidden">
        {/* Scrollable messages container */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={`
            h-full overflow-auto py-7
            transition-[padding] duration-300 ease-out
            ${isCompact ? 'px-3' : 'px-4'}
          `}
        >
          {isLoadingConversation ? (
            <LoadingState />
          ) : !hasMessages ? (
            <EmptyState
              isTemp={currentSpace?.isTemp || false}
              isCompact={isCompact}
              isAiConfigured={aiSetupState.configured}
              onOpenSettings={() => setView('settings')}
            />
          ) : (
            <>
              <MessageList
                messages={displayMessages}
                streamingContent={displayStreamingContent}
                isGenerating={displayIsGenerating}
                activeRunId={activeRunId}
                isStreaming={displayIsStreaming}
                thoughts={thoughts}
                processTrace={processTrace}
                parallelGroups={parallelGroups}
                isThinking={displayIsThinking}
                compactInfo={compactInfo}
                error={error}
                isCompact={isCompact}
                textBlockVersion={textBlockVersion}
                toolStatusById={toolStatusById}
                availableToolsSnapshot={availableToolsSnapshot}
                workDir={currentSpace?.path}
                onOpenPlanInCanvas={handleOpenPlanInCanvas}
                onExecutePlan={handleExecutePlan}
              />
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Scroll to bottom button - positioned outside scroll container */}
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
      {pendingAskUserQuestion && currentConversationId && (
        <AskUserQuestionPanel
          toolCall={pendingAskUserQuestion}
          onSubmit={(answer) => {
            if (typeof answer === 'string') {
              throw new Error('Expected structured AskUserQuestion payload')
            }
            return answerQuestion(currentConversationId, answer)
          }}
          isCompact={isCompact}
        />
      )}
      {!isGenerating && !pendingAskUserQuestion && failedAskUserQuestion && currentConversationId && (
        <AskUserQuestionPanel
          toolCall={failedAskUserQuestion}
          failureReason={failedAskUserQuestion.error || failedAskUserQuestion.output}
          submitLabel={t('Send')}
          submitAsText={true}
          onSubmit={async (answer) => {
            if (typeof answer !== 'string') {
              throw new Error('Expected manual answer text')
            }
            dismissAskUserQuestion(currentConversationId, failedAskUserQuestion.id)
            if (!currentSpaceId) return
            await submitTurn({
              spaceId: currentSpaceId,
              conversationId: currentConversationId,
              content: answer,
              aiBrowserEnabled,
              thinkingEnabled: false,
              mode: 'code'
            })
          }}
          isCompact={isCompact}
        />
      )}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        queueItems={queueItems}
        queueError={queueError}
        onSendQueueItem={(turnId) => {
          if (!currentConversationId) {
            return Promise.resolve({
              accepted: false,
              guided: false,
              fallbackToNewRun: false,
              error: 'No active conversation'
            })
          }
          return sendQueuedTurn(currentConversationId, turnId)
        }}
        onEditQueueItem={(turnId) => {
          if (!currentConversationId) return
          removeQueuedTurn(currentConversationId, turnId)
        }}
        onRemoveQueueItem={(turnId) => {
          if (!currentConversationId) return
          removeQueuedTurn(currentConversationId, turnId)
        }}
        onClearQueue={() => {
          if (!currentConversationId) return
          clearConversationQueue(currentConversationId)
        }}
        onClearQueueError={() => {
          if (!currentConversationId) return
          clearQueueError(currentConversationId)
        }}
        modeSwitching={modeSwitching}
        placeholder={t('Ask Kite anything, / for commands')}
        isCompact={isCompact}
        spaceId={currentSpaceId}
        workDir={currentSpace?.path}
        mode={mode}
        onModeChange={handleModeChange}
        conversation={modelSwitcherConversation}
        config={appConfig}
      />
    </div>
  )
}

// Loading state component
function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      <p className="mt-3 text-sm text-muted-foreground">{t('Loading conversation...')}</p>
    </div>
  )
}

// Empty state component - Editorial workspace style
function EmptyState({
  isTemp,
  isCompact = false,
  isAiConfigured,
  onOpenSettings
}: {
  isTemp: boolean
  isCompact?: boolean
  isAiConfigured: boolean
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()

  if (!isAiConfigured) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-12 h-12 rounded-2xl border border-border/70 bg-background/80 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-foreground/80" />
        </div>
        <h3 className="mt-4 text-xl font-semibold tracking-tight">{t('Complete model setup before chatting')}</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md leading-relaxed">
          {t('You can browse spaces now, but sending tasks requires configuring API Key first.')}
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-5 rounded-xl btn-apple px-4 py-2 text-sm"
        >
          {t('Go to model settings')}
        </button>
      </div>
    )
  }

  if (isCompact) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="w-11 h-11 rounded-2xl border border-border/70 bg-background/80 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-foreground/80" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground/90">
          {t('Ask Kite anything, / for commands')}
        </p>
      </div>
    )
  }

  const capabilities = [
    { icon: '💻', title: t('Programming Development') },
    { icon: '📄', title: t('File Processing') },
    { icon: '🔍', title: t('Information Retrieval') },
    { icon: '✨', title: t('Content Creation') },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[24%] left-1/2 -translate-x-1/2 w-80 h-80 rounded-full bg-foreground/5 blur-3xl" />
        <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 w-96 h-40 rounded-full bg-[hsl(var(--space-accent)/0.08)] blur-3xl" />
      </div>

      <div className="relative mb-7 space-studio-reveal" style={{ animationDelay: '0ms' }}>
        <div className="w-20 h-20 rounded-[28px] border border-border/80 bg-background/75 shadow-[0_18px_32px_rgba(24,22,20,0.12)] flex items-center justify-center">
          <Sparkles className="w-9 h-9 text-foreground/90" />
        </div>
        <div className="absolute -inset-3 rounded-[2.2rem] border border-border/40 animate-pulse-gentle" />
      </div>

      <p className="space-studio-empty-badge text-[11px] tracking-[0.36em] uppercase text-muted-foreground/70 space-studio-reveal" style={{ animationDelay: '30ms' }}>
        Workspace
      </p>

      <h2 className="mt-3 text-[44px] leading-none font-semibold tracking-tight text-foreground space-studio-reveal" style={{ animationDelay: '80ms' }}>
        {t('Ready to start')}
      </h2>

      <p className="mt-2 text-2xl font-medium text-muted-foreground/80 space-studio-reveal" style={{ animationDelay: '120ms' }}>
        {isTemp ? 'kite' : t('Kite Space')}
      </p>

      <p className="mt-4 text-sm text-muted-foreground max-w-md leading-relaxed space-studio-reveal" style={{ animationDelay: '160ms' }}>
        {isTemp
          ? t('Aimless time, ideas will crystallize here')
          : t('Kite, not just chat, can help you get things done')}
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
