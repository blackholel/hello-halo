/**
 * SkillEditorModal - Modal for creating and editing skills
 * Provides a simple editor for SKILL.md content
 */

import { useState, useEffect, useRef } from 'react'
import { X, Save, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'

interface SkillEditorModalProps {
  skill?: SkillDefinition  // If provided, edit mode; otherwise create mode
  workDir: string
  onClose: () => void
  onSaved?: (skill: SkillDefinition) => void
}

// Default skill template
const DEFAULT_SKILL_TEMPLATE = `---
name: my-skill
description: A brief description of what this skill does
triggers:
  - keyword1
  - keyword2
---

# My Skill

Instructions for Claude when this skill is invoked.

## When to Use

Describe when this skill should be used.

## How It Works

Explain the workflow or steps.
`

export function SkillEditorModal({ skill, workDir, onClose, onSaved }: SkillEditorModalProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [name, setName] = useState(skill?.name || '')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditMode = !!skill

  // Skills store
  const { loadSkillContent, createSkill, updateSkill } = useSkillsStore()

  // Load skill content in edit mode
  useEffect(() => {
    if (isEditMode && skill) {
      const loadContent = async () => {
        setIsLoading(true)
        const result = await loadSkillContent(skill.name, workDir)
        if (result) {
          setContent(result.content)
        }
        setIsLoading(false)
      }
      loadContent()
    } else {
      // Use default template for new skills
      setContent(DEFAULT_SKILL_TEMPLATE)
    }
  }, [isEditMode, skill, workDir, loadSkillContent])

  // Focus textarea when content loads
  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading])

  // Handle keyboard shortcut
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
      // Cmd/Ctrl + S to save
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, name, content])

  // Validate skill name
  const validateName = (name: string): string | null => {
    if (!name.trim()) {
      return t('Skill name is required')
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
      return t('Skill name can only contain lowercase letters, numbers, and hyphens')
    }
    if (name.length > 50) {
      return t('Skill name must be 50 characters or less')
    }
    return null
  }

  // Handle save
  const handleSave = async () => {
    // Validate name (only for new skills)
    if (!isEditMode) {
      const nameError = validateName(name)
      if (nameError) {
        setError(nameError)
        return
      }
    }

    // Validate content
    if (!content.trim()) {
      setError(t('Skill content is required'))
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      if (isEditMode && skill) {
        // Update existing skill
        const success = await updateSkill(skill.path, content)
        if (success) {
          onClose()
        } else {
          setError(t('Failed to update skill'))
        }
      } else {
        // Create new skill
        const newSkill = await createSkill(workDir, name, content)
        if (newSkill) {
          if (onSaved) {
            onSaved(newSkill)
          }
          onClose()
        } else {
          setError(t('Failed to create skill'))
        }
      }
    } catch (err) {
      console.error('Failed to save skill:', err)
      setError(t('An error occurred while saving'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 glass-overlay animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 glass-dialog
        border border-border/50 shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('Edit Skill') : t('Create New Skill')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isEditMode
                  ? t('Modify the skill content below')
                  : t('Create a new skill for your workspace')}
              </p>
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
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Skill name input (only for new skills) */}
              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('Skill Name')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">/</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder="my-skill-name"
                      className="flex-1 px-3 py-2 bg-input border border-border rounded-lg
                        focus:outline-none focus:border-primary text-sm font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('Lowercase letters, numbers, and hyphens only')}
                  </p>
                </div>
              )}

              {/* Content editor */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('SKILL.md Content')}
                </label>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t('Enter skill content in Markdown format...')}
                  className="w-full h-[400px] px-4 py-3 bg-input border border-border rounded-lg
                    focus:outline-none focus:border-primary text-sm font-mono resize-none"
        spellCheck={false}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('Use YAML frontmatter for metadata (name, description, triggers)')}
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border/50 bg-muted/30 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground
              hover:bg-muted rounded-lg transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm
              bg-primary text-primary-foreground hover:bg-primary/90
              rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span>{isEditMode ? t('Save Changes') : t('Create Skill')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
