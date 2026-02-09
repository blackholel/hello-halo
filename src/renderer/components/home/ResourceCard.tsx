import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Copy, Terminal, X, Zap } from 'lucide-react'
import { commandKey } from '../../../shared/command-utils'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { useSpaceStore } from '../../stores/space.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import type { AgentDefinition } from '../../stores/agents.store'
import type { CommandDefinition } from '../../stores/commands.store'
import type { SkillDefinition } from '../../stores/skills.store'
import { buildDirective } from '../../utils/directive-helpers'
import { getSourceColor, getSourceLabel, type AnySource } from './source-labels'

type ResourceType = 'skill' | 'agent' | 'command'

type AnyResource = SkillDefinition | AgentDefinition | CommandDefinition

interface ResourceCardProps {
  resource: AnyResource
  type: ResourceType
  index: number
  onAddedToToolkit?: () => void
}

interface ResourceMeta {
  title: string
  subtitle?: string
  path: string
  source: AnySource
  namespace?: string
  icon: typeof Zap
  iconClassName: string
  details?: string[]
}

function mapResourceMeta(resource: AnyResource, type: ResourceType): ResourceMeta {
  if (type === 'skill') {
    const skill = resource as SkillDefinition
    return {
      title: skill.namespace ? `${skill.namespace}:${skill.name}` : skill.name,
      subtitle: skill.description,
      path: skill.path,
      source: skill.source,
      namespace: skill.namespace,
      icon: Zap,
      iconClassName: 'text-yellow-500 bg-yellow-500/10',
      details: skill.triggers
    }
  }

  if (type === 'agent') {
    const agent = resource as AgentDefinition
    return {
      title: agent.namespace ? `${agent.namespace}:${agent.name}` : agent.name,
      subtitle: agent.description,
      path: agent.path,
      source: agent.source,
      namespace: agent.namespace,
      icon: Bot,
      iconClassName: 'text-cyan-500 bg-cyan-500/10'
    }
  }

  const command = resource as CommandDefinition
  return {
    title: `/${commandKey(command)}`,
    subtitle: command.description,
    path: command.path,
    source: command.source,
    namespace: command.namespace,
    icon: Terminal,
    iconClassName: 'text-violet-500 bg-violet-500/10'
  }
}

/** Dispatch the correct API call based on resource type. */
function fetchResourceContent(resource: AnyResource, type: ResourceType) {
  if (type === 'skill') {
    const skill = resource as SkillDefinition
    const key = skill.namespace ? `${skill.namespace}:${skill.name}` : skill.name
    return api.getSkillContent(key)
  }
  if (type === 'agent') {
    const agent = resource as AgentDefinition
    const key = agent.namespace ? `${agent.namespace}:${agent.name}` : agent.name
    return api.getAgentContent(key)
  }
  return api.getCommandContent(commandKey(resource as CommandDefinition))
}

function toDirective(resource: AnyResource, type: ResourceType) {
  return buildDirective(type, resource as { name: string; namespace?: string; source?: string })
}

