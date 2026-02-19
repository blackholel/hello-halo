import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, MoreHorizontal, Plus, Search, SquarePen, Star, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { buildDirective } from '../../utils/directive-helpers'
import {
  canonicalizeEnabledForResources,
  isResourceEnabled,
  toggleEnabledForResource
} from '../../utils/resource-key'

interface SkillsPanelProps {
  workDir?: string
  onSelectSkill?: (skill: SkillDefinition) => void
  onInsertSkill?: (skillName: string) => void
  onCreateSkill?: () => void
  onOpenTemplateLibrary?: () => void
  preferInsertOnClick?: boolean
}

export function SkillsPanel({
  workDir,
  onSelectSkill,
  onInsertSkill,
  onCreateSkill,
  onOpenTemplateLibrary,
  preferInsertOnClick = false
}: SkillsPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'all' | 'favorites'>('all')

  const { skills, loadedWorkDir, isLoading, loadSkills, deleteSkill } = useSkillsStore()
  const { currentSpace, updateSpacePreferences } = useSpaceStore()
  const favorites = currentSpace?.preferences?.skills?.favorites || []

  useEffect(() => {
    if (!isExpanded || !currentSpace || currentSpace.isTemp || toolkitLoaded) return
    void loadToolkit(currentSpace.id)
  }, [isExpanded, currentSpace, toolkitLoaded, loadToolkit])

  useEffect(() => {
    setShowAllInToolkitMode(false)
  }, [currentSpace?.id])

  useEffect(() => {
    if (!currentSpace || enabledSkills.length === 0 || skills.length === 0) return

    const canonical = canonicalizeEnabledForResources(enabledSkills, skills)
    const sameLength = canonical.length === enabledSkills.length
    const unchanged = sameLength && canonical.every((value, index) => value === enabledSkills[index])
    if (unchanged) return

    void updateSpacePreferences(currentSpace.id, {
      skills: { enabled: canonical }
    })
  }, [currentSpace?.id, enabledSkills, skills, updateSpacePreferences])

  // Filter skills based on search query
  const isEnabled = (skill: SkillDefinition) => isResourceEnabled(enabledSkills, skill)

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
      base = skills.filter(skill => isEnabled(skill))
    }
  }, [expanded, loadSkills, loadedWorkDir, skills.length, workDir])

  const visibleSkills = useMemo(() => {
    const spaceSkills = skills.filter(skill => skill.source === 'space')
    const q = query.trim().toLowerCase()
    const searched = q
      ? spaceSkills.filter(skill => (
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
      ))
      : spaceSkills

    if (viewMode === 'favorites') {
      return searched.filter(skill => favorites.includes(skill.name))
    }

    return searched
  }, [skills, query, viewMode, favorites])

  const toggleFavorite = async (skillName: string): Promise<void> => {
    if (!currentSpace) return
    const next = favorites.includes(skillName)
      ? favorites.filter(item => item !== skillName)
      : [...favorites, skillName]
    await updateSpacePreferences(currentSpace.id, { skills: { favorites: next } })
  }

  const toggleEnabled = async (skill: SkillDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSpace) return
    const newEnabled = toggleEnabledForResource(enabledSkills, skill, skills)
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
                  onClick={(e) => toggleEnabled(skill, e)}
                  className={`flex-shrink-0 transition-colors ${
                    isEnabled(skill) ? 'text-green-500' : 'text-muted-foreground/40 hover:text-green-500/60'
                  }`}
                  title={isEnabled(skill) ? t('Disable skill') : t('Enable skill')}
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
    <div className="rounded-lg border border-border/40 bg-card/20">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span>{t('Skills')}</span>
        <ChevronDown size={14} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 rounded-md hover:bg-secondary/70"
              title={t('Create skill')}
              onClick={() => onCreateSkill?.()}
            >
              <SquarePen size={14} />
            </button>
            <button
              className="p-1.5 rounded-md hover:bg-secondary/70"
              title={t('Template Library')}
              onClick={onOpenTemplateLibrary}
            >
              <Plus size={14} />
            </button>
            <button
              className={`px-2 py-1 text-[11px] rounded-md ${viewMode === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setViewMode('all')}
            >
              {t('All')}
            </button>
            <button
              className={`px-2 py-1 text-[11px] rounded-md ${viewMode === 'favorites' ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setViewMode('favorites')}
            >
              {t('Favorites')}
            </button>
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search skills...')}
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-border/40"
            />
          </div>

          <div className="max-h-56 overflow-auto space-y-1">
            {isLoading ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">{t('Loading...')}</div>
            ) : visibleSkills.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">
                {t('Agent can suggest creating Skills in chat. You can also click ➕ to import from Template Library.')}
              </div>
            ) : (
              visibleSkills.map((skill) => (
                <div
                  key={skill.path}
                  className="relative rounded-md px-2 py-1.5 hover:bg-secondary/50 group"
                  onClick={() => {
                    if (preferInsertOnClick && onInsertSkill) {
                      onInsertSkill(skill.name)
                      return
                    }
                    onSelectSkill?.(skill)
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">/{skill.name}</div>
                      {skill.description && (
                        <div className="text-[11px] text-muted-foreground truncate">{skill.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        className="p-1 rounded hover:bg-secondary"
                        title={t('Favorite')}
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleFavorite(skill.name)
                        }}
                      >
                        <Star size={12} fill={favorites.includes(skill.name) ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-secondary"
                        onClick={(event) => {
                          event.stopPropagation()
                          setMenuPath(prev => prev === skill.path ? null : skill.path)
                        }}
                      >
                        <MoreHorizontal size={12} />
                      </button>
                    </div>
                  </div>

                  {menuPath === skill.path && (
                    <div className="absolute right-1 top-8 z-20 rounded-md border border-border bg-popover shadow-lg p-1 min-w-[120px]">
                      <button className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded" onClick={() => onSelectSkill?.(skill)}>{t('View')}</button>
                      {onInsertSkill && (
                        <button className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded" onClick={() => onInsertSkill(skill.name)}>{t('Insert')}</button>
                      )}
                      <button
                        className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded"
                        onClick={() => {
                          void navigator.clipboard.writeText(skill.name)
                          setMenuPath(null)
                        }}
                      >
                        {t('Copy name')}
                      </button>
                      <button className="w-full text-left text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded" onClick={() => void handleDelete(skill.path)}>
                        <span className="inline-flex items-center gap-1"><Trash2 size={12} />{t('Delete')}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
