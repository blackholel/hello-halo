/**
 * AgentEditorModal - Modal for creating and editing agents
 */

import { useEffect, useRef, useState } from 'react'
import { X, Bot, Save } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAgentsStore, type AgentDefinition } from '../../stores/agents.store'

interface AgentEditorModalProps {
  agent?: AgentDefinition
  workDir: string
  onClose: () => void
  onSaved?: (agent: AgentDefinition) => void
}

const DEFAULT_AGENT_TEMPLATE = `# My Agent

Describe what this agent does.

## When to Use

Explain the best scenarios for this agent.

## How It Works

Provide steps or behavior guidelines.
`

export function AgentEditorModal({ agent, workDir, onClose, onSaved }: AgentEditorModalProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [name, setName] = useState(agent?.name || '')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditMode = !!agent

  const { loadAgentContent, createAgent, updateAgent } = useAgentsStore()

  useEffect(() => {
    if (isEditMode && agent) {
      const loadContent = async () => {
        setIsLoading(true)
        const result = await loadAgentContent(agent.name, workDir)
        if (result) {
          setContent(result.content)
        }
        setIsLoading(false)
      }
      loadContent()
    } else {
      setContent(DEFAULT_AGENT_TEMPLATE)
    }
  }, [isEditMode, agent, workDir, loadAgentContent])

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, name, content])

  const validateName = (name: string): string | null => {
    if (!name.trim()) {
      return t('Agent name is required')
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
      return t('Agent name can only contain lowercase letters, numbers, and hyphens')
    }
    if (name.length > 50) {
      return t('Agent name must be 50 characters or less')
    }
    return null
  }

  const handleSave = async () => {
    if (!isEditMode) {
      const nameError = validateName(name)
      if (nameError) {
        setError(nameError)
        return
      }
    }

    if (!content.trim()) {
      setError(t('Agent content is required'))
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      if (isEditMode && agent) {
        const success = await updateAgent(agent.path, content)
        if (success) {
          onClose()
        } else {
          setError(t('Failed to update agent'))
        }
      } else {
        const newAgent = await createAgent(workDir, name, content)
        if (newAgent) {
          if (onSaved) {
            onSaved(newAgent)
          }
          onClose()
        } else {
          setError(t('Failed to create agent'))
        }
      }
    } catch (err) {
      console.error('Failed to save agent:', err)
      setError(t('An error occurred while saving'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 bg-card rounded-2xl
        border border-border/50 shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('Edit Agent') : t('Create New Agent')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isEditMode
                  ? t('Modify the agent content below')
                  : t('Create a new agent for your workspace')}
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

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('Agent Name')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">@</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder="my-agent-name"
                      className="flex-1 px-3 py-2 bg-input border border-border rounded-lg
                        focus:outline-none focus:border-primary text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('Agent Content')}
                </label>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full min-h-[360px] px-3 py-2 bg-input border border-border rounded-lg
                    focus:outline-none focus:border-primary text-sm font-mono resize-none"
                  placeholder={t('Enter agent content in Markdown format...')}
                />
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/30 flex-shrink-0">
          <div />
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg
              bg-primary text-primary-foreground hover:bg-primary/90 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span className="text-sm">{t('Save')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