export function ResourceCard({ resource, type, index, onAddedToToolkit }: ResourceCardProps): JSX.Element {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<string>('')
  const [contentError, setContentError] = useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isUpdatingToolkit, setIsUpdatingToolkit] = useState(false)

  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const { getToolkit, isInToolkit, addResource, removeResource, loadToolkit, isToolkitLoaded } = useToolkitStore()

  const meta = useMemo(() => mapResourceMeta(resource, type), [resource, type])
  const directive = useMemo(() => toDirective(resource, type), [resource, type])
  const toolkitLoaded = !!currentSpace && isToolkitLoaded(currentSpace.id)
  const toolkit = getToolkit(currentSpace?.id)
  const hasToolkit = toolkitLoaded && toolkit !== null
  const inToolkit = hasToolkit && isInToolkit(currentSpace?.id, directive)
  const canManageToolkit = !!currentSpace && !currentSpace.isTemp

  let toolkitButtonLabel: string
  if (isUpdatingToolkit) {
    toolkitButtonLabel = t('Loading...')
  } else if (!hasToolkit) {
    toolkitButtonLabel = t('Activate in space')
  } else if (inToolkit) {
    toolkitButtonLabel = t('Remove from toolkit')
  } else {
    toolkitButtonLabel = t('Add to toolkit')
  }

  const closeDialog = useCallback(() => setIsOpen(false), [])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog])

  const copyPath = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(meta.path)
    } catch {
      // Clipboard API may fail in some environments; silently ignore
    }
  }

  const handleToolkitAction = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!currentSpace) return
    try {
      setIsUpdatingToolkit(true)
      if (inToolkit) {
        await removeResource(currentSpace.id, directive)
      } else {
        await addResource(currentSpace.id, directive)
      }
      onAddedToToolkit?.()
    } finally {
      setIsUpdatingToolkit(false)
    }
  }

  useEffect(() => {
    if (currentSpace && !currentSpace.isTemp && !toolkitLoaded) {
      void loadToolkit(currentSpace.id)
    }
  }, [currentSpace, toolkitLoaded, loadToolkit])

  useEffect(() => {
    if (!isOpen) return
    // Skip reload if content is already cached
    if (content && !contentError) return

    let isCancelled = false

    const loadContent = async (): Promise<void> => {
      try {
        setIsLoadingContent(true)
        setContentError(null)

        const response = await fetchResourceContent(resource, type)
        if (isCancelled) return

        if (!response.success || !response.data) {
          setContentError(response.error || t('Failed to load details'))
          setContent('')
          return
        }

        // Skill wraps content in an object; agents and commands return raw strings
        const text = type === 'skill'
          ? (response.data as { content?: string }).content || ''
          : response.data as string
        setContent(text)
      } catch {
        if (!isCancelled) {
          setContentError(t('Failed to load details'))
          setContent('')
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingContent(false)
        }
      }
    }

    loadContent()

    return () => {
      isCancelled = true
    }
  }, [isOpen, resource, t, type])

  const Icon = meta.icon

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="space-card p-4 text-left w-full stagger-item"
        style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.iconClassName}`}>
              <Icon className="w-[18px] h-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{meta.title}</div>
              <p
                className="text-xs text-muted-foreground mt-1 leading-relaxed overflow-hidden"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
              >
                {meta.subtitle || t('No description')}
              </p>
            </div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-md flex-shrink-0 ${getSourceColor(meta.source)}`}>
            {getSourceLabel(meta.source, t)}
          </span>
        </div>
        {canManageToolkit && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleToolkitAction}
              disabled={isUpdatingToolkit}
              className="px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {toolkitButtonLabel}
            </button>
          </div>
        )}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 glass-overlay flex items-center justify-center z-50 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={meta.title}
          onClick={closeDialog}
        >
          <div
            className="glass-dialog p-6 w-full max-w-2xl mx-4 animate-scale-in"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold truncate">{meta.title}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md ${getSourceColor(meta.source)}`}>
                    {getSourceLabel(meta.source, t)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{meta.subtitle || t('No description')}</p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                title={t('Close')}
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="glass-subtle rounded-xl p-3">
                <div className="text-muted-foreground mb-1">{t('Path')}</div>
                <div className="font-mono break-all leading-relaxed">{meta.path}</div>
                <button
                  type="button"
                  onClick={copyPath}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {t('Copy path')}
                </button>
              </div>

              {meta.namespace && (
                <div className="glass-subtle rounded-xl p-3">
                  <div className="text-muted-foreground mb-1">{t('Namespace')}</div>
                  <div className="font-medium">{meta.namespace}</div>
                </div>
              )}

              {meta.details && meta.details.length > 0 && (
                <div className="glass-subtle rounded-xl p-3">
                  <div className="text-muted-foreground mb-1">{t('Triggers')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.details.map((item) => (
                      <span key={item} className="px-2 py-0.5 rounded-md bg-secondary text-foreground/90">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-subtle rounded-xl p-3">
                <div className="text-muted-foreground mb-1">{t('Content')}</div>
                {isLoadingContent ? (
                  <div className="text-muted-foreground">{t('Loading...')}</div>
                ) : contentError ? (
                  <div className="text-destructive/80">{contentError}</div>
                ) : content ? (
                  <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-64 overflow-auto">
                    {content}
                  </pre>
                ) : (
                  <div className="text-muted-foreground">{t('No content')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
