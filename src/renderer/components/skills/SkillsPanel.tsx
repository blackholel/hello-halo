/**
 * SkillsPanel - Collapsible panel for browsing and managing skills
 * Features smooth animations, search filtering, and source grouping
 */

import { useState, useEffect, useMemo } from 'react'
import { Zap, Search, Plus, Star, Copy, Trash2, ChevronDown, MoreHorizontal, Power, Eye } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { buildDirective } from '../../utils/directive-helpers'

interface SkillsPanelProps {
  workDir?: string
  onSelectSkill?: (skill: SkillDefinition) => void
  onInsertSkill?: (skillName: string) => void
  onCreateSkill?: () => void
  preferInsertOnClick?: boolean
}

// Source label mapping
const SOURCE_LABELS: Record<SkillDefinition['source'], string> = {
  app: 'App',
  global: 'Global',
  space: 'Space',
  installed: 'Plugin'
}

// Source colors
const SOURCE_COLORS: Record<SkillDefinition['source'], string> = {
  app: 'bg-blue-500/10 text-blue-500',
  global: 'bg-purple-500/10 text-purple-500',
  space: 'bg-green-500/10 text-green-500',
  installed: 'bg-orange-500/10 text-orange-500'
}

/** Animation duration for panel expand/collapse (ms) */
const PANEL_ANIMATION_MS = 200

/** Per-item stagger delay (ms) */
const ITEM_STAGGER_MS = 30

