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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { shallow } from 'zustand/shallow'
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

const SEARCH_HIGHLIGHT_CLASS = 'search-highlight'
const SEARCH_TERM_HIGHLIGHT_CLASS = 'search-term-highlight'
const SEARCH_TERM_HIGHLIGHT_MARK_CLASSES = `${SEARCH_TERM_HIGHLIGHT_CLASS} bg-yellow-400/30 font-semibold rounded px-0.5`

function unwrapHighlightMark(markElement: Element) {
  const parentNode = markElement.parentNode
  if (!parentNode) return

  while (markElement.firstChild) {
    parentNode.insertBefore(markElement.firstChild, markElement)
  }
  parentNode.removeChild(markElement)
  parentNode.normalize()
}

function clearTermHighlightsInContent(contentElement: Element | null) {
  if (!contentElement) return

  contentElement
    .querySelectorAll(`mark.${SEARCH_TERM_HIGHLIGHT_CLASS}`)
    .forEach((markElement) => unwrapHighlightMark(markElement))
}

function highlightQueryInContent(contentElement: Element, query: string): boolean {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return false

  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escapedQuery, 'gi')
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const textNode = node as Text
      if (!textNode.textContent || !textNode.textContent.trim()) {
        return NodeFilter.FILTER_REJECT
      }

      const parentElement = textNode.parentElement
      if (!parentElement) {
        return NodeFilter.FILTER_REJECT
      }

      if (parentElement.closest(`mark.${SEARCH_TERM_HIGHLIGHT_CLASS}`)) {
        return NodeFilter.FILTER_REJECT
      }

      return NodeFilter.FILTER_ACCEPT
    }
  })

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  let hasHighlight = false
  textNodes.forEach((textNode) => {
    const text = textNode.textContent || ''
    regex.lastIndex = 0
    if (!regex.test(text)) {
      return
    }

    regex.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let match: RegExpExecArray | null = null

    while ((match = regex.exec(text)) !== null) {
      const matchText = match[0]
      const matchStart = match.index
      const matchEnd = matchStart + matchText.length

      if (matchStart > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)))
      }

      const markElement = document.createElement('mark')
      markElement.className = SEARCH_TERM_HIGHLIGHT_MARK_CLASSES
      markElement.textContent = matchText
      fragment.appendChild(markElement)

      lastIndex = matchEnd
      hasHighlight = true
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    textNode.parentNode?.replaceChild(fragment, textNode)
  })

  return hasHighlight
}

