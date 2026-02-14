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
import type { ImageAttachment, FileContextAttachment } from '../../types'
import { useTranslation } from '../../i18n'

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
    getCurrentConversationId,
    getCurrentSession,
    loadChangeSets,
    acceptChangeSet,
    rollbackChangeSet,
    sendMessage,
    stopGeneration,
    setPlanEnabled,
    answerQuestion,
    dismissAskUserQuestion
  } = useChatStore()
  const { openPlan } = useCanvasLifecycle()

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
  const currentConversationId = getCurrentConversationId()
  const isLoadingConversation = useChatStore(state =>
    currentConversationId ? state.isConversationLoading(currentConversationId) : false
  )
  const session = getCurrentSession()
  const {
    isGenerating,
    streamingContent,
    isStreaming,
    thoughts,
    parallelGroups,
    isThinking,
    compactInfo,
    error,
    textBlockVersion,
    planEnabled,
    toolStatusById,
    availableToolsSnapshot,
    pendingAskUserQuestion,
    failedAskUserQuestion
  } = session

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
  const handleSend = async (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], planEnabled?: boolean) => {
    // In onboarding mode, intercept and play mock response
    if (isOnboarding && currentStep === 'send-message') {
      handleOnboardingSend()
      return
    }

    const hasContent = content.trim() || (images && images.length > 0) || (fileContexts && fileContexts.length > 0)
    if (!hasContent || isGenerating) return

    // Pass AI Browser, thinking, and plan state to sendMessage
    await sendMessage(content, images, aiBrowserEnabled, thinkingEnabled, fileContexts, planEnabled)
  }

  const handlePlanEnabledChange = useCallback((enabled: boolean) => {
    const conversationId = getCurrentConversationId()
    if (!conversationId) {
      return
    }
    setPlanEnabled(conversationId, enabled)
  }, [getCurrentConversationId, setPlanEnabled])

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
        flex-1 flex flex-col h-full
        transition-[padding] duration-300 ease-out
        ${isCompact ? 'bg-background/50' : 'bg-background'}
      `}
    >
      {/* Messages area wrapper - relative for button positioning */}
      <div className="flex-1 relative overflow-hidden">
        {/* Scrollable messages container */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={`
            h-full overflow-auto py-6
            transition-[padding] duration-300 ease-out
            ${isCompact ? 'px-3' : 'px-4'}
          `}
        >
          {isLoadingConversation ? (
            <LoadingState />
          ) : !hasMessages ? (
            <EmptyState isTemp={currentSpace?.isTemp || false} isCompact={isCompact} />
          ) : (
            <>
              <MessageList
                messages={displayMessages}
                streamingContent={displayStreamingContent}
                isGenerating={displayIsGenerating}
                isStreaming={displayIsStreaming}
                thoughts={thoughts}
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
            dismissAskUserQuestion(currentConversationId)
            await sendMessage(answer, undefined, aiBrowserEnabled, false, undefined, false)
          }}
          isCompact={isCompact}
        />
      )}
      <InputArea
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        placeholder={isCompact ? t('Continue conversation...') : (currentSpace?.isTemp ? t('Say something to Kite...') : t('Continue conversation...'))}
        isCompact={isCompact}
        spaceId={currentSpaceId}
        workDir={currentSpace?.path}
        planEnabled={planEnabled}
        onPlanEnabledChange={handlePlanEnabledChange}
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

// Empty state component - Apple-inspired welcome screen
function EmptyState({ isTemp, isCompact = false }: { isTemp: boolean; isCompact?: boolean }) {
  const { t } = useTranslation()

  // Compact mode shows minimal UI
  if (isCompact) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary/70" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('Continue the conversation here')}
        </p>
      </div>
    )
  }

  // Capability cards
  const capabilities = [
    {
      icon: '💻',
      title: t('Programming Development'),
      desc: t('Write, debug and refactor code'),
    },
    {
      icon: '📄',
      title: t('File Processing'),
      desc: t('Create and edit documents'),
    },
    {
      icon: '🔍',
      title: t('Information Retrieval'),
      desc: t('Search and analyze data'),
    },
    {
      icon: '✨',
      title: t('Content Creation'),
      desc: t('Generate creative content'),
    },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 relative">
      {/* Ambient glow behind logo */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      {/* Logo */}
      <div className="relative mb-8 stagger-item" style={{ animationDelay: '0ms' }}>
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
          <Sparkles className="w-9 h-9 text-primary" />
        </div>
        {/* Subtle glow ring */}
        <div className="absolute -inset-3 rounded-[2rem] bg-primary/5 blur-xl -z-10" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-semibold tracking-tight stagger-item" style={{ animationDelay: '60ms' }}>
        {isTemp ? 'Kite' : t('Ready to start')}
      </h2>

      {/* Subtitle */}
      <p className="mt-2 text-sm text-muted-foreground max-w-sm leading-relaxed stagger-item" style={{ animationDelay: '100ms' }}>
        {isTemp
          ? t('Aimless time, ideas will crystallize here')
          : t('Kite, not just chat, can help you get things done')
        }
      </p>

      {/* Capability cards grid */}
      <div className="mt-8 grid grid-cols-2 gap-3 max-w-md w-full stagger-item" style={{ animationDelay: '160ms' }}>
        {capabilities.map((cap, i) => (
          <div
            key={i}
            className="glass-card !cursor-default p-4 text-left"
          >
            <span className="text-xl">{cap.icon}</span>
            <h4 className="text-[13px] font-medium mt-2">{cap.title}</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{cap.desc}</p>
          </div>
        ))}
      </div>

      {/* Powered by badge */}
      <div className="mt-8 stagger-item" style={{ animationDelay: '220ms' }}>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 border border-border/50">
          <div className="w-1.5 h-1.5 rounded-full bg-kite-success animate-pulse" />
          <span className="text-xs text-muted-foreground">
            {t('Powered by Claude Code with full Agent capabilities')}
          </span>
        </div>
      </div>

      {/* Permission hint */}
      <p className="mt-3 text-[11px] text-muted-foreground/40 stagger-item" style={{ animationDelay: '260ms' }}>
        {t('Kite has full access to the current space')}
      </p>
    </div>
  )
}
