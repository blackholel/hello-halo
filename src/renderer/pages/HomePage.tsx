/**
 * Home Page - Apple-inspired Space Selection
 *
 * Design philosophy:
 * - Liquid Glass aesthetic with subtle depth and translucency
 * - Ambient background orbs for visual richness
 * - Clean hierarchy with generous whitespace
 * - Smooth, spring-based animations
 * - Refined glass cards with light/shadow interplay
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../stores/app.store'
import { useSpaceStore } from '../stores/space.store'
import { useToolkitStore } from '../stores/toolkit.store'
import { SPACE_ICONS, DEFAULT_SPACE_ICON } from '../types'
import type { Space, CreateSpaceInput, SpaceIconId, DirectiveRef } from '../types'
import { formatDirectiveName } from '../utils/directive-helpers'
import { resolveSpacePathKind, shortenDisplayPath } from '../utils/space-path'
import {
  SpaceIcon,
  Sparkles,
  Settings,
  Plus,
  Trash2,
  FolderOpen,
  Pencil
} from '../components/icons/ToolIcons'
import { Header } from '../components/layout/Header'
import { SpaceGuide } from '../components/space/SpaceGuide'
import { HomeActivityBar } from '../components/home/HomeActivityBar'
import { ExtensionsView } from '../components/home/ExtensionsView'
import { Monitor, ArrowRight, X, LayoutGrid, Puzzle } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { normalizeEnabledValues } from '../utils/resource-key'

// Check if running in web mode
const isWebMode = api.isRemoteMode()

export function HomePage(): JSX.Element {
  const { t } = useTranslation()
  const { setView } = useAppStore()
  const {
    kiteSpace,
    spaces,
    loadSpaces,
    setCurrentSpace,
    createSpace,
    updateSpace,
    deleteSpace,
    getSpacePreferences
  } = useSpaceStore()

  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [newSpaceIcon, setNewSpaceIcon] = useState<SpaceIconId>(DEFAULT_SPACE_ICON)

  // Edit dialog state
  const [editingSpace, setEditingSpace] = useState<Space | null>(null)
  const [editSpaceName, setEditSpaceName] = useState('')
  const [editSpaceIcon, setEditSpaceIcon] = useState<SpaceIconId>(DEFAULT_SPACE_ICON)
  const [isToolkitUpdating, setIsToolkitUpdating] = useState(false)
  const [toolkitActionError, setToolkitActionError] = useState<string | null>(null)
  const [showClearToolkitConfirm, setShowClearToolkitConfirm] = useState(false)

  const {
    loadToolkit,
    getToolkit,
    clearToolkit,
    migrateFromPreferences,
    isToolkitLoaded
  } = useToolkitStore()

  // Path selection state
  const [useCustomPath, setUseCustomPath] = useState(false)
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [defaultPath, setDefaultPath] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'spaces' | 'extensions'>('spaces')

  // Close dialogs on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (editingSpace) {
          handleCancelEdit()
        } else if (showCreateDialog) {
          resetDialog()
        }
      }
    }
    if (showCreateDialog || editingSpace) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showCreateDialog, editingSpace])

  // Load spaces on mount
  useEffect(() => {
    loadSpaces()
  }, [loadSpaces])

  const loadDefaultPath = useCallback(async (): Promise<string> => {
    const res = await api.getDefaultSpacePath()
    if (res.success && typeof res.data === 'string') {
      setDefaultPath(res.data)
      return res.data
    }
    return ''
  }, [])

  useEffect(() => {
    void loadDefaultPath()
  }, [loadDefaultPath])

  // Load toolkit when editing space dialog opens
  useEffect(() => {
    if (!editingSpace || editingSpace.isTemp) return
    const loaded = isToolkitLoaded(editingSpace.id)
    if (loaded) return
    void loadToolkit(editingSpace.id)
  }, [editingSpace, isToolkitLoaded, loadToolkit])

  const editingToolkitLoaded = !!editingSpace && isToolkitLoaded(editingSpace.id)
  const editingToolkit = editingSpace ? getToolkit(editingSpace.id) : null
  const editingPreferences = editingSpace ? getSpacePreferences(editingSpace.id) : undefined
  const legacyEnabledSkills = editingPreferences?.skills?.enabled || []
  const legacyEnabledAgents = editingPreferences?.agents?.enabled || []
  const normalizedEnabledSkills = useMemo(
    () => normalizeEnabledValues(legacyEnabledSkills),
    [legacyEnabledSkills]
  )
  const normalizedEnabledAgents = useMemo(
    () => normalizeEnabledValues(legacyEnabledAgents),
    [legacyEnabledAgents]
  )
  const canImportToolkit = legacyEnabledSkills.length > 0 || legacyEnabledAgents.length > 0

  const toolkitGroups = useMemo((): Array<{ key: string; title: string; items: DirectiveRef[] }> => {
    if (!editingToolkit) return []
    return [
      { key: 'skills', title: t('Skills'), items: editingToolkit.skills },
      { key: 'agents', title: t('Agents'), items: editingToolkit.agents },
      { key: 'commands', title: t('Commands'), items: editingToolkit.commands }
    ]
  }, [editingToolkit, t])

  const handleClearEditingToolkit = async (): Promise<void> => {
    if (!editingSpace) return

    setIsToolkitUpdating(true)
    setToolkitActionError(null)

    try {
      await clearToolkit(editingSpace.id)
      await loadToolkit(editingSpace.id)
    } catch (error) {
      console.error('[HomePage] Failed to clear toolkit:', error)
      setToolkitActionError(t('Failed to update toolkit'))
    } finally {
      setIsToolkitUpdating(false)
      setShowClearToolkitConfirm(false)
    }
  }

  const handleImportToolkitFromPreferences = async (): Promise<void> => {
    if (!editingSpace) return

    setIsToolkitUpdating(true)
    setToolkitActionError(null)

    try {
      if (normalizedEnabledSkills.length === 0 && normalizedEnabledAgents.length === 0) {
        setToolkitActionError(t('Failed to parse enabled resources'))
        return
      }

      const migrated = await migrateFromPreferences(
        editingSpace.id,
        normalizedEnabledSkills,
        normalizedEnabledAgents
      )
      if (!migrated) {
        setToolkitActionError(t('Failed to write toolkit resources'))
        return
      }
      await loadToolkit(editingSpace.id)
    } catch (error) {
      console.error('[HomePage] Failed to import toolkit from preferences:', error)
      setToolkitActionError(t('Failed to write toolkit resources'))
    } finally {
      setIsToolkitUpdating(false)
    }
  }

  // Handle folder selection
  const handleSelectFolder = async (): Promise<void> => {
    if (isWebMode) return
    const res = await api.selectFolder()
    if (res.success && res.data) {
      setCustomPath(res.data as string)
      setUseCustomPath(true)
    }
  }

  // Reset dialog state
  const resetDialog = (): void => {
    setShowCreateDialog(false)
    setNewSpaceName('')
    setNewSpaceIcon(DEFAULT_SPACE_ICON)
    setUseCustomPath(false)
    setCustomPath(null)
  }

  // Handle space click
  const handleSpaceClick = (space: Space): void => {
    setCurrentSpace(space)
    setView('space')
  }

  // Handle create space
  const handleCreateSpace = async (): Promise<void> => {
    if (!newSpaceName.trim()) return

    const input: CreateSpaceInput = {
      name: newSpaceName.trim(),
      icon: newSpaceIcon,
      customPath: useCustomPath && customPath ? customPath : undefined
    }

    const newSpace = await createSpace(input)

    if (newSpace) {
      resetDialog()
    }
  }

  // Handle delete space
  const handleDeleteSpace = async (e: React.MouseEvent, spaceId: string): Promise<void> => {
    e.stopPropagation()

    const space = spaces.find(s => s.id === spaceId)
    if (!space) return

    let resolvedDefaultPath = defaultPath
    if (!resolvedDefaultPath) {
      resolvedDefaultPath = await loadDefaultPath()
    }

    const pathKind = resolveSpacePathKind(space.path, resolvedDefaultPath)

    let message: string
    if (pathKind === 'custom') {
      message = t('Are you sure you want to delete this space?\n\nOnly Kite data (conversation history) will be deleted, your project files will be kept.')
    } else if (pathKind === 'default') {
      message = t('Are you sure you want to delete this space?\n\nAll conversations and files in the space will be deleted.')
    } else {
      message = t('Are you sure you want to delete this space?\n\nKite could not verify the storage type. This operation may delete all conversations and files in the space folder.')
    }

    if (confirm(message)) {
      await deleteSpace(spaceId)
    }
  }

  // Handle edit space
  const handleEditSpace = (e: React.MouseEvent, space: Space): void => {
    e.stopPropagation()
    setEditingSpace(space)
    setEditSpaceName(space.name)
    setEditSpaceIcon(space.icon as SpaceIconId)
    setToolkitActionError(null)
  }

  // Handle save space edit
  const handleSaveEdit = async (): Promise<void> => {
    if (!editingSpace || !editSpaceName.trim()) return

    await updateSpace(editingSpace.id, {
      name: editSpaceName.trim(),
      icon: editSpaceIcon
    })

    setEditingSpace(null)
    setEditSpaceName('')
    setEditSpaceIcon(DEFAULT_SPACE_ICON)
  }

  // Handle cancel edit
  const handleCancelEdit = (): void => {
    setEditingSpace(null)
    setEditSpaceName('')
    setEditSpaceIcon(DEFAULT_SPACE_ICON)
    setIsToolkitUpdating(false)
    setToolkitActionError(null)
    setShowClearToolkitConfirm(false)
  }

  // Format time ago
  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return t('Today')
    if (diffDays === 1) return t('Yesterday')
    if (diffDays < 7) return t('{{count}} days ago', { count: diffDays })
    if (diffDays < 30) return t('{{count}} weeks ago', { count: Math.floor(diffDays / 7) })
    return t('{{count}} months ago', { count: Math.floor(diffDays / 30) })
  }

  // Resolve custom location style (avoids nested ternary in JSX)
  let customLocationClass: string
  if (isWebMode) {
    customLocationClass = 'cursor-not-allowed opacity-50 border-border'
  } else if (useCustomPath) {
    customLocationClass = 'cursor-pointer border-primary/30 bg-primary/5'
  } else {
    customLocationClass = 'cursor-pointer border-border hover:border-muted-foreground/30'
  }

  // Resolve custom folder description (avoids nested ternary in JSX)
  function renderCustomPathDescription(): JSX.Element {
    if (isWebMode) {
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Monitor className="w-3 h-3" />
          {t('Please select folder in desktop app')}
        </div>
      )
    }
    if (customPath) {
      return (
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {shortenDisplayPath(customPath)}
        </div>
      )
    }
    return (
      <div className="text-xs text-muted-foreground mt-0.5">
        {t('Select an existing project or folder')}
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col relative">
      {/* Ambient background orbs */}
      <div className="ambient-bg">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
      </div>

      {/* Header */}
      <Header
        left={
          <>
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/50 to-primary/20 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-primary/80" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Kite</span>
          </>
        }
        right={
          <button
            onClick={() => setView('settings')}
            className="p-2 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
          >
            <Settings className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        }
      />

      {/* Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        <HomeActivityBar activeTab={activeTab} onTabChange={setActiveTab} className="hidden sm:block" />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="sm:hidden px-4 pt-4">
            <div className="glass-card p-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('spaces')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all duration-200 ${
                  activeTab === 'spaces'
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                {t('Spaces')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('extensions')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all duration-200 ${
                  activeTab === 'extensions'
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                <Puzzle className="w-4 h-4" />
                {t('Extensions')}
              </button>
            </div>
          </div>

          <main className="flex-1 overflow-auto">
            {activeTab === 'spaces' ? (
              <div className="max-w-2xl mx-auto px-6 py-8">

                {/* Hero - Kite Space Card */}
                {kiteSpace && (
                  <div
                    data-onboarding="kite-space"
                    onClick={() => handleSpaceClick(kiteSpace)}
                    className="kite-space-card rounded-2xl p-7 cursor-pointer mb-10 stagger-item"
                    style={{ animationDelay: '0ms' }}
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold tracking-tight">{t('Enter Kite')}</h2>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                            {t('Aimless time, ideas will crystallize here')}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-primary/50" />
                    </div>
                    {(kiteSpace.stats.artifactCount > 0 || kiteSpace.stats.conversationCount > 0) && (
                      <div className="mt-4 pt-4 border-t border-primary/10 relative z-10">
                        <p className="text-xs text-muted-foreground">
                          {t('{{count}} artifacts · {{conversations}} conversations', {
                            count: kiteSpace.stats.artifactCount,
                            conversations: kiteSpace.stats.conversationCount
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Spaces Section Header */}
                <div
                  className="mb-5 flex items-center justify-between stagger-item"
                  style={{ animationDelay: '60ms' }}
                >
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('Dedicated Spaces')}
                  </h3>
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    {t('New')}
                  </button>
                </div>

                {/* Space Guide */}
                <div className="stagger-item" style={{ animationDelay: '90ms' }}>
                  <SpaceGuide />
                </div>

                {/* Space Grid */}
                {spaces.length === 0 ? (
                  <div
                    className="text-center py-16 stagger-item"
                    style={{ animationDelay: '120ms' }}
                  >
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-secondary/60 flex items-center justify-center">
                      <FolderOpen className="w-6 h-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('No dedicated spaces yet')}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {t('Create one to organize your projects')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {spaces.map((space, index) => (
                      <div
                        key={space.id}
                        onClick={() => handleSpaceClick(space)}
                        className="space-card p-5 group stagger-item"
                        style={{ animationDelay: `${120 + index * 50}ms` }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-secondary/60 flex items-center justify-center flex-shrink-0">
                              <SpaceIcon iconId={space.icon} size={20} />
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium text-[15px] truncate block">{space.name}</span>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatTimeAgo(space.updatedAt)}{t('active')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 flex-shrink-0 ml-2">
                            <button
                              onClick={(e) => handleEditSpace(e, space)}
                              className="p-1.5 hover:bg-secondary rounded-lg transition-all"
                              title={t('Edit Space')}
                            >
                              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteSpace(e, space.id)}
                              className="p-1.5 hover:bg-destructive/15 rounded-lg transition-all"
                              title={t('Delete space')}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground/70">
                          <span>{space.stats.artifactCount} {t('artifacts')}</span>
                          <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
                          <span>{space.stats.conversationCount} {t('conversations')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <ExtensionsView />
            )}
          </main>
        </div>
      </div>

      {/* Create Space Dialog */}
      {showCreateDialog && (
        <div
          className="fixed inset-0 glass-overlay flex items-center justify-center z-50 animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={resetDialog}
        >
          <div
            className="glass-dialog p-7 w-full max-w-2xl max-h-[80vh] overflow-auto mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold tracking-tight">{t('Create Dedicated Space')}</h2>
              <button
                onClick={resetDialog}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Space name */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t('Space Name')}
              </label>
              <input
                type="text"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                placeholder={t('My Project')}
                className="w-full px-4 py-2.5 input-apple text-sm"
                autoFocus
              />
            </div>

            {/* Icon select */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t('Icon (optional)')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SPACE_ICONS.map((iconId) => (
                  <button
                    key={iconId}
                    onClick={() => setNewSpaceIcon(iconId)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                      newSpaceIcon === iconId
                        ? 'bg-primary/15 ring-2 ring-primary/40 scale-105'
                        : 'bg-secondary/50 hover:bg-secondary/80'
                    }`}
                  >
                    <SpaceIcon iconId={iconId} size={18} />
                  </button>
                ))}
              </div>
            </div>

            {/* Storage location */}
            <div className="mb-7">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t('Storage Location')}
              </label>
              <div className="space-y-2">
                {/* Default location */}
                <label
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                    !useCustomPath
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    !useCustomPath ? 'border-primary' : 'border-muted-foreground/40'
                  }`}>
                    {!useCustomPath && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t('Default Location')}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {shortenDisplayPath(defaultPath || '...')}/{newSpaceName || '...'}
                    </div>
                  </div>
                </label>

                {/* Custom location */}
                <label
                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 ${customLocationClass}`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    useCustomPath ? 'border-primary' : 'border-muted-foreground/40'
                  }`}>
                    {useCustomPath && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t('Custom Folder')}</div>
                    {renderCustomPathDescription()}
                  </div>
                  {!isWebMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        handleSelectFolder()
                      }}
                      className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded-lg flex items-center gap-1.5 transition-colors font-medium"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t('Browse')}
                    </button>
                  )}
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2.5">
              <button
                onClick={resetDialog}
                className="px-5 py-2.5 btn-ghost text-sm font-medium"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handleCreateSpace}
                disabled={!newSpaceName.trim() || (useCustomPath && !customPath)}
                className="px-5 py-2.5 btn-apple text-sm"
              >
                {t('Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Space Dialog */}
      {editingSpace && (
        <div
          className="fixed inset-0 glass-overlay flex items-center justify-center z-50 animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={handleCancelEdit}
        >
          <div
            className="glass-dialog p-7 w-full max-w-2xl max-h-[80vh] overflow-auto mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold tracking-tight">{t('Edit Space')}</h2>
              <button
                onClick={handleCancelEdit}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Space name */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t('Space Name')}
              </label>
              <input
                type="text"
                value={editSpaceName}
                onChange={(e) => setEditSpaceName(e.target.value)}
                placeholder={t('My Project')}
                className="w-full px-4 py-2.5 input-apple text-sm"
                autoFocus
              />
            </div>

            {/* Icon select */}
            <div className="mb-7">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {t('Icon')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SPACE_ICONS.map((iconId) => (
                  <button
                    key={iconId}
                    onClick={() => setEditSpaceIcon(iconId)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                      editSpaceIcon === iconId
                        ? 'bg-primary/15 ring-2 ring-primary/40 scale-105'
                        : 'bg-secondary/50 hover:bg-secondary/80'
                    }`}
                  >
                    <SpaceIcon iconId={iconId} size={18} />
                  </button>
                ))}
              </div>
            </div>

            {/* Toolkit management */}
            <div className="mb-7">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('Toolkit')}
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('Manage resource access for this space')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImportToolkitFromPreferences}
                    disabled={isToolkitUpdating || !canImportToolkit}
                    className="px-3 py-1.5 text-xs rounded-lg bg-secondary hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('Import from Preferences')}
                  </button>
                  {showClearToolkitConfirm ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{t('Clear toolkit and return this space to load-all mode?')}</span>
                      <button
                        onClick={handleClearEditingToolkit}
                        disabled={isToolkitUpdating}
                        className="px-2 py-1 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {t('Confirm')}
                      </button>
                      <button
                        onClick={() => setShowClearToolkitConfirm(false)}
                        className="px-2 py-1 text-xs rounded-lg bg-secondary hover:bg-secondary/80"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowClearToolkitConfirm(true)}
                      disabled={isToolkitUpdating || !editingToolkitLoaded || editingToolkit === null}
                      className="px-3 py-1.5 text-xs rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('Clear Toolkit')}
                    </button>
                  )}
                </div>
              </div>

              {!editingToolkitLoaded ? (
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
                  {t('Loading toolkit...')}
                </div>
              ) : editingToolkit ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t('Toolkit whitelist mode is active. Only resources listed below are available.')}
                  </p>
                  {toolkitGroups.map((group) => (
                    <div key={group.key} className="rounded-xl border border-border/60 bg-secondary/20 p-3">
                      <div className="text-xs font-medium mb-2">{group.title} ({group.items.length})</div>
                      {group.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('No resources')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {group.items.map((ref) => (
                            <span
                              key={`${group.key}-${ref.id || `${ref.type}:${ref.namespace ?? '-'}:${ref.name}`}`}
                              className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-muted/60 text-foreground"
                            >
                              {formatDirectiveName(ref)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
                  {t('Toolkit is not configured for this space. All resources are currently available.')}
                </div>
              )}

              {toolkitActionError && (
                <p className="mt-2 text-xs text-destructive">{toolkitActionError}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2.5">
              <button
                onClick={handleCancelEdit}
                className="px-5 py-2.5 btn-ghost text-sm font-medium"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editSpaceName.trim() || isToolkitUpdating}
                className="px-5 py-2.5 btn-apple text-sm"
              >
                {t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
