/**
 * Message List - Displays chat messages with streaming and thinking support
 * Layout: User message -> [Thinking Process above] -> [Assistant Reply]
 * Thinking process is always displayed ABOVE the assistant message (like ChatGPT/Cursor)
 *
 * Key Feature: StreamingBubble with scroll animation
 * When AI outputs text -> calls tool -> outputs more text:
 * - Old content smoothly scrolls up and out of view
 * - New content appears in place
 * - Creates a clean, focused reading experience
 *
 * @see docs/streaming-scroll-animation.md for detailed implementation notes
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { MessageItem } from './MessageItem'
import { ThoughtProcess } from './ThoughtProcess'
import { CompactNotice } from './CompactNotice'
import { MarkdownRenderer } from './MarkdownRenderer'
import { BrowserTaskCard, isBrowserTool } from '../tool/BrowserTaskCard'
import { SubAgentCard } from './SubAgentCard'
import { TaskPanel } from '../task'
import { useTaskStore } from '../../stores/task.store'
import type { Message, Thought, CompactInfo, ParallelGroup } from '../../types'
import { useTranslation } from '../../i18n'

// Sub-agent info extracted from thoughts
interface SubAgentInfo {
  id: string
  description: string
  subagentType?: string
  thoughts: Thought[]
  isRunning: boolean
  hasError: boolean
}

interface MessageListProps {
  messages: Message[]
  streamingContent: string
  isGenerating: boolean
  isStreaming?: boolean  // True during token-level text streaming
  thoughts?: Thought[]
  parallelGroups?: Map<string, ParallelGroup>  // Parallel operation groups
  isThinking?: boolean
  compactInfo?: CompactInfo | null
  error?: string | null  // Error message to display when generation fails
  isCompact?: boolean  // Compact mode when Canvas is open
  textBlockVersion?: number  // Increments on each new text block (for StreamingBubble reset)
}

/**
 * StreamingBubble - Displays streaming content with scroll-up animation
 *
 * Problem: `content` (streamingContent) is cumulative - it appends all text from
 * the start of generation. When tool_use happens mid-stream, we need to:
 * 1. "Snapshot" the current content
 * 2. Scroll the snapshot up (out of view)
 * 3. Display only the NEW content after the tool call
 *
 * Solution: Snapshot-based content segmentation
 * - segments[]: Array of snapshots (independent, not cumulative)
 * - displayContent: content.slice(lastSnapshot.length) - extracts only new part
 * - CSS translateY: Scrolls history out of the viewport
 *
 * Timing is critical: We wait for new content to arrive BEFORE scrolling,
 * otherwise user sees empty space during the tool call.
 */
