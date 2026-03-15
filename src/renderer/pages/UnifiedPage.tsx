import { useCallback, useEffect, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import { Header } from '../components/layout/Header'
import { ChatView } from '../components/chat/ChatView'
import { UnifiedSidebar } from '../components/unified/UnifiedSidebar'
import { SearchIcon } from '../components/search/SearchIcon'
import { GitBashWarningBanner } from '../components/setup/GitBashWarningBanner'
import { useSearchShortcuts } from '../hooks/useSearchShortcuts'
import { useAppStore } from '../stores/app.store'
import { useChatStore } from '../stores/chat.store'
import { useSearchStore, type SearchScope } from '../stores/search.store'
import { useSpaceStore } from '../stores/space.store'
import { navigateToConversationContext, navigateToSpaceContext } from '../utils/space-conversation-navigation'
import { pickEntryConversation } from '../utils/space-entry-conversation'
import { persistWorkspaceViewMode } from '../utils/workspace-view-mode'
import { useTranslation } from '../i18n'
import type { ConversationMeta, CreateSpaceInput } from '../types'
import { SpaceIcon } from '../components/icons/ToolIcons'

function pickPreferredSpace<T extends { id: string }>(
  currentSpace: T | null,
  kiteSpace: T | null,
  spaces: T[]
): T | null {
  return currentSpace || kiteSpace || spaces[0] || null
}

export function UnifiedPage() {
  const { t } = useTranslation()
  const {
    setView,
    mockBashMode,
    gitBashInstallProgress,
    startGitBashInstall
  } = useAppStore((state) => ({
    setView: state.setView,
    mockBashMode: state.mockBashMode,
    gitBashInstallProgress: state.gitBashInstallProgress,
    startGitBashInstall: state.startGitBashInstall
  }), shallow)
  const {
    currentSpace,
    kiteSpace,
    spaces,
    loadSpaces,
    setCurrentSpace: setSpaceStoreCurrentSpace,
    createSpace
  } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    kiteSpace: state.kiteSpace,
    spaces: state.spaces,
    loadSpaces: state.loadSpaces,
    setCurrentSpace: state.setCurrentSpace,
    createSpace: state.createSpace
  }), shallow)
  const {
    currentSpaceId,
    currentConversationId,
    spaceStates,
    isLoading,
    setCurrentSpace: setChatCurrentSpace,
    loadConversations,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation
  } = useChatStore((state) => ({
    currentSpaceId: state.currentSpaceId,
    currentConversationId: state.getCurrentConversationId(),
    spaceStates: state.spaceStates,
    isLoading: state.isLoading,
    setCurrentSpace: state.setCurrentSpace,
    loadConversations: state.loadConversations,
    createConversation: state.createConversation,
    selectConversation: state.selectConversation,
    renameConversation: state.renameConversation,
    deleteConversation: state.deleteConversation
  }), shallow)
  const { openSearch } = useSearchStore((state) => ({
    openSearch: state.openSearch
  }), shallow)

  const allSpaces = useMemo(() => {
    if (!kiteSpace) return spaces
    return [kiteSpace, ...spaces]
  }, [kiteSpace, spaces])

  const conversationsBySpaceId = useMemo(() => {
    const result = new Map<string, ConversationMeta[]>()
    for (const [spaceId, state] of spaceStates.entries()) {
      result.set(spaceId, state.conversations)
    }
    return result
  }, [spaceStates])

  const handleSearchShortcut = useCallback((scope: SearchScope) => {
    openSearch(scope)
  }, [openSearch])

  useSearchShortcuts({
    enabled: true,
    onSearch: handleSearchShortcut
  })

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  useEffect(() => {
    persistWorkspaceViewMode('unified')
  }, [])

  // Keep both stores aligned when entering Unified page.
  useEffect(() => {
    const preferred = pickPreferredSpace(currentSpace, kiteSpace, spaces)
    if (!preferred) return

    if (!currentSpace || currentSpace.id !== preferred.id) {
      setSpaceStoreCurrentSpace(preferred)
    }
    if (currentSpaceId !== preferred.id) {
      setChatCurrentSpace(preferred.id)
    }
  }, [
    currentSpace?.id,
    currentSpace,
    currentSpaceId,
    kiteSpace,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaces
  ])

  useEffect(() => {
    if (!currentSpaceId || spaceStates.has(currentSpaceId)) return
    void loadConversations(currentSpaceId)
  }, [currentSpaceId, loadConversations, spaceStates])

  useEffect(() => {
    if (!currentSpaceId) return
    const spaceState = spaceStates.get(currentSpaceId)
    if (!spaceState || spaceState.currentConversationId || spaceState.conversations.length === 0) return
    const entry = pickEntryConversation(spaceState.conversations) || spaceState.conversations[0]
    void selectConversation(entry.id)
  }, [currentSpaceId, selectConversation, spaceStates])

  const handleSelectSpace = useCallback(async (spaceId: string) => {
    await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
  }, [
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations
  ])

  const handleExpandSpace = useCallback(async (spaceId: string) => {
    if (!spaceStates.has(spaceId)) {
      await loadConversations(spaceId)
    }
  }, [loadConversations, spaceStates])

  const handleSelectConversation = useCallback(async (spaceId: string, conversationId: string) => {
    await navigateToConversationContext({
      targetSpaceId: spaceId,
      targetConversationId: conversationId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations,
      selectConversation
    })
  }, [
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations,
    selectConversation
  ])

  const handleCreateSpace = useCallback(async (input: CreateSpaceInput) => {
    const created = await createSpace(input)
    if (!created) return null

    await navigateToSpaceContext({
      targetSpaceId: created.id,
      currentSpaceId,
      spaces: [created, ...spaces],
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    return created
  }, [
    createSpace,
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations
  ])

  const handleCreateConversation = useCallback(async (spaceId: string) => {
    const spaceReady = await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    if (!spaceReady.success) return

    const created = await createConversation(spaceId)
    if (!created) return

    await navigateToConversationContext({
      targetSpaceId: spaceId,
      targetConversationId: created.id,
      currentSpaceId: spaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations,
      selectConversation
    })
  }, [
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations,
    createConversation,
    selectConversation
  ])

  const handleRenameConversation = useCallback(async (spaceId: string, conversationId: string, title: string) => {
    await renameConversation(spaceId, conversationId, title)
  }, [renameConversation])

  const handleDeleteConversation = useCallback(async (spaceId: string, conversationId: string) => {
    await deleteConversation(spaceId, conversationId)
  }, [deleteConversation])

  const handleCreateConversationInCurrentSpace = useCallback(async () => {
    if (!currentSpaceId) return
    await handleCreateConversation(currentSpaceId)
  }, [currentSpaceId, handleCreateConversation])

  const handleBackToCurrentSpaceMode = useCallback(() => {
    persistWorkspaceViewMode('classic')
    setView('space')
  }, [setView])

  return (
    <div className="h-full w-full flex flex-col">
      <Header
        left={(
          <>
            <button
              onClick={() => setView('home')}
              className="space-studio-header-btn p-2 rounded-lg transition-all duration-200 group"
              aria-label={t('Back to home')}
            >
              <svg className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {currentSpace && (
              <div className="flex items-center gap-2.5">
                <SpaceIcon iconId={currentSpace.icon} size={20} />
                <span className="font-medium text-sm tracking-tight">
                  {currentSpace.isTemp ? 'Kite' : currentSpace.name}
                </span>
              </div>
            )}
          </>
        )}
        right={(
          <>
            <button
              onClick={() => void handleCreateConversationInCurrentSpace()}
              className="space-studio-header-btn p-2 rounded-lg transition-all duration-200 group"
              title={t('New conversation')}
              aria-label={t('New conversation')}
            >
              <Plus className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
            <SearchIcon onClick={openSearch} isInSpace={true} />
            <div className="flex items-center rounded-lg border border-border/80 bg-card/70 p-0.5">
              <button
                onClick={handleBackToCurrentSpaceMode}
                className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground transition-colors"
                title={t('Current space')}
                aria-label={t('Current space')}
              >
                {t('Current space')}
              </button>
              <button
                className="px-2.5 py-1 text-xs rounded-md bg-secondary text-foreground"
                title={t('All spaces')}
                aria-label={t('All spaces')}
              >
                {t('All spaces')}
              </button>
            </div>
            <button
              onClick={() => setView('settings')}
              className="space-studio-header-btn p-2 rounded-lg transition-all duration-200 group"
              title={t('Settings')}
              aria-label={t('Settings')}
            >
              <svg className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </>
        )}
      />

      {mockBashMode && (
        <GitBashWarningBanner
          installProgress={gitBashInstallProgress}
          onInstall={startGitBashInstall}
        />
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <UnifiedSidebar
          spaces={allSpaces}
          currentSpaceId={currentSpaceId}
          currentConversationId={currentConversationId}
          conversationsBySpaceId={conversationsBySpaceId}
          isLoading={isLoading}
          onSelectSpace={handleSelectSpace}
          onExpandSpace={handleExpandSpace}
          onSelectConversation={handleSelectConversation}
          onCreateSpace={handleCreateSpace}
          onCreateConversation={handleCreateConversation}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
          onBackToCurrentSpaceMode={handleBackToCurrentSpaceMode}
        />

        <div className="flex-1 min-w-0 bg-background">
          <ChatView />
        </div>
      </div>
    </div>
  )
}
