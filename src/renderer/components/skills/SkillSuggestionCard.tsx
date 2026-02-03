/**
 * SkillSuggestionCard - Card for AI-suggested skill creation
 * Renders when AI outputs a skill_suggestion JSON block
 * Allows user to preview and create the suggested skill
 */

import { useState } from 'react'
import { Lightbulb, Eye, Check, X, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore } from '../../stores/skills.store'

export interface SkillSuggestion {
  type: 'skill_suggestion'
  name: string
  description: string
  content: string
}

interface SkillSuggestionCardProps {
  suggestion: SkillSuggestion
  workDir: string
  onCreated?: () => void
  onDismissed?: () => void
}

export function SkillSuggestionCard({
  suggestion,
  workDir,
  onCreated,
  onDismissed
}: SkillSuggestionCardProps) {
  const { t } = useTranslation()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreated, setIsCreated] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Skills store
  const { createSkill } = useSkillsStore()

  // Handle create
  const handleCreate = async () => {
    setIsCreating(true)
    setError(null)

    try {
      const newSkill = await createSkill(workDir, suggestion.name, suggestion.content)
      if (newSkill) {
        setIsCreated(true)
        if (onCreated) {
          onCreated()
        }
      } else {
        setError(t('Failed to create skill'))
      }
    } catch (err) {
      console.error('Failed to create skill:', err)
      setError(t('An error occurred while creating the skill'))
    } finally {
      setIsCreating(false)
    }
  }

  // Handle dismiss
  const handleDismiss = () => {
    setIsDismissed(true)
    if (onDismissed) {
      onDismissed()
    }
  }

  // Don't render if dismissed
  if (isDismissed) {
    return null
  }

  // Render success state
  if (isCreated) {
    return (
      <div className="my-3 p-4 rounded-xl border border-green-500/30 bg-green-500/5 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Check size={20} className="text-green-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('Skill created successfully!')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('You can now use /{name} in your conversations', { name: suggestion.name })}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={20} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {t('Suggested Skill')}
            </p>
            <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
              /{suggestion.name}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {suggestion.description}
          </p>
        </div>
      </div>

      {/* Preview section */}
      {isPreviewOpen && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-muted/50 rounded-lg border border-border/30 max-h-[300px] overflow-auto">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {suggestion.content}
            </pre>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/30 bg-muted/20">
        <button
          onClick={() => setIsPreviewOpen(!isPreviewOpen)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm
            text-muted-foreground hover:text-foreground hover:bg-muted
            rounded-lg transition-colors"
        >
          <Eye size={14} />
          <span>{isPreviewOpen ? t('Hide Preview') : t('Preview')}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDismiss}
            className="flex items-center gap-2 px-3 py-1.5 text-sm
              text-muted-foreground hover:text-foreground hover:bg-muted
              rounded-lg transition-colors"
          >
            <X size={14} />
            <span>{t('Dismiss')}</span>
          </button>

          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-1.5 text-sm
              bg-primary text-primary-foreground hover:bg-primary/90
              rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Zap size={14} />
            )}
            <span>{t('Create Skill')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Parse a JSON code block to check if it's a skill suggestion
 * Returns the parsed SkillSuggestion or null if not valid
 */
export function parseSkillSuggestion(jsonString: string): SkillSuggestion | null {
  try {
    const parsed = JSON.parse(jsonString)
    if (
      parsed &&
      parsed.type === 'skill_suggestion' &&
      typeof parsed.name === 'string' &&
      typeof parsed.description === 'string' &&
      typeof parsed.content === 'string'
    ) {
      return parsed as SkillSuggestion
    }
  } catch {
    // Not valid JSON or not a skill suggestion
  }
  return null
}
