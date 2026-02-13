/**
 * Search Panel Component
 *
 * Main search interface with three scopes:
 * - conversation: Search within current conversation
 * - space: Search within current space
 * - global: Search across all spaces
 *
 * Features:
 * - Real-time progress tracking
 * - Searchable result list with context preview
 * - Keyboard shortcuts (Esc to close)
 * - Click result to open conversation and scroll to message
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { useChatStore } from '@/stores/chat.store'
import { useSpaceStore } from '@/stores/space.store'
import { useSearchStore } from '@/stores/search.store'
import { useTranslation } from '@/i18n'

export type SearchScope = 'conversation' | 'space' | 'global'

interface SearchResultItem {
  conversationId: string
  conversationTitle: string
  messageId: string
  spaceId: string
  spaceName: string
  messageRole: 'user' | 'assistant'
  messageContent: string
  messageTimestamp: string
  matchCount: number
  contextBefore?: string
  contextAfter?: string
}

interface SearchPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SearchPanel({ isOpen, onClose }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const { currentSpaceId, currentConversationId, selectConversation, setCurrentSpace, loadConversations } = useChatStore()
  const { spaces, kiteSpace, setCurrentSpace: setSpaceStoreCurrentSpace } = useSpaceStore()

  // Use search store for state management
  const {
    query,
    searchedQuery,
    searchScope,
    results,
    isSearching,
    progress,
    setQuery,
    setSearchedQuery,
    setScope,
    setResults,
    setIsSearching,
    setProgress,
    showHighlightBar
  } = useSearchStore()

  // Listen for progress updates
  useEffect(() => {
    if (!isOpen) return

    const unsubscribe = api.onSearchProgress((data: unknown) => {
      const progressData = data as { current: number; total: number; searchId: string }
      setProgress({ current: progressData.current, total: progressData.total })
    })

    return unsubscribe
  }, [isOpen])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSearch = async () => {
    if (!query.trim()) {
      return
    }

    setIsSearching(true)
    setProgress({ current: 0, total: 0 })
    setResults([])
    setSearchedQuery(query) // Capture the query at search time

    try {
      // Determine actual scope and IDs based on user selection and current context
      let actualScope = searchScope
      let actualConvId: string | undefined
      let actualSpaceId: string | undefined

      switch (searchScope) {
        case 'conversation':
          // Only search current conversation if we have one
          if (currentConversationId && currentSpaceId) {
            actualConvId = currentConversationId
            actualSpaceId = currentSpaceId
            // Keep conversation scope
          } else if (currentSpaceId) {
            // Fall back to space search
            actualScope = 'space'
            actualSpaceId = currentSpaceId
          } else {
            // Fall back to global
            actualScope = 'global'
          }
          break

        case 'space':
          // Only search current space if we have one
          if (currentSpaceId) {
            actualSpaceId = currentSpaceId
            // Keep space scope
          } else {
            // Fall back to global
            actualScope = 'global'
          }
          break

        case 'global':
          // Global search, no IDs needed
          actualScope = 'global'
          break
      }

      console.log('[Search] Executing:', { scope: actualScope, spaceId: actualSpaceId, conversationId: actualConvId })

      const response = await api.search(query, actualScope, actualConvId, actualSpaceId)

      if (response.success && response.data) {
        const results = response.data as SearchResultItem[]
        setResults(results)
        console.log(`[Search] Found ${results.length} results in ${actualScope} scope`)
      } else {
        console.error('[Search] Error:', response.error)
      }
    } catch (error) {
      console.error('[Search] Exception:', error)
    } finally {
      setIsSearching(false)
    }
  }

  const handleResultClick = async (result: SearchResultItem) => {
    console.log(`[Search] Clicking result: conv=${result.conversationId}, space=${result.spaceId}, msg=${result.messageId}`)

    try {
      // Step 1: If switching spaces, update BOTH stores to keep UI and chat state in sync
      if (result.spaceId !== currentSpaceId) {
        console.log(`[Search] Switching to space: ${result.spaceId}`)

        // Find the space object
        let targetSpace = null
        if (result.spaceId === 'kite-temp' && kiteSpace) {
          targetSpace = kiteSpace
        } else {
          targetSpace = spaces.find(s => s.id === result.spaceId)
        }

        if (!targetSpace) {
          console.error(`[Search] Space not found: ${result.spaceId}`)
          return
        }

        // Update spaceStore (this will trigger UI updates)
        console.log(`[Search] Updating spaceStore.currentSpace to: ${targetSpace.name}`)
        setSpaceStoreCurrentSpace(targetSpace)

        // Update chatStore currentSpaceId
        console.log(`[Search] Updating chatStore.currentSpaceId to: ${result.spaceId}`)
        setCurrentSpace(result.spaceId)

        // Give state time to update
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Step 2: Load conversations in the target space
      console.log(`[Search] Loading conversations in space: ${result.spaceId}`)
      await loadConversations(result.spaceId)
      console.log(`[Search] Conversations loaded`)

      // Step 3: Navigate to conversation
      console.log(`[Search] Selecting conversation: ${result.conversationId}`)
      await selectConversation(result.conversationId)
      console.log(`[Search] Conversation selected`)

      // Step 4: Show highlight bar with all results (enable navigation)
      const resultsArray = results ?? []
      console.log(`[Search] Showing highlight bar with ${resultsArray.length} results`)
      showHighlightBar(searchedQuery, resultsArray, resultsArray.findIndex(r => r.messageId === result.messageId))

      // Close search panel
      onClose()

      // Step 5: Wait for conversation data to load before navigating to message
      // Poll for message element until it exists in DOM
      let retries = 0
      const maxRetries = 50 // 50 * 100ms = 5 seconds max wait

      const waitForMessageElement = async () => {
        while (retries < maxRetries) {
          // Check if message element exists in DOM
          const messageElement = document.querySelector(`[data-message-id="${result.messageId}"]`)
          if (messageElement) {
            console.log(`[Search] Message element found on retry ${retries}, navigating to message`)
            // Dispatch scroll-to-message event with search query for highlighting
            const event = new CustomEvent('search:navigate-to-message', {
              detail: {
                messageId: result.messageId,
                query: searchedQuery
              }
            })
            window.dispatchEvent(event)
            return
          }

          retries++
          if (retries % 10 === 0) {
            console.log(`[Search] Waiting for message element... (${retries}/${maxRetries})`)
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        console.warn(`[Search] Message element not found after ${maxRetries} retries, navigation failed`)
      }

      waitForMessageElement()
    } catch (error) {
      console.error(`[Search] Error navigating to result:`, error)
    }
  }

  const handleCancel = async () => {
    await api.cancelSearch()
    setIsSearching(false)
  }

  if (!isOpen) {
    return null
  }

  const scopeLabels = {
    conversation: t('Current conversation'),
    space: t('Current space'),
    global: t('All spaces'),
  }

  return (
    <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="glass-dialog w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden animate-scale-in">
        {/* Search Input */}
        <div className="flex items-center border-b border-border/30 px-5 py-3.5 gap-3">
          <span className="text-base text-muted-foreground/50">🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder={t('Search...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch()
              }
            }}
            className="flex-1 bg-transparent outline-none text-foreground text-sm"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all duration-200"
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scope Tabs */}
        <div className="flex border-b border-border/30 px-5 pt-1">
          {(['conversation', 'space', 'global'] as SearchScope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'px-4 py-2.5 border-b-2 text-sm font-medium transition-all duration-200',
                searchScope === s
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground/60 hover:text-foreground'
              )}
            >
              {scopeLabels[s]}
            </button>
          ))}
        </div>

        {/* Results or Loading State */}
        <div className="flex-1 overflow-y-auto p-5">
          {isSearching ? (
            <div className="text-center py-12">
              <div className="mb-4 text-sm text-muted-foreground">{t('Searching {{scope}}...', { scope: scopeLabels[searchScope] })}</div>
              <div className="text-xs text-muted-foreground/50 mb-4 tabular-nums">
                {t('Scanned {{current}} / {{total}} conversations', { current: progress.current, total: progress.total })}
              </div>
              <div className="w-full max-w-xs mx-auto bg-secondary/30 rounded-full h-1 mb-5">
                <div
                  className="bg-primary/70 h-1 rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`
                  }}
                />
              </div>
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-xs btn-ghost rounded-xl"
              >
                {t('Cancel search')}
              </button>
            </div>
          ) : results !== null && results.length > 0 ? (
            <div className="space-y-2.5">
              <div className="text-xs text-muted-foreground/50 font-medium">
                {t('Found {{count}} results', { count: results.length })}
              </div>
              {results.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left p-3.5 rounded-xl border border-border/30 hover:bg-secondary/20 hover:border-border/50 transition-all duration-200 text-sm"
                >
                  {/* Result Header */}
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-secondary/50 text-muted-foreground/60 flex-shrink-0">
                          {result.spaceName}
                        </span>
                        <span className="font-medium text-xs truncate text-foreground/80">
                          {result.conversationTitle}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground/40 mt-1 tabular-nums">
                        {new Date(result.messageTimestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} {new Date(result.messageTimestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-primary/8 text-primary/70 flex-shrink-0 font-medium">
                      {result.messageRole === 'user' ? t('You') : 'AI'}
                    </span>
                  </div>

                  {/* Highlighted Context */}
                  <div className="text-[13px] text-foreground/70 bg-secondary/15 p-2.5 rounded-lg mt-2 border-l-2 border-primary/30">
                    <span className="text-muted-foreground/60">{result.contextBefore}</span>
                    <span className="bg-yellow-500/20 font-semibold px-0.5 rounded">{searchedQuery}</span>
                    <span className="text-muted-foreground/60">{result.contextAfter}</span>
                  </div>

                  {result.matchCount > 1 && (
                    <div className="text-[11px] text-muted-foreground/40 mt-1.5">
                      {t('{{count}} matches in this message', { count: result.matchCount })}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : results !== null && results.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-sm text-muted-foreground/50">{t('No matching results found')}</div>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-sm text-muted-foreground/40">{t('Enter search content, press Enter to search')}</div>
            </div>
          )}
        </div>

        {/* Footer Help */}
        <div className="border-t border-border/20 px-5 py-2.5 text-[11px] text-muted-foreground/40 text-center">
          {t('Press Esc to close · Enter to search')}
        </div>
      </div>
    </div>
  )
}
