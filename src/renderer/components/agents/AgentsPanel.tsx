/**
 * AgentsPanel - Collapsible panel for browsing and inserting agents
 */

import { useState, useEffect, useMemo } from 'react'
import { Bot, Search, ChevronDown, MoreHorizontal, Copy, Plus, Power, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAgentsStore, type AgentDefinition } from '../../stores/agents.store'
import { useSpaceStore } from '../../stores/space.store'

interface AgentsPanelProps {
  workDir?: string
  onSelectAgent?: (agent: AgentDefinition) => void
  onInsertAgent?: (agentName: string) => void
  onCreateAgent?: () => void
  preferInsertOnClick?: boolean
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

export function AgentsPanel({
  workDir,
  onSelectAgent,
  onInsertAgent,
  onCreateAgent,
  preferInsertOnClick = false
}: AgentsPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [openMenuAgent, setOpenMenuAgent] = useState<string | null>(null)

  const { agents, loadedWorkDir, isLoading, loadAgents, copyToSpace, deleteAgent } = useAgentsStore()
  const { currentSpace, updateSpacePreferences } = useSpaceStore()
  const enabledAgents = currentSpace?.preferences?.agents?.enabled || []
  const showOnlyEnabled = currentSpace?.preferences?.agents?.showOnlyEnabled ?? false

  useEffect(() => {
    if (isExpanded && (agents.length === 0 || loadedWorkDir !== (workDir ?? null))) {
      loadAgents(workDir)
    }
  }, [isExpanded, workDir, agents.length, loadedWorkDir, loadAgents])

  const isEnabled = (agentName: string) => enabledAgents.includes(agentName)

  const filteredAgents = useMemo(() => {
    const base = showOnlyEnabled
      ? agents.filter(agent => isEnabled(agent.name))
      : agents
    if (!localSearchQuery.trim()) return base
    const query = localSearchQuery.toLowerCase()
    return base.filter(agent =>
      agent.name.toLowerCase().includes(query) ||
      agent.description?.toLowerCase().includes(query)
    )
  }, [agents, localSearchQuery, showOnlyEnabled, enabledAgents])

  const groupedAgents = useMemo(() => {
    const groups: Record<AgentDefinition['source'], AgentDefinition[]> = {
      space: [],
      global: [],
      app: [],
      plugin: []
    }
    filteredAgents.forEach(agent => {
      const bucket = groups[agent.source]
      if (bucket) {
        bucket.push(agent)
      }
    })
    return groups
  }, [filteredAgents])

  const handleClose = () => {
    setIsAnimatingOut(true)
    setTimeout(() => {
      setIsExpanded(false)
      setIsAnimatingOut(false)
    }, 200)
  }

  const handleToggle = () => {
    if (isExpanded) {
      handleClose()
    } else {
      setIsExpanded(true)
    }
  }

  useEffect(() => {
    if (!isExpanded) {
      setOpenMenuAgent(null)
    }
  }, [isExpanded])

  const handleAgentClick = (agent: AgentDefinition) => {
    if (preferInsertOnClick && onInsertAgent) {
      onInsertAgent(agent.name)
      setOpenMenuAgent(null)
      handleClose()
      return
    }

    if (onSelectAgent) {
      onSelectAgent(agent)
    }
  }

  const handleInsertAgent = (agentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onInsertAgent) {
      onInsertAgent(agentName)
      setOpenMenuAgent(null)
      handleClose()
    }
  }

  const handleToggleMenu = (agentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenMenuAgent(prev => prev === agentName ? null : agentName)
  }