function StreamingBubble({
  content,
  isStreaming,
  thoughts,
  textBlockVersion = 0
}: {
  content: string
  isStreaming: boolean
  thoughts: Thought[]
  textBlockVersion?: number
}) {
  // DOM refs for measuring heights
  const historyRef = useRef<HTMLDivElement>(null)  // Contains all past segments
  const currentRef = useRef<HTMLDivElement>(null)  // Contains current (new) content
  const { t } = useTranslation()

  // State for scroll animation
  const [segments, setSegments] = useState<string[]>([])     // Saved content snapshots
  const [scrollOffset, setScrollOffset] = useState(0)        // translateY offset in px
  const [currentHeight, setCurrentHeight] = useState(0)      // Viewport height = current content height
  const [activeSnapshotLen, setActiveSnapshotLen] = useState(0)  // Length to slice from (state for sync rendering)

  // Refs for tracking (don't trigger re-renders)
  const prevThoughtsLenRef = useRef(0)           // Previous thoughts array length
  const pendingSnapshotRef = useRef<string | null>(null)  // Content waiting to be saved
  const prevTextBlockVersionRef = useRef(textBlockVersion)  // Track version changes

  /**
   * Step 0: Reset on new text block (100% reliable signal from SDK)
   * When textBlockVersion changes, it means a new content_block_start (type='text') arrived.
   * This is the precise signal to reset activeSnapshotLen.
   */
  useEffect(() => {
    if (textBlockVersion !== prevTextBlockVersionRef.current) {
      // Reset all state for new text block
      setActiveSnapshotLen(0)
      setSegments([])
      setScrollOffset(0)
      pendingSnapshotRef.current = null
      prevTextBlockVersionRef.current = textBlockVersion
    }
  }, [textBlockVersion])

  /**
   * Step 1: Detect tool_use and mark content as pending
   * When a new tool_use thought appears, we mark the current content
   * as "pending" - it will be saved when new content arrives.
   */
  useEffect(() => {
    const prevLen = prevThoughtsLenRef.current
    const currLen = thoughts.length

    if (currLen > prevLen) {
      const newThought = thoughts[currLen - 1]
      // On tool_use, mark current content as pending (will be saved when new content arrives)
      if (newThought?.type === 'tool_use' && content && content.length > activeSnapshotLen) {
        pendingSnapshotRef.current = content
      }
    }
    prevThoughtsLenRef.current = currLen
  }, [thoughts, content, activeSnapshotLen])

  /**
   * Step 2: Save snapshot when new content arrives
   * We wait until new content appears (content grows beyond pending)
   * before saving the snapshot. This ensures smooth transition.
   *
   * Key: Update segments first, then update activeSnapshotLen in next effect.
   * This ensures the history DOM renders BEFORE we slice the display content.
   */
  useEffect(() => {
    const pending = pendingSnapshotRef.current
    if (pending && content && content.length > pending.length) {
      // New content has arrived, now save the snapshot
      setSegments(prev => [...prev, pending])
      pendingSnapshotRef.current = null
    }
  }, [content])

  /**
   * Step 2b: Update slice position AFTER segments are in DOM
   * This runs after segments update, ensuring history is visible before we slice
   */
  useEffect(() => {
    if (segments.length > 0) {
      // Calculate total length of all segments
      const totalLen = segments.reduce((sum, seg) => sum + seg.length, 0)
      if (totalLen !== activeSnapshotLen) {
        setActiveSnapshotLen(totalLen)
      }
    }
  }, [segments, activeSnapshotLen])

  /**
   * Step 3: Reset state on new conversation
   * Note: New text block reset is now handled by Step 0 (textBlockVersion change)
   */
  useEffect(() => {
    if (!content && thoughts.length === 0) {
      // Full reset for new conversation
      setSegments([])
      setScrollOffset(0)
      setCurrentHeight(0)
      setActiveSnapshotLen(0)
      prevThoughtsLenRef.current = 0
      prevTextBlockVersionRef.current = 0
    }
  }, [content, thoughts.length])

  /**
   * Step 4: Measure current content height (throttled)
   * Only update height every 100ms to avoid excessive measurements during streaming.
   * Viewport height = current content height only (not history)
   */
  const heightMeasureRef = useRef<number>(0)
  useEffect(() => {
    if (currentRef.current) {
      // Throttle: only measure every 100ms
      const now = Date.now()
      if (now - heightMeasureRef.current < 100) return
      heightMeasureRef.current = now

      requestAnimationFrame(() => {
        if (currentRef.current) {
          setCurrentHeight(currentRef.current.scrollHeight)
        }
      })
    }
  }, [content, segments.length])

  /**
   * Step 5: Calculate scroll offset when segments change
   * scrollOffset = total height of history segments
   * This value is used for translateY(-scrollOffset)
   */
  useEffect(() => {
    if (segments.length > 0 && historyRef.current) {
      // Wait for DOM to update
      requestAnimationFrame(() => {
        if (historyRef.current) {
          setScrollOffset(historyRef.current.scrollHeight)
        }
      })
    }
  }, [segments])

  if (!content) return null

  // Calculate what to show in current content area
  // activeSnapshotLen is updated AFTER segments render, ensuring no content loss
  const displayContent = activeSnapshotLen > 0 && content.length >= activeSnapshotLen
    ? content.slice(activeSnapshotLen)
    : content

  const containerHeight = currentHeight > 0 ? currentHeight : 'auto'

  return (
    <div className="rounded-xl px-3 py-2 message-assistant message-working w-full overflow-hidden">
      {/* Working indicator */}
      <div className="flex items-center gap-1 mb-1.5 pb-1.5 border-b border-border/20 working-indicator-fade">
        <span className="text-[11px] text-muted-foreground/60">{t('Halo is working')}</span>
      </div>

      {/* Viewport - height matches current content only */}
      <div
        className="overflow-hidden transition-[height] duration-300"
        style={{ height: containerHeight }}
      >
        {/* Scrollable container */}
        <div
          className="transition-transform duration-300"
          style={{ transform: `translateY(-${scrollOffset}px)` }}
        >
          {/* History segments - will be scrolled out of view */}
          <div ref={historyRef}>
            {segments.map((seg, i) => (
              <div key={i} className="pb-4 break-words leading-relaxed">
                <MarkdownRenderer content={seg} />
              </div>
            ))}
          </div>

          {/* Current content - always visible, shows only NEW part after snapshots */}
          <div ref={currentRef} className="break-words leading-relaxed">
            <MarkdownRenderer content={displayContent} />
            {isStreaming && (
              <span className="inline-block w-0.5 h-5 ml-0.5 bg-primary streaming-cursor align-middle" />
            )}
            {!isStreaming && (
              <span className="waiting-dots ml-1 text-muted-foreground/60" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MessageList({
  messages,
  streamingContent,
  isGenerating,
  isStreaming = false,
  thoughts = [],
  parallelGroups,
  isThinking = false,
  compactInfo = null,
  error = null,
  isCompact = false,
  textBlockVersion = 0
}: MessageListProps) {
  const { t } = useTranslation()

  // Filter out empty assistant placeholder message during generation
  // (Backend adds empty assistant message as placeholder, we show streaming content instead)
  const displayMessages = isGenerating
    ? messages.filter((msg, idx) => {
        const isLastMessage = idx === messages.length - 1
        const isEmptyAssistant = msg.role === 'assistant' && !msg.content
        return !(isLastMessage && isEmptyAssistant)
      })
    : messages

  // Calculate previous cost for each message (for cost diff display)
  const getPreviousCost = (currentIndex: number): number => {
    // Find the previous assistant message with tokenUsage
    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = displayMessages[i]
      if (msg.role === 'assistant' && msg.tokenUsage?.totalCostUsd) {
        return msg.tokenUsage.totalCostUsd
      }
    }
    return 0
  }

  // Separate main agent thoughts from sub-agent thoughts
  const { mainAgentThoughts, subAgents } = useMemo(() => {
    // Main agent thoughts: parentToolUseId is null/undefined AND not a Task tool
    const mainThoughts = thoughts.filter(t =>
      (t.parentToolUseId === null || t.parentToolUseId === undefined) && t.toolName !== 'Task'
    )

    // Find all Task tool calls (these are sub-agents)
    const taskTools = thoughts.filter(t =>
      t.toolName === 'Task' && (t.parentToolUseId === null || t.parentToolUseId === undefined)
    )

    // For each Task tool, collect its child thoughts
    const agents: SubAgentInfo[] = taskTools.map(task => {
      const childThoughts = thoughts.filter(t => t.parentToolUseId === task.id)
      const hasResult = thoughts.some(t => t.type === 'tool_result' && t.id === task.id)
      const hasError = childThoughts.some(t => t.isError)

      return {
        id: task.id,
        description: task.agentMeta?.description || (task.toolInput?.description as string) || 'Sub-agent',
        subagentType: task.agentMeta?.subagentType || (task.toolInput?.subagent_type as string),
        thoughts: childThoughts,
        isRunning: !hasResult,
        hasError
      }
    })

    return { mainAgentThoughts: mainThoughts, subAgents: agents }
  }, [thoughts])

  // Extract real-time browser tool calls from streaming thoughts
  // This enables BrowserTaskCard to show operations as they happen
  const streamingBrowserToolCalls = useMemo(() => {
    return mainAgentThoughts
      .filter(t => t.type === 'tool_use' && t.toolName && isBrowserTool(t.toolName))
      .map(t => ({
        id: t.id,
        name: t.toolName!,
        // Determine status: if there's a subsequent tool_result for this tool, it's complete
        // Otherwise it's still running
        status: thoughts.some(
          r => r.type === 'tool_result' && r.id.startsWith(t.id.replace('_use', '_result'))
        ) ? 'success' as const : 'running' as const,
        input: t.toolInput || {},
      }))
  }, [mainAgentThoughts, thoughts])

  // Update global task store when thoughts change (for TaskPanel)
  const updateTasksFromThoughts = useTaskStore(state => state.updateTasksFromThoughts)
  useEffect(() => {
    if (thoughts.length > 0) {
      updateTasksFromThoughts(thoughts)
    }
  }, [thoughts, updateTasksFromThoughts])

  // Check if there are tasks to display
  const hasTasks = useTaskStore(state => state.tasks.length > 0)

  return (
    <div className={`
      space-y-4 transition-[max-width] duration-300 ease-out
      ${isCompact ? 'max-w-full' : 'max-w-3xl mx-auto'}
    `}>
      {/* Render completed messages - thoughts shown above assistant messages */}
      {displayMessages.map((message, index) => {
        const previousCost = getPreviousCost(index)
        // Show collapsed thoughts ABOVE assistant messages, in same container for consistent width
        if (message.role === 'assistant' && message.thoughts && message.thoughts.length > 0) {
          return (
            <div key={message.id} className="flex justify-start">
              {/* Fixed width container - prevents width jumping when content changes */}
              <div className="w-[85%]">
                {/* Thought process above the message (completed mode = collapsed by default) */}
                <ThoughtProcess
                  thoughts={message.thoughts}
                  isThinking={false}
                  mode="completed"
                  defaultExpanded={false}
                />
                {/* Then the message itself (without embedded thoughts) */}
                <MessageItem message={message} previousCost={previousCost} hideThoughts isInContainer />
              </div>
            </div>
          )
        }
        return <MessageItem key={message.id} message={message} previousCost={previousCost} />
      })}

      {/* Current generation block: Thoughts above + Streaming content below */}
      {/* Use fixed width container to prevent jumping when content changes */}
      {isGenerating && (
        <div className="flex justify-start animate-fade-in">
          {/* Fixed width - same as completed messages */}
          <div className="w-[85%] relative">
            {/* 1. Real-time thought process at top (main agent only) */}
            {(mainAgentThoughts.length > 0 || isThinking) && (
              <ThoughtProcess
                thoughts={mainAgentThoughts}
                parallelGroups={parallelGroups}
                isThinking={isThinking && subAgents.every(a => !a.isRunning)}
                mode="realtime"
              />
            )}

            {/* 2. Sub-agent cards - rendered independently */}
            {subAgents.map(agent => (
              <SubAgentCard
                key={agent.id}
                agentId={agent.id}
                description={agent.description}
                subagentType={agent.subagentType}
                thoughts={agent.thoughts}
                isRunning={agent.isRunning}
                hasError={agent.hasError}
              />
            ))}

            {/* 3. Real-time browser task card - shows AI browser operations as they happen */}
            {streamingBrowserToolCalls.length > 0 && (
              <div className="mb-2">
                <BrowserTaskCard
                  browserToolCalls={streamingBrowserToolCalls}
                  isActive={isThinking}
                />
              </div>
            )}

            {/* 4. Global Task Panel - shows all tasks from TodoWrite */}
            {/* Positioned ABOVE StreamingBubble so user sees progress before text output */}
            {hasTasks && (
              <div className="mb-2">
                <TaskPanel defaultExpanded={true} />
              </div>
            )}

            {/* 5. Streaming bubble with accumulated content and auto-scroll */}
            {/* Only show when there's content or actively streaming */}
            {(streamingContent || isStreaming) && (
              <StreamingBubble
                content={streamingContent}
                isStreaming={isStreaming}
                thoughts={thoughts}
                textBlockVersion={textBlockVersion}
              />
            )}
          </div>
        </div>
      )}

      {/* TaskPanel persists after generation completes */}
      {/* Only reset when new TodoWrite is called (handled by task.store) */}
      {!isGenerating && hasTasks && (
        <div className="flex justify-start animate-fade-in">
          <div className="w-[85%]">
            <TaskPanel defaultExpanded={true} />
          </div>
        </div>
      )}

      {/* Error message - shown when generation fails (not during generation) */}
      {!isGenerating && error && (
        <div className="flex justify-start animate-fade-in">
          <div className="w-[85%]">
            <div className="rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="text-sm font-medium">{t('Something went wrong')}</span>
              </div>
              <p className="mt-2 text-sm text-destructive/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Compact notice - shown when context was compressed (runtime notification) */}
      {compactInfo && (
        <CompactNotice trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
      )}
    </div>
  )
}
