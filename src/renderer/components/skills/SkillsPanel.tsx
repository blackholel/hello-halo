import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, MoreHorizontal, Plus, Search, SquarePen, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'

interface SkillsPanelProps {
  workDir?: string
  onSelectSkill?: (skill: SkillDefinition) => void
  onInsertSkill?: (skillName: string) => void
  onCreateSkill?: () => void
  onInsertCreateSkill?: () => void
  preferInsertOnClick?: boolean
}

function getSkillDisplayName(skill: SkillDefinition): string {
  const base = skill.displayName || skill.name
  return skill.namespace ? `${skill.namespace}:${base}` : base
}

export function SkillsPanel({
  workDir,
  onSelectSkill,
  onInsertSkill,
  onCreateSkill,
  onInsertCreateSkill,
  preferInsertOnClick = false
}: SkillsPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)

  const { skills, loadedWorkDir, isLoading, loadSkills, deleteSkill } = useSkillsStore()
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const resolvedWorkDir = useMemo(() => {
    if (workDir && workDir.trim()) return workDir
    return currentSpace?.path
  }, [currentSpace?.path, workDir])

  useEffect(() => {
    if (!expanded) return
    if (skills.length === 0 || loadedWorkDir !== (resolvedWorkDir ?? null)) {
      void loadSkills(resolvedWorkDir)
    }
  }, [expanded, loadSkills, loadedWorkDir, resolvedWorkDir, skills.length])

  const visibleSkills = useMemo(() => {
    const spaceSkills = skills.filter(skill => skill.source === 'space')
    const q = query.trim().toLowerCase()
    return q
      ? spaceSkills.filter(skill => (
        skill.name.toLowerCase().includes(q) ||
        skill.displayName?.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
      ))
      : spaceSkills
  }, [skills, query])

  const handleDelete = async (skillPath: string): Promise<void> => {
    await deleteSkill(skillPath)
    setMenuPath(null)
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
              title={t('Create Skills')}
              onClick={() => onInsertCreateSkill?.()}
            >
              <Plus size={14} />
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
                {t('Agent can suggest creating Skills in chat. Click ➕ to insert Create Skills.')}
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
                      <div className="text-xs font-medium truncate">/{getSkillDisplayName(skill)}</div>
                      {skill.description && (
                        <div className="text-[11px] text-muted-foreground truncate">{skill.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