export function SkillsPanel({
  workDir,
  onSelectSkill,
  onInsertSkill,
  onCreateSkill,
  preferInsertOnClick = false
}: SkillsPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'favorites'>('all')
  const [openMenuSkill, setOpenMenuSkill] = useState<string | null>(null)
  const [showAllInToolkitMode, setShowAllInToolkitMode] = useState(false)
  const [updatingToolkitSkill, setUpdatingToolkitSkill] = useState<string | null>(null)

  // Skills store
  const {
    skills,
    loadedWorkDir,
    isLoading,
    loadSkills,
    deleteSkill,
    copyToSpace
  } = useSkillsStore()

  // Space store for favorites
  const { currentSpace, updateSpacePreferences } = useSpaceStore()
  const {
    loadToolkit,
    getToolkit,
    isInToolkit,
    addResource,
    removeResource,
    isToolkitLoaded
  } = useToolkitStore()
  const favorites = currentSpace?.preferences?.skills?.favorites || []
  const enabledSkills = currentSpace?.preferences?.skills?.enabled || []
  const showOnlyEnabled = currentSpace?.preferences?.skills?.showOnlyEnabled ?? false

  const isToolkitManageableSpace = !!currentSpace && !currentSpace.isTemp
  const toolkitLoaded = !!currentSpace && isToolkitLoaded(currentSpace.id)
  const toolkit = currentSpace ? getToolkit(currentSpace.id) : null
  const isToolkitMode = isToolkitManageableSpace && toolkitLoaded && toolkit !== null

  // Load skills when panel opens
  useEffect(() => {
    if (isExpanded && (skills.length === 0 || loadedWorkDir !== (workDir ?? null))) {
      loadSkills(workDir)
    }
  }, [isExpanded, workDir, skills.length, loadedWorkDir, loadSkills])

  useEffect(() => {
    if (!isExpanded || !currentSpace || currentSpace.isTemp || toolkitLoaded) return
    void loadToolkit(currentSpace.id)
  }, [isExpanded, currentSpace, toolkitLoaded, loadToolkit])

  useEffect(() => {
    setShowAllInToolkitMode(false)
  }, [currentSpace?.id])

  // Filter skills based on search query
  const isEnabled = (skillName: string) => enabledSkills.includes(skillName)

  const toolkitSkills = useMemo(() => {
    if (!isToolkitMode || !currentSpace) return [] as SkillDefinition[]
    return skills.filter(skill => isInToolkit(currentSpace.id, buildDirective('skill', skill)))
  }, [skills, isToolkitMode, currentSpace, toolkit, isInToolkit])

  const totalSkillsCount = skills.length
  const toolkitSkillsCount = toolkitSkills.length
  const displaySkillsCount = isToolkitMode && !showAllInToolkitMode ? toolkitSkillsCount : totalSkillsCount

  const filteredSkills = useMemo(() => {
    let base = skills

    if (isToolkitMode && !showAllInToolkitMode) {
      base = toolkitSkills
    } else if (!isToolkitMode && showOnlyEnabled) {
      base = skills.filter(skill => isEnabled(skill.name))
    }
    if (!localSearchQuery.trim()) {
      return base
    }
    const query = localSearchQuery.toLowerCase()
    return base.filter(skill =>
      skill.name.toLowerCase().includes(query) ||
      skill.description?.toLowerCase().includes(query) ||
      skill.category?.toLowerCase().includes(query) ||
      skill.triggers?.some(t => t.toLowerCase().includes(query))
    )
  }, [
    skills,
    localSearchQuery,
    showOnlyEnabled,
    enabledSkills,
    isToolkitMode,
    showAllInToolkitMode,
    toolkitSkills
  ])

  // Check if skill is favorited
  const isFavorite = (skillName: string) => favorites.includes(skillName)

  const visibleSkills = useMemo(() => {
    if (viewMode === 'favorites') {
      return filteredSkills.filter(skill => isFavorite(skill.name))
    }
    return filteredSkills
  }, [filteredSkills, viewMode, favorites])

  // Group skills by source
  const groupedSkills = useMemo(() => {
    const groups: Record<SkillDefinition['source'], SkillDefinition[]> = {
      space: [],
      installed: [],
      global: [],
      app: []
    }
    for (const skill of filteredSkills) {
      groups[skill.source].push(skill)
    }
    return groups
  }, [filteredSkills])

  // Toggle favorite
  const toggleFavorite = async (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSpace) return
    const newFavorites = isFavorite(skillName)
      ? favorites.filter(f => f !== skillName)
      : [...favorites, skillName]
    await updateSpacePreferences(currentSpace.id, {
      skills: { favorites: newFavorites }
    })
  }

  const toggleEnabled = async (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSpace) return
    const newEnabled = isEnabled(skillName)
      ? enabledSkills.filter(s => s !== skillName)
      : [...enabledSkills, skillName]
    await updateSpacePreferences(currentSpace.id, {
      skills: { enabled: newEnabled }
    })
  }

  const toggleShowOnlyEnabled = async () => {
    if (!currentSpace) return
    await updateSpacePreferences(currentSpace.id, {
      skills: { showOnlyEnabled: !showOnlyEnabled }
    })
  }

  const handleToggleToolkit = async (skill: SkillDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSpace || currentSpace.isTemp) return

    const directive = buildDirective('skill', skill)
    const currentlyInToolkit = isInToolkit(currentSpace.id, directive)

    try {
      setUpdatingToolkitSkill(skill.path)
      if (currentlyInToolkit) {
        await removeResource(currentSpace.id, directive)
      } else {
        await addResource(currentSpace.id, directive)
      }
    } finally {
      setUpdatingToolkitSkill(null)
    }
  }

  // Handle close
  const handleClose = () => {
    setIsAnimatingOut(true)
    setTimeout(() => {
      setIsExpanded(false)
      setIsAnimatingOut(false)
    }, PANEL_ANIMATION_MS)
  }

  // Handle toggle
  const handleToggle = () => {
    if (isExpanded) {
      handleClose()
    } else {
      setIsExpanded(true)
    }
  }

  useEffect(() => {
    if (!isExpanded) {
      setOpenMenuSkill(null)
    }
  }, [isExpanded])

  // Handle skill click
  const handleSkillClick = (skill: SkillDefinition) => {
    if (preferInsertOnClick && onInsertSkill) {
      onInsertSkill(skill.name)
      setOpenMenuSkill(null)
      handleClose()
      return
    }
    if (onSelectSkill) {
      onSelectSkill(skill)
    }
  }

  // Handle insert skill
  const handleInsertSkill = (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onInsertSkill) {
      onInsertSkill(skillName)
      setOpenMenuSkill(null)
      handleClose()
    }
  }

  // Handle copy to space
  const handleCopyToSpace = async (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (workDir) {
      await copyToSpace(skillName, workDir)
    }
    setOpenMenuSkill(null)
  }

  // Handle delete
  const handleDelete = async (skill: SkillDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (skill.source === 'space') {
      await deleteSkill(skill.path)
    }
    setOpenMenuSkill(null)
  }

  const handleToggleMenu = (skillName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenMenuSkill(prev => prev === skillName ? null : skillName)
  }

  const handleViewDetails = (skill: SkillDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSelectSkill) {
      onSelectSkill(skill)
    }
    setOpenMenuSkill(null)
  }

  // Render skill item
  const renderSkillItem = (skill: SkillDefinition, index: number) => {
    const favorite = isFavorite(skill.name)
    const canDelete = skill.source === 'space'
    const canCopyToSpace = skill.source !== 'space' && workDir
    const isMenuOpen = openMenuSkill === skill.name
    const canViewDetails = !!onSelectSkill
    const skillInToolkit = isToolkitManageableSpace && currentSpace
      ? isInToolkit(currentSpace.id, buildDirective('skill', skill))
      : false
    const toolkitActionLabel = isToolkitMode
      ? (skillInToolkit ? t('Remove from toolkit') : t('Add to toolkit'))
      : t('Activate in space')

    return (
      <div
        key={skill.path}
        onClick={() => handleSkillClick(skill)}
        className="w-full px-3 py-2 text-left rounded-md transition-all duration-150
          hover:bg-muted/40 group relative cursor-pointer"
        style={{
          animation: !isAnimatingOut
            ? `fade-in 0.2s ease-out ${index * ITEM_STAGGER_MS}ms forwards`
            : undefined
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {!isToolkitMode && (
                <button
                  onClick={(e) => toggleEnabled(skill.name, e)}
                  className={`flex-shrink-0 transition-colors ${
                    isEnabled(skill.name) ? 'text-green-500' : 'text-muted-foreground/40 hover:text-green-500/60'
                  }`}
                  title={isEnabled(skill.name) ? t('Disable skill') : t('Enable skill')}
                >
                  <Power size={12} />
                </button>
              )}
              <button
                onClick={(e) => toggleFavorite(skill.name, e)}
                className={`flex-shrink-0 transition-colors ${
                  favorite ? 'text-yellow-500' : 'text-muted-foreground/40 hover:text-yellow-500/60'
                }`}
                title={favorite ? t('Remove from favorites') : t('Add to favorites')}
              >
                <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
              </button>
              {isToolkitManageableSpace && (
                <button
                  onClick={(e) => handleToggleToolkit(skill, e)}
                  disabled={updatingToolkitSkill === skill.path}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                  title={toolkitActionLabel}
                >
                  {updatingToolkitSkill === skill.path
                    ? t('Loading...')
                    : toolkitActionLabel}
                </button>
              )}
              <span className="text-xs font-mono text-foreground truncate">
                /{skill.name}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[skill.source]}`}>
                {SOURCE_LABELS[skill.source]}
              </span>
            </div>
            {skill.description && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate pl-6">
                {skill.description}
              </p>
            )}
          </div>

          <div
            className={`flex items-center gap-1.5 transition-all ${
              isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {onInsertSkill && (
              <button
                onClick={(e) => handleInsertSkill(skill.name, e)}
                className="px-2 py-1 text-[10px] font-medium rounded-md
                  bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title={t('Insert to input')}
              >
                {t('Insert')}
              </button>
            )}

            <div className="relative">
              {(canCopyToSpace || canDelete || canViewDetails) && (
                <>
                  <button
                    onClick={(e) => handleToggleMenu(skill.name, e)}
                    className="p-1.5 hover:bg-muted/60 text-muted-foreground hover:text-foreground rounded transition-colors"
                    title={t('More')}
                  >
                    <MoreHorizontal size={14} />
                  </button>

                  {isMenuOpen && (
                    <div
                      className="absolute right-0 top-6 z-10 min-w-[140px] rounded-md
                        bg-popover border border-border/60 shadow-lg overflow-hidden"
                    >
                      {onSelectSkill && (
                        <button
                          onClick={(e) => handleViewDetails(skill, e)}
                          className="w-full px-3 py-2 text-left text-xs text-foreground
                            hover:bg-muted/60 flex items-center gap-2"
                        >
                          <Eye size={12} />
                          {t('View details')}
                        </button>
                      )}
                      {canCopyToSpace && (
                        <button
                          onClick={(e) => handleCopyToSpace(skill.name, e)}
                          className="w-full px-3 py-2 text-left text-xs text-foreground
                            hover:bg-muted/60 flex items-center gap-2"
                        >
                          <Copy size={12} />
                          {t('Copy to space')}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={(e) => handleDelete(skill, e)}
                          className="w-full px-3 py-2 text-left text-xs text-destructive
                            hover:bg-destructive/10 flex items-center gap-2"
                        >
                          <Trash2 size={12} />
                          {t('Delete skill')}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render skill group
  const renderSkillGroup = (source: SkillDefinition['source'], skills: SkillDefinition[]) => {
    if (skills.length === 0) return null

    return (
      <div key={source} className="mb-2">
        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {SOURCE_LABELS[source]} ({skills.length})
        </div>
        {skills.map((skill, index) => renderSkillItem(skill, index))}
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Toggle button */}
      <button
        onClick={handleToggle}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-200
          ${isExpanded
            ? 'bg-muted/60 text-foreground border border-border/60'
            : 'hover:bg-muted/50 text-muted-foreground'
          }
        `}
        title={t('Skills')}
      >
        <span className="flex items-center gap-2">
          <Zap size={16} className={isExpanded ? 'text-primary' : ''} />
          <span className="text-sm font-semibold">{t('Skills')}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {displaySkillsCount}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {/* Embedded panel */}
      {isExpanded && (
        <div
          className={`
            mt-2 w-full
            bg-card/90 backdrop-blur-xl rounded-xl border border-border/60
            shadow-sm overflow-hidden
            ${isAnimatingOut ? 'animate-fade-out' : 'animate-fade-in'}
          `}
          style={{ animationDuration: '0.2s' }}
        >
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-foreground">{t('Skills')}</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isToolkitMode && !showAllInToolkitMode
                  ? t('{{toolkit}} / {{total}} skills in toolkit', {
                    toolkit: toolkitSkillsCount,
                    total: totalSkillsCount
                  })
                  : t('{{count}} skills available', { count: totalSkillsCount })}
              </p>
            </div>
            {workDir && onCreateSkill && (
              <button
                onClick={onCreateSkill}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium
                  bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
              >
                <Plus size={14} />
                {t('New skill')}
              </button>
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border/30">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                placeholder={t('Search skills...')}
                className="w-full pl-9 pr-3 py-2 text-xs bg-input border border-border/40
                  rounded-md focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="mt-1 flex items-center gap-1">
              <div className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5">
                <button
                  onClick={() => setViewMode('all')}
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    viewMode === 'all'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('All')}
                </button>
                <button
                  onClick={() => setViewMode('favorites')}
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    viewMode === 'favorites'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('Favorites')}
                </button>
              </div>
              {!isToolkitMode && (
                <button
                  onClick={toggleShowOnlyEnabled}
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    showOnlyEnabled
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showOnlyEnabled ? t('Enabled only') : t('All')}
                </button>
              )}
              {isToolkitMode && (
                <button
                  onClick={() => setShowAllInToolkitMode(prev => !prev)}
                  className="px-2 py-0.5 text-[10px] rounded text-muted-foreground hover:text-foreground"
                >
                  {showAllInToolkitMode ? t('Toolkit resources only') : t('Browse all resources')}
                </button>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {isToolkitMode && !showAllInToolkitMode
                  ? t('Toolkit mode enabled')
                  : t('Click a skill to insert /name')}
              </span>
            </div>
          </div>

          {/* Skills list */}
          <div className="max-h-[320px] overflow-auto px-1 py-1">
            {isLoading ? (
              <div className="px-4 py-6 text-center">
                <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">{t('Loading skills...')}</p>
              </div>
            ) : visibleSkills.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 flex items-center justify-center">
                  <Zap size={24} className="text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {localSearchQuery
                    ? t('No skills found')
                    : (isToolkitMode && !showAllInToolkitMode ? t('No toolkit resources available') : t('No skills available'))}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {localSearchQuery
                    ? t('Try a different search term')
                    : viewMode === 'favorites' ? t('Favorite a skill to see it here') : t('Create a new skill to get started')}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {viewMode === 'favorites' ? (
                  <div className="mb-2">
                    <div className="px-3 py-1 text-[10px] font-medium text-yellow-500/80 uppercase tracking-wider flex items-center gap-1">
                      <Star size={12} fill="currentColor" />
                      {t('Favorites')}
                    </div>
                    {visibleSkills.map((skill, index) => renderSkillItem(skill, index))}
                  </div>
                ) : (
                  <>
                    {favorites.length > 0 && (
                      <div className="mb-2">
                        <div className="px-3 py-1 text-[10px] font-medium text-yellow-500/80 uppercase tracking-wider flex items-center gap-1">
                          <Star size={12} fill="currentColor" />
                          {t('Favorites')}
                        </div>
                        {filteredSkills
                          .filter(s => isFavorite(s.name))
                          .map((skill, index) => renderSkillItem(skill, index))}
                      </div>
                    )}

                    {renderSkillGroup('space', groupedSkills.space.filter(s => !isFavorite(s.name)))}
                    {renderSkillGroup('installed', groupedSkills.installed.filter(s => !isFavorite(s.name)))}
                    {renderSkillGroup('global', groupedSkills.global.filter(s => !isFavorite(s.name)))}
                    {renderSkillGroup('app', groupedSkills.app.filter(s => !isFavorite(s.name)))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