export function ChatView({ isCompact = false }: ChatViewProps) {
  const { t } = useTranslation()
  const { currentSpace } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace
  }), shallow)
  const {
    currentSpaceId,
    changeSets,
    currentConversation,
    currentConversationMeta,
    currentConversationId,
    session,
    queuedTurnsByConversation,
    queueErrorByConversation,
    loadingConversationCounts,
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
    getQueueError,
    sendQueuedTurn,
    removeQueuedTurn,
    clearConversationQueue,
    clearQueueError
  } = useChatStore((state) => ({
    currentSpaceId: state.currentSpaceId,
    changeSets: state.changeSets,
    currentConversation: state.getCurrentConversation(),
    currentConversationMeta: state.getCurrentConversationMeta(),
    currentConversationId: state.getCurrentConversationId(),
    session: state.getCurrentSession(),
    queuedTurnsByConversation: state.queuedTurnsByConversation,
    queueErrorByConversation: state.queueErrorByConversation,
    loadingConversationCounts: state.loadingConversationCounts,
    loadChangeSets: state.loadChangeSets,
    acceptChangeSet: state.acceptChangeSet,
    rollbackChangeSet: state.rollbackChangeSet,
    submitTurn: state.submitTurn,
    executePlan: state.executePlan,
    stopGeneration: state.stopGeneration,
    answerQuestion: state.answerQuestion,
    dismissAskUserQuestion: state.dismissAskUserQuestion,
    setConversationMode: state.setConversationMode,
    getQueuedTurns: state.getQueuedTurns,
    getQueueError: state.getQueueError,
    sendQueuedTurn: state.sendQueuedTurn,
    removeQueuedTurn: state.removeQueuedTurn,
    clearConversationQueue: state.clearConversationQueue,
    clearQueueError: state.clearQueueError
  }), shallow)
  const { openPlan } = useCanvasLifecycle()
  const { appConfig, setView } = useAppStore((state) => ({
    appConfig: state.config,
    setView: state.setView
  }), shallow)

  // Onboarding state
  const {
    isActive: isOnboarding,
    currentStep,
    nextStep,
    setMockAnimating,
    setMockThinking,
    isMockAnimating,
    isMockThinking
  } = useOnboardingStore((state) => ({
    isActive: state.isActive,
    currentStep: state.currentStep,
    nextStep: state.nextStep,
    setMockAnimating: state.setMockAnimating,
    setMockThinking: state.setMockThinking,
    isMockAnimating: state.isMockAnimating,
    isMockThinking: state.isMockThinking
  }), shallow)

  // Mock onboarding state
  const [mockUserMessage, setMockUserMessage] = useState<string | null>(null)
  const [mockAiResponse, setMockAiResponse] = useState<string | null>(null)
  const [mockStreamingContent, setMockStreamingContent] = useState<string>('')
  const [mockUserTimestamp, setMockUserTimestamp] = useState<string | null>(null)
  const [mockAiTimestamp, setMockAiTimestamp] = useState<string | null>(null)
  const activeSearchMessageRef = useRef<HTMLElement | null>(null)
  const activeSearchContentRef = useRef<Element | null>(null)
  const searchHighlightTimeoutRef = useRef<number | null>(null)

  // Clear mock state when onboarding completes
  useEffect(() => {
    if (!isOnboarding) {
      setMockUserMessage(null)
      setMockAiResponse(null)
      setMockStreamingContent('')
      setMockUserTimestamp(null)
      setMockAiTimestamp(null)
    }
  }, [isOnboarding])

  // Handle search result navigation - scroll to message and highlight search term
  useEffect(() => {
    const clearActiveSearchHighlights = () => {
      if (searchHighlightTimeoutRef.current !== null) {
        window.clearTimeout(searchHighlightTimeoutRef.current)
        searchHighlightTimeoutRef.current = null
      }

      if (activeSearchMessageRef.current) {
        activeSearchMessageRef.current.classList.remove(SEARCH_HIGHLIGHT_CLASS)
        activeSearchMessageRef.current = null
      }

      if (activeSearchContentRef.current) {
        clearTermHighlightsInContent(activeSearchContentRef.current)
        activeSearchContentRef.current = null
      }
    }

    const handleNavigateToMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{ messageId: string; query: string }>
      const { messageId, query } = customEvent.detail

      console.log(`[ChatView] Attempting to navigate to message: ${messageId}`)
      clearActiveSearchHighlights()

      // Find the message element
      const messageElement = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      if (!messageElement) {
        console.warn(`[ChatView] Message element not found for ID: ${messageId}`)
        return
      }

      console.log(`[ChatView] Found message element, scrolling and highlighting`)

      // Scroll into view smoothly
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Add highlight animation
      activeSearchMessageRef.current = messageElement
      messageElement.classList.add(SEARCH_HIGHLIGHT_CLASS)
      searchHighlightTimeoutRef.current = window.setTimeout(() => {
        messageElement.classList.remove(SEARCH_HIGHLIGHT_CLASS)
        if (activeSearchMessageRef.current === messageElement) {
          activeSearchMessageRef.current = null
        }
        searchHighlightTimeoutRef.current = null
      }, 2000)

      // Highlight search terms in this message's text nodes only
      const contentElement = messageElement.querySelector<HTMLElement>('[data-message-content]')
      if (contentElement) {
        activeSearchContentRef.current = contentElement
      }
      if (contentElement && query.trim()) {
        try {
          const hasHighlight = highlightQueryInContent(contentElement, query)
          if (hasHighlight) {
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
      clearActiveSearchHighlights()
    }

    window.addEventListener('search:navigate-to-message', handleNavigateToMessage)
    window.addEventListener('search:clear-highlights', handleClearHighlights)
    return () => {
      window.removeEventListener('search:navigate-to-message', handleNavigateToMessage)
      window.removeEventListener('search:clear-highlights', handleClearHighlights)
      clearActiveSearchHighlights()
    }
  }, [])

  // Get current conversation and its session state
  const queueItems = useMemo(() => {
    if (!currentConversationId) return []
    return getQueuedTurns(currentConversationId).map((turn) => ({
        id: turn.id,
        content: turn.content,
        images: turn.images,
        fileContexts: turn.fileContexts,
        hasImages: Boolean(turn.images && turn.images.length > 0),
        hasFileContexts: Boolean(turn.fileContexts && turn.fileContexts.length > 0)
      }))
  }, [currentConversationId, getQueuedTurns, queuedTurnsByConversation])
  const queueError = useMemo(() => {
    if (!currentConversationId) return null
    return getQueueError(currentConversationId)
  }, [currentConversationId, getQueueError, queueErrorByConversation])
  const modelSwitcherConversation = currentConversationId
    ? {
        id: currentConversationId,
        ai: currentConversation?.ai ?? currentConversationMeta?.ai
      }
    : null
  const isLoadingConversation = currentConversationId
    ? (loadingConversationCounts.get(currentConversationId) || 0) > 0
    : false
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
    setMockUserTimestamp(new Date().toISOString())
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
    setMockAiTimestamp(new Date().toISOString())
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
  const { enabled: aiBrowserEnabled } = useAIBrowserStore((state) => ({
    enabled: state.enabled
  }), shallow)

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
    if (!currentConversationId || !currentSpaceId) {
      return
    }
    void setConversationMode(currentSpaceId, currentConversationId, nextMode)
  }, [currentConversationId, currentSpaceId, setConversationMode])

  // Handle stop - stops the current conversation's generation
  const handleStop = async () => {
    if (currentConversationId) {
      await stopGeneration(currentConversationId)
    }
  }

  const handleOpenPlanInCanvas = async (planContent: string) => {
    if (!currentSpaceId || !currentConversationId) {
      console.error('[ChatView] No active conversation to open plan in canvas')
      return
    }

    await openPlan(planContent, t('Plan'), currentSpaceId, currentConversationId, currentSpace?.path)
  }

  const handleExecutePlan = useCallback(async (planContent: string) => {
    if (!currentSpaceId || !currentConversationId || isGenerating) {
      return
    }
    await executePlan(currentSpaceId, currentConversationId, planContent)
  }, [currentConversationId, currentSpaceId, executePlan, isGenerating])

  // Combine real messages with mock onboarding messages
  const realMessages = currentConversation?.messages || []
  const displayMessages = mockUserMessage && mockUserTimestamp
    ? [
        ...realMessages,
        {
          id: 'onboarding-user',
          role: 'user' as const,
          content: mockUserMessage,
          timestamp: mockUserTimestamp
        },
        ...(mockAiResponse && mockAiTimestamp
          ? [{ id: 'onboarding-ai', role: 'assistant' as const, content: mockAiResponse, timestamp: mockAiTimestamp }]
          : [])
      ]
    : realMessages

  const displayStreamingContent = mockStreamingContent || streamingContent
  const displayIsGenerating = isMockAnimating || isGenerating
  const displayIsThinking = isMockThinking || isThinking
  const displayIsStreaming = isStreaming  // Only real streaming (not mock)
  const hasMessages = displayMessages.length > 0 || Boolean(displayStreamingContent) || displayIsThinking
  const conversationProfileId = currentConversation?.ai?.profileId || currentConversationMeta?.ai?.profileId
  const aiSetupState = getAiSetupState(appConfig, conversationProfileId)
  const currentConversationSpaceId = currentSpaceId
  const currentChangeSets = currentConversationId ? (changeSets.get(currentConversationId) || []) : []
  const activeChangeSet = currentChangeSets.find((changeSet) => changeSet.status !== 'rolled_back')

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
