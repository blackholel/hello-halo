import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronDown, MoreHorizontal, Plus, Search, SquarePen, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAgentsStore, type AgentDefinition } from '../../stores/agents.store'

interface AgentsPanelProps {
  workDir?: string
  onSelectAgent?: (agent: AgentDefinition) => void
  onInsertAgent?: (agentName: string) => void
  onCreateAgent?: () => void
  onOpenTemplateLibrary?: () => void
  preferInsertOnClick?: boolean
}

function getAgentDisplayName(agent: AgentDefinition): string {
  const base = agent.displayName || agent.name
  return agent.namespace ? `${agent.namespace}:${base}` : base
}

export function AgentsPanel({
  workDir,
  onSelectAgent,
  onInsertAgent,
  onCreateAgent,
  onOpenTemplateLibrary,
  preferInsertOnClick = false
}: AgentsPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)

  const { agents, loadedWorkDir, isLoading, loadAgents, deleteAgent } = useAgentsStore()

  useEffect(() => {
    if (!expanded) return
    if (agents.length === 0 || loadedWorkDir !== (workDir ?? null)) {
      void loadAgents(workDir)
    }
  }, [expanded, agents.length, loadedWorkDir, loadAgents, workDir])

  const visibleAgents = useMemo(() => {
    const spaceAgents = agents.filter(agent => agent.source === 'space')
    const q = query.trim().toLowerCase()
    if (!q) return spaceAgents

    return spaceAgents.filter(agent => (
      agent.name.toLowerCase().includes(q) ||
      agent.displayName?.toLowerCase().includes(q) ||
      agent.description?.toLowerCase().includes(q)
    ))
  }, [agents, query])

  return (
    <div className="rounded-lg border border-border/40 bg-card/20">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="inline-flex items-center gap-1"><Bot size={12} />{t('Agents')}</span>
        <ChevronDown size={14} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-md hover:bg-secondary/70" title={t('Create agent')} onClick={() => onCreateAgent?.()}>
              <SquarePen size={14} />
            </button>
            <button className="p-1.5 rounded-md hover:bg-secondary/70" title={t('Template Library')} onClick={onOpenTemplateLibrary}>
              <Plus size={14} />
            </button>
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search agents...')}
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-border/40"
            />
          </div>

          <div className="max-h-56 overflow-auto space-y-1">
            {isLoading ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">{t('Loading...')}</div>
            ) : visibleAgents.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">
                {t('Agent can suggest creating Agents in chat. You can also click ➕ to import from Template Library.')}
              </div>
            ) : (
              visibleAgents.map((agent) => (
                <div
                  key={agent.path}
                  className="relative rounded-md px-2 py-1.5 hover:bg-secondary/50 group"
                  onClick={() => {
                    if (preferInsertOnClick && onInsertAgent) {
                      onInsertAgent(agent.name)
                      return
                    }
                    onSelectAgent?.(agent)
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">@{getAgentDisplayName(agent)}</div>
                      {agent.description && <div className="text-[11px] text-muted-foreground truncate">{agent.description}</div>}
                    </div>
                    <button
                      className="p-1 rounded hover:bg-secondary opacity-0 group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuPath(prev => prev === agent.path ? null : agent.path)
                      }}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>

                  {menuPath === agent.path && (
                    <div className="absolute right-1 top-8 z-20 rounded-md border border-border bg-popover shadow-lg p-1 min-w-[120px]">
                      <button className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded" onClick={() => onSelectAgent?.(agent)}>{t('View')}</button>
                      {onInsertAgent && (
                        <button className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded" onClick={() => onInsertAgent(agent.name)}>{t('Insert')}</button>
                      )}
                      <button
                        className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded"
                        onClick={() => {
                          void navigator.clipboard.writeText(agent.name)
                          setMenuPath(null)
                        }}
                      >
                        {t('Copy name')}
                      </button>
                      <button
                        className="w-full text-left text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded"
                        onClick={() => void deleteAgent(agent.path)}
                      >
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
