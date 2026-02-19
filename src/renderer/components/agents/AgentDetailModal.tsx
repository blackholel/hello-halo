/**
 * AgentDetailModal - Modal for viewing agent details
 */

import { useEffect, useState } from 'react'
import { X, Edit2, Copy, Trash2, Bot } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAgentsStore, type AgentDefinition, type AgentContent } from '../../stores/agents.store'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'

interface AgentDetailModalProps {
  agent: AgentDefinition
  workDir?: string
  onClose: () => void
  onEdit?: (agent: AgentDefinition) => void
}

const SOURCE_LABELS: Record<AgentDefinition['source'], string> = {
  app: 'App',
  global: 'Global',
  space: 'Space',
  plugin: 'Plugin'
}

const SOURCE_COLORS: Record<AgentDefinition['source'], string> = {
  app: 'bg-blue-500/10 text-blue-500',
  global: 'bg-purple-500/10 text-purple-500',
  space: 'bg-green-500/10 text-green-500',
  plugin: 'bg-orange-500/10 text-orange-500'
}

export function AgentDetailModal({ agent, workDir, onClose, onEdit }: AgentDetailModalProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState<AgentContent | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const { loadAgentContent, deleteAgent, copyToSpace } = useAgentsStore()

  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true)
      const result = await loadAgentContent(agent.name, workDir)
      setContent(result)
      setIsLoading(false)
    }
    loadContent()
  }, [agent.name, workDir, loadAgentContent])

  const handleCopyToSpace = async () => {
    if (workDir && agent.source !== 'space') {
      const result = await copyToSpace(agent, workDir)
      if (result.status === 'conflict') {
        const overwrite = window.confirm(t('Already added. Overwrite existing resource?'))
        if (overwrite) {
          await copyToSpace(agent, workDir, { overwrite: true })
        }
      }
      onClose()
    }
  }

  const handleDelete = async () => {
    if (agent.source === 'space') {
      await deleteAgent(agent.path)
      onClose()
    }
  }

  const handleEdit = () => {
    if (onEdit) {
      onEdit(agent)
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const canEdit = agent.source === 'space'
  const canDelete = agent.source === 'space'
  const canCopyToSpace = agent.source !== 'space' && workDir

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 glass-overlay animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-2xl max-h-[80vh] mx-4 glass-dialog
        border border-border/50 shadow-2xl overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot size={20} className="text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">@{agent.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded ${SOURCE_COLORS[agent.source]}`}>
                  {SOURCE_LABELS[agent.source]}
                </span>
              </div>
              {agent.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{agent.description}</p>
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
              <p className="text-muted-foreground">{t('Failed to load agent content')}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
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