  const handleToggleEnabled = async (agentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentSpace) return
    const newEnabled = isEnabled(agentName)
      ? enabledAgents.filter(a => a !== agentName)
      : [...enabledAgents, agentName]
    await updateSpacePreferences(currentSpace.id, {
      agents: { enabled: newEnabled }
    })
  }

  const handleToggleShowOnlyEnabled = async () => {
    if (!currentSpace) return
    await updateSpacePreferences(currentSpace.id, {
      agents: { showOnlyEnabled: !showOnlyEnabled }
    })
  }

  const handleCopyToSpace = async (agentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (workDir) {
      await copyToSpace(agentName, workDir)
    }
    setOpenMenuAgent(null)
  }

  const handleCopyAgent = async (agentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(`@${agentName}`)
    } catch (error) {
      console.warn('Failed to copy agent name:', error)
    }
    setOpenMenuAgent(null)
  }

  const handleDeleteAgent = async (agent: AgentDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (agent.source === 'space') {
      await deleteAgent(agent.path)
    }
    setOpenMenuAgent(null)
  }

  const handleViewDetails = (agent: AgentDefinition, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSelectAgent) {
      onSelectAgent(agent)
    }
    setOpenMenuAgent(null)
  }

  const renderAgentItem = (agent: AgentDefinition, index: number) => {
    const isMenuOpen = openMenuAgent === agent.name
    const canCopyToSpace = agent.source !== 'space' && workDir
    const canDelete = agent.source === 'space'
    return (
      <div
        key={agent.path}
        onClick={() => handleAgentClick(agent)}
        className="w-full px-3 py-2 text-left rounded-md transition-all duration-150
          hover:bg-muted/40 group relative cursor-pointer"
        style={{
          animation: !isAnimatingOut
            ? `fade-in 0.2s ease-out ${index * 30}ms forwards`
            : undefined
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => handleToggleEnabled(agent.name, e)}
                className={`flex-shrink-0 transition-colors ${
                  isEnabled(agent.name) ? 'text-green-500' : 'text-muted-foreground/40 hover:text-green-500/60'
                }`}
                title={isEnabled(agent.name) ? t('Disable agent') : t('Enable agent')}
              >
                <Power size={12} />
              </button>
              <span className="text-xs font-mono text-foreground truncate">
                @{agent.name}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[agent.source]}`}>
                {SOURCE_LABELS[agent.source]}
              </span>
            </div>
            {agent.description && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                {agent.description}
              </p>
            )}
          </div>

          {onInsertAgent && (
            <div
              className={`flex items-center gap-1.5 transition-all ${
                isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <button
                onClick={(e) => handleInsertAgent(agent.name, e)}
                className="px-2 py-1 text-[10px] font-medium rounded-md
                  bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title={t('Insert to input')}
              >
                {t('Insert')}
              </button>

              <div className="relative">
                <button
                  onClick={(e) => handleToggleMenu(agent.name, e)}
                  className="p-1.5 hover:bg-muted/60 text-muted-foreground hover:text-foreground rounded transition-colors"
                  title={t('More')}
                >
                  <MoreHorizontal size={14} />
                </button>

                {isMenuOpen && (
                  <div
                    className="absolute right-0 top-6 z-10 min-w-[140px] rounded-md
                      bg-popover border border-border/60 shadow-lg overflow-hidden"
                  >
                    {onSelectAgent && (
                      <button
                        onClick={(e) => handleViewDetails(agent, e)}
                        className="w-full px-3 py-2 text-left text-xs text-foreground
                          hover:bg-muted/60 flex items-center gap-2"
                      >
                        <Bot size={12} />
                        {t('View details')}
                      </button>
                    )}
                    {canCopyToSpace && (
                      <button
                        onClick={(e) => handleCopyToSpace(agent.name, e)}
                        className="w-full px-3 py-2 text-left text-xs text-foreground
                          hover:bg-muted/60 flex items-center gap-2"
                      >
                        <Copy size={12} />
                        {t('Copy to space')}
                      </button>
                    )}
                    <button
                      onClick={(e) => handleCopyAgent(agent.name, e)}
                      className="w-full px-3 py-2 text-left text-xs text-foreground
                        hover:bg-muted/60 flex items-center gap-2"
                    >
                      <Copy size={12} />
                      {t('Copy @name')}
                    </button>
                    {canDelete && (
                      <button
                        onClick={(e) => handleDeleteAgent(agent, e)}
                        className="w-full px-3 py-2 text-left text-xs text-destructive
                          hover:bg-destructive/10 flex items-center gap-2"
                      >
                        <Trash2 size={12} />
                        {t('Delete agent')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderAgentGroup = (source: AgentDefinition['source'], agentsList: AgentDefinition[]) => {
    if (agentsList.length === 0) return null

    return (
      <div key={source} className="mb-2">
        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {SOURCE_LABELS[source]} ({agentsList.length})
        </div>
        {agentsList.map((agent, index) => renderAgentItem(agent, index))}
      </div>
    )
  }

  return (
    <div className="w-full">
      <button
        onClick={handleToggle}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-200
          ${isExpanded
            ? 'bg-muted/60 text-foreground border border-border/60'
            : 'hover:bg-muted/50 text-muted-foreground'
          }
        `}
        title={t('Agents')}
      >
        <span className="flex items-center gap-2">
          <Bot size={16} className={isExpanded ? 'text-primary' : ''} />
          <span className="text-sm font-semibold">{t('Agents')}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {agents.length}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isExpanded && (
        <div
          className={`
            mt-2 w-full
            bg-card/90 backdrop-blur-xl rounded-xl border border-border/60
            shadow-sm overflow-hidden
            ${isAnimatingOut ? 'animate-fade-out' : 'animate-fade-in'}
          `}
          style={{ animationDuration: '0.2s' }}
        >
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-foreground">{t('Agents')}</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {t('{{count}} agents available', { count: agents.length })}
            </p>
          </div>
          {workDir && onCreateAgent && (
            <button
              onClick={onCreateAgent}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium
                bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
            >
              <Plus size={14} />
              {t('New agent')}
            </button>
          )}
        </div>

        <div className="px-3 py-2 border-b border-border/30">
          <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                placeholder={t('Search agents...')}
                className="w-full pl-9 pr-3 py-2 text-xs bg-input border border-border/40
                  rounded-md focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={handleToggleShowOnlyEnabled}
              className={`px-2 py-0.5 text-[10px] rounded ${
                showOnlyEnabled
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {showOnlyEnabled ? t('Enabled only') : t('All')}
            </button>
            <p className="text-[10px] text-muted-foreground/60">
              {t('Click an agent to insert @name')}
            </p>
          </div>
        </div>

          <div className="max-h-[320px] overflow-auto px-1 py-1">
            {isLoading ? (
              <div className="px-4 py-6 text-center">
                <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">{t('Loading agents...')}</p>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 flex items-center justify-center">
                  <Bot size={24} className="text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {localSearchQuery ? t('No agents found') : t('No agents available')}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {localSearchQuery
                    ? t('Try a different search term')
                    : t('Add .md files in ~/.halo/agents or .claude/agents')}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {renderAgentGroup('space', groupedAgents.space)}
                {renderAgentGroup('global', groupedAgents.global)}
                {renderAgentGroup('plugin', groupedAgents.plugin)}
                {renderAgentGroup('app', groupedAgents.app)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
