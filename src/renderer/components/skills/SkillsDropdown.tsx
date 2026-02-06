/**
 * SkillsDropdown - Quick access dropdown for skills in chat input toolbar
 * Shows favorited skills for quick insertion into chat input
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { Zap, Star, ChevronDown } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'

interface SkillsDropdownProps {
  workDir?: string
  onInsertSkill: (skillName: string) => void
  onOpenPanel?: () => void
}

export function SkillsDropdown({ workDir, onInsertSkill, onOpenPanel }: SkillsDropdownProps) {
  const { t } = useTranslation()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  // Skills store
  const { skills, loadedWorkDir, isLoading, loadSkills } = useSkillsStore()

  // Space store for favorites
  const { currentSpace } = useSpaceStore()
  const favorites = currentSpace?.preferences?.skills?.favorites || []
  const enabled = currentSpace?.preferences?.skills?.enabled || []
  const showOnlyEnabled = currentSpace?.preferences?.skills?.showOnlyEnabled ?? false

  const isEnabled = (skillName: string) => enabled.includes(skillName)

  // Load skills when dropdown opens
  useEffect(() => {
    if (isOpen && (skills.length === 0 || loadedWorkDir !== (workDir ?? null))) {
      loadSkills(workDir)
    }
  }, [isOpen, workDir, skills.length, loadedWorkDir, loadSkills])

  // Get favorited skills
  const favoritedSkills = useMemo(() => {
    const base = showOnlyEnabled
      ? skills.filter(skill => isEnabled(skill.name))
      : skills
    return base.filter(skill => favorites.includes(skill.name))
  }, [skills, favorites, showOnlyEnabled, enabled])

  // Get recent skills (non-favorited, limited to 5)
  const recentSkills = useMemo(() => {
    const base = showOnlyEnabled
      ? skills.filter(skill => isEnabled(skill.name))
      : skills
    return base
      .filter(skill => !favorites.includes(skill.name))
      .slice(0, 5)
  }, [skills, favorites, showOnlyEnabled, enabled])

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle keyboard shortcut
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Handle skill click
  const handleSkillClick = (skill: SkillDefinition) => {
    onInsertSkill(skill.name)
    setIsOpen(false)
  }

  // Handle manage click
  const handleManageClick = () => {
    setIsOpen(false)
    if (onOpenPanel) {
      onOpenPanel()
    }
  }

  const hasSkills = favoritedSkills.length > 0 || recentSkills.length > 0

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
          transition-colors duration-200
          ${isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
          }
        `}
        title={t('Skills')}
      >
        <Zap size={15} />
        <span className="text-xs">{t('Skills')}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-popover border border-border
          rounded-xl shadow-lg min-w-[200px] max-w-[280px] z-20 animate-fade-in">
          {isLoading ? (
            <div className="px-3 py-4 text-center">
              <div className="w-5 h-5 mx-auto border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : !hasSkills ? (
            <div className="px-3 py-4 text-center">
              <Zap size={20} className="mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">{t('No skills available')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('Add favorites from Skills panel')}</p>
            </div>
          ) : (
            <>
              {/* Favorited skills */}
              {favoritedSkills.length > 0 && (
                <div className="pb-1">
                  <div className="px-3 py-1 text-[10px] font-medium text-yellow-500/80 uppercase tracking-wider flex items-center gap-1">
                    <Star size={10} fill="currentColor" />
                    {t('Favorites')}
                  </div>
                  {favoritedSkills.map(skill => (
                    <button
                      key={skill.path}
                      onClick={() => handleSkillClick(skill)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-sm
                        text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Zap size={14} className="text-primary flex-shrink-0" />
                      <span className="truncate font-mono">/{skill.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Recent skills */}
              {recentSkills.length > 0 && (
                <div className={favoritedSkills.length > 0 ? 'border-t border-border/30 pt-1' : ''}>
                  <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    {t('Recent')}
                  </div>
                  {recentSkills.map(skill => (
                    <button
                      key={skill.path}
                      onClick={() => handleSkillClick(skill)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-sm
                        text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Zap size={14} className="text-muted-foreground flex-shrink-0" />
                      <span className="truncate font-mono">/{skill.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Manage skills link */}
          {onOpenPanel && (
            <div className="border-t border-border/30 mt-1 pt-1">
              <button
                onClick={handleManageClick}
                className="w-full px-3 py-2 text-xs text-primary hover:bg-primary/5 transition-colors text-center"
              >
                {t('Manage Skills...')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
