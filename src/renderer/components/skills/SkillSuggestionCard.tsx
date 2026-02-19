import { useState } from 'react'
import { Check, Eye, Lightbulb, X, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore } from '../../stores/skills.store'
import { useAgentsStore } from '../../stores/agents.store'
import { useCommandsStore } from '../../stores/commands.store'

export type ResourceSuggestionType = 'skill_suggestion' | 'agent_suggestion' | 'command_suggestion'

export interface ResourceSuggestion {
  type: ResourceSuggestionType
  name: string
  description: string
  content: string
}

interface ResourceSuggestionCardProps {
  suggestion: ResourceSuggestion
  workDir: string
  onCreated?: () => void
  onDismissed?: () => void
}

function getLabel(type: ResourceSuggestionType): { title: string; createLabel: string; prefix: string } {
  if (type === 'agent_suggestion') {
    return { title: 'Suggested Agent', createLabel: 'Create Agent', prefix: '@' }
  }
  if (type === 'command_suggestion') {
    return { title: 'Suggested Command', createLabel: 'Create Command', prefix: '/' }
  }
  return { title: 'Suggested Skill', createLabel: 'Create Skill', prefix: '/' }
}

export function ResourceSuggestionCard({
  suggestion,
  workDir,
  onCreated,
  onDismissed
}: ResourceSuggestionCardProps) {
  const { t } = useTranslation()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreated, setIsCreated] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createSkill = useSkillsStore(state => state.createSkill)
  const createAgent = useAgentsStore(state => state.createAgent)
  const createCommand = useCommandsStore(state => state.createCommand)

  const { title, createLabel, prefix } = getLabel(suggestion.type)

  const handleCreate = async (): Promise<void> => {
    setIsCreating(true)
    setError(null)

    try {
      const created = suggestion.type === 'agent_suggestion'
        ? await createAgent(workDir, suggestion.name, suggestion.content)
        : suggestion.type === 'command_suggestion'
          ? await createCommand(workDir, suggestion.name, suggestion.content)
          : await createSkill(workDir, suggestion.name, suggestion.content)

      if (created) {
        setIsCreated(true)
        onCreated?.()
      } else {
        setError(t('Failed to create resource'))
      }
    } catch (err) {
      console.error('Failed to create suggested resource:', err)
      setError(t('An error occurred while creating the resource'))
    } finally {
      setIsCreating(false)
    }
  }

  if (isDismissed) return null

  if (isCreated) {
    return (
      <div className="my-3 p-4 rounded-xl border border-green-500/30 bg-green-500/5 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Check size={20} className="text-green-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t('Resource created successfully!')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('You can now use {name}', { name: `${prefix}${suggestion.name}` })}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden animate-fade-in">
      <div className="flex items-start gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={20} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{t(title)}</p>
            <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">{prefix}{suggestion.name}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{suggestion.description}</p>
        </div>
      </div>

      {isPreviewOpen && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-muted/50 rounded-lg border border-border/30 max-h-[300px] overflow-auto">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{suggestion.content}</pre>
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-border/30 bg-muted/20">
        <button
          onClick={() => setIsPreviewOpen(!isPreviewOpen)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <Eye size={14} />
          <span>{isPreviewOpen ? t('Hide Preview') : t('Preview')}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsDismissed(true)
              onDismissed?.()
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <X size={14} />
            <span>{t('Dismiss')}</span>
          </button>

          <button
            onClick={() => void handleCreate()}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Zap size={14} />
            )}
            <span>{t(createLabel)}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function tryParseSuggestion(jsonString: string): ResourceSuggestion | null {
  try {
    const parsed = JSON.parse(jsonString)
    if (
      parsed &&
      (parsed.type === 'skill_suggestion' || parsed.type === 'agent_suggestion' || parsed.type === 'command_suggestion') &&
      typeof parsed.name === 'string' &&
      typeof parsed.description === 'string' &&
      typeof parsed.content === 'string'
    ) {
      return parsed as ResourceSuggestion
    }
  } catch {
    // ignore parse errors
  }
  return null
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

export function parseResourceSuggestion(input: string): ResourceSuggestion | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const direct = tryParseSuggestion(trimmed)
  if (direct) return direct

  const jsonc = tryParseSuggestion(stripJsonComments(trimmed))
  if (jsonc) return jsonc

  const fenceMatches = Array.from(trimmed.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)```/gi))
  for (const match of fenceMatches) {
    const body = match[1]?.trim()
    if (!body) continue
    const parsed = tryParseSuggestion(body) || tryParseSuggestion(stripJsonComments(body))
    if (parsed) return parsed
  }

  return null
}

// Backward-compatible exports
export type SkillSuggestion = ResourceSuggestion
export const SkillSuggestionCard = ResourceSuggestionCard
export const parseSkillSuggestion = parseResourceSuggestion
