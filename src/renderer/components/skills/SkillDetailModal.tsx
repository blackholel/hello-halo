/**
 * SkillDetailModal - Modal for viewing skill details
 * Shows SKILL.md content with markdown rendering
 */

import { useState, useEffect } from 'react'
import { X, Edit2, Copy, Trash2, Star, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition, type SkillContent } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'

interface SkillDetailModalProps {
  skill: SkillDefinition
  workDir?: string
  onClose: () => void
  onEdit?: (skill: SkillDefinition) => void
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

export function SkillDetailModal({ skill, workDir, onClose, onEdit }: SkillDetailModalProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState<SkillContent | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Skills store
  const { loadSkillContent, deleteSkill, copyToSpace } = useSkillsStore()

  // Space store for favorites
  const { currentSpace, updateSpacePreferences } = useSpaceStore()
  const favorites = currentSpace?.preferences?.skills?.favorites || []
  const isFavorite = favorites.includes(skill.name)

  // Load skill content
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true)
      const result = await loadSkillContent(skill.name, workDir)
      setContent(result)
      setIsLoading(false)
    }
    loadContent()
  }, [skill.name, workDir, loadSkillContent])

  // Toggle favorite
  const toggleFavorite = async () => {
    const newFavorites = isFavorite
      ? favorites.filter(f => f !== skill.name)
      : [...favorites, skill.name]

    if (currentSpace) {
      await updateSpacePreferences(currentSpace.id, {
        skills: { favorites: newFavorites }
      })
    }
  }

  // Handle copy to space
  const handleCopyToSpace = async () => {
    if (workDir && skill.source !== 'space') {
      await copyToSpace(skill.name, workDir)
      onClose()
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (skill.source === 'space') {
      await deleteSkill(skill.path)
      onClose()
    }
  }

  // Handle edit
  const handleEdit = () => {
    if (onEdit) {
      onEdit(skill)
    }
  }

  // Handle keyboard shortcut
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const canEdit = skill.source === 'space'
  const canDelete = skill.source === 'space'
  const canCopyToSpace = skill.source !== 'space' && workDir

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 glass-overlay animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] mx-4 glass-dialog overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap size={20} className="text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">/{skill.name}</h2>
        <span className={`text-xs px-2 py-0.5 rounded ${SOURCE_COLORS[skill.source]}`}>
                  {SOURCE_LABELS[skill.source]}
                </span>
              </div>
              {skill.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{skill.description}</p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[50vh] overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={content.content} />
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">{t('Failed to load skill content')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
            {/* Favorite button */}
            <button
              onClick={toggleFavorite}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                isFavorite
                  ? 'bg-yellow-500/10 text-yellow-500'
                  : 'hover:bg-muted text-muted-foreground'
              }`}
            >
              <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
              <span className="text-sm">{isFavorite ? t('Favorited') : t('Favorite')}</span>
            </button>

            {/* Copy to space button */}
            {canCopyToSpace && (
              <button
                onClick={handleCopyToSpace}
                className="flex items-center gap-2 px-3 py-2 rounded-lg
                  hover:bg-muted text-muted-foreground transition-colors"
              >
                <Copy size={16} />
                <span className="text-sm">{t('Copy to Space')}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Delete button */}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-2 rounded-lg
                  hover:bg-destructive/10 text-destructive transition-colors"
              >
                <Trash2 size={16} />
                <span className="text-sm">{t('Delete')}</span>
              </button>
            )}

            {/* Edit button */}
            {canEdit && (
              <button
                onClick={handleEdit}
                className="flex items-center gap-2 px-4 py-2 rounded-lg
                  bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Edit2 size={16} />
                <span className="text-sm">{t('Edit')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
