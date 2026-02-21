import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Puzzle, Search, Terminal, Zap } from 'lucide-react'
import { commandKey } from '../../../shared/command-utils'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { type AgentDefinition, useAgentsStore } from '../../stores/agents.store'
import { type CommandDefinition, useCommandsStore } from '../../stores/commands.store'
import { type SkillDefinition, useSkillsStore } from '../../stores/skills.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { useSpaceStore } from '../../stores/space.store'
import { ResourceCard } from '../resources/ResourceCard'

type FilterTab = 'all' | 'skills' | 'agents' | 'commands'

interface ExtensionItem {
  id: string
  type: 'skill' | 'agent' | 'command'
  resource: SkillDefinition | AgentDefinition | CommandDefinition
  searchable: string
}

interface EmptyStateProps {
  icon: typeof Puzzle
  title: string
  description: string
}

const FILTER_TO_TYPE: Record<FilterTab, ExtensionItem['type'] | null> = {
  all: null,
  skills: 'skill',
  agents: 'agent',
  commands: 'command'
}

function EmptyState({ icon: Icon, title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-secondary/60 flex items-center justify-center">
        <Icon className="w-6 h-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">{description}</p>
    </div>
  )
}

export function ExtensionsView(): JSX.Element {
  const { t } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [query, setQuery] = useState('')
  const isRemote = api.isRemoteMode()
  const hasRequestedGlobalResources = useRef(false)
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const { loadToolkit } = useToolkitStore()

  const {
    skills,
    loadedWorkDir: loadedSkillsWorkDir,
    isLoading: skillsLoading,
    loadSkills
  } = useSkillsStore()

  const {
    agents,
    loadedWorkDir: loadedAgentsWorkDir,
    isLoading: agentsLoading,
    loadAgents
  } = useAgentsStore()

  const {
    commands,
    loadedWorkDir: loadedCommandsWorkDir,
    isLoading: commandsLoading,
    loadCommands
  } = useCommandsStore()

  // Load global resources once on mount.
  // The ref guard ensures this runs at most once; deps kept minimal.
  useEffect(() => {
    if (hasRequestedGlobalResources.current) return
    hasRequestedGlobalResources.current = true

    if (!skillsLoading) loadSkills()
    if (!agentsLoading) loadAgents()
    if (!isRemote && !commandsLoading) loadCommands()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (currentSpace && !currentSpace.isTemp) {
      void loadToolkit(currentSpace.id)
    }
  }, [currentSpace, loadToolkit])

  const normalizedItems = useMemo<ExtensionItem[]>(() => {
    const skillItems: ExtensionItem[] = skills.map((skill) => ({
      id: `skill:${skill.namespace ?? '-'}:${skill.name}`,
      type: 'skill',
      resource: skill,
      searchable: [
        skill.name,
        skill.namespace,
        skill.description,
        skill.category,
        ...(skill.triggers || [])
      ].filter(Boolean).join(' ').toLowerCase()
    }))

    const agentItems: ExtensionItem[] = agents.map((agent) => ({
      id: `agent:${agent.namespace ?? '-'}:${agent.name}`,
      type: 'agent',
      resource: agent,
      searchable: [agent.name, agent.namespace, agent.description].filter(Boolean).join(' ').toLowerCase()
    }))

    const commandItems: ExtensionItem[] = (isRemote ? [] : commands).map((command) => ({
      id: `command:${command.namespace ?? '-'}:${command.name}`,
      type: 'command',
      resource: command,
      searchable: [commandKey(command), command.description].filter(Boolean).join(' ').toLowerCase()
    }))

    return [...skillItems, ...agentItems, ...commandItems]
  }, [agents, commands, isRemote, skills])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filterType = FILTER_TO_TYPE[activeFilter]
    return normalizedItems.filter((item) => {
      if (filterType && item.type !== filterType) return false
      if (!normalizedQuery) return true
      return item.searchable.includes(normalizedQuery)
    })
  }, [activeFilter, normalizedItems, query])

  const groupedItems = useMemo(() => {
    const groups: Record<'skill' | 'agent' | 'command', ExtensionItem[]> = {
      skill: [],
      agent: [],
      command: []
    }

    filteredItems.forEach((item) => {
      groups[item.type].push(item)
    })

    return groups
  }, [filteredItems])

  const isLoading = skillsLoading || agentsLoading || (!isRemote && commandsLoading)

  const typeCounts = useMemo(() => {
    const counts = { skill: 0, agent: 0, command: 0 }
    for (const item of normalizedItems) {
      counts[item.type]++
    }
    return counts
  }, [normalizedItems])

  const tabs = useMemo<Array<{ key: FilterTab; label: string; count: number }>>(() => [
    { key: 'all', label: t('All'), count: normalizedItems.length },
    { key: 'skills', label: t('Skills'), count: typeCounts.skill },
    { key: 'agents', label: t('Agents'), count: typeCounts.agent },
    {
      key: 'commands',
      label: isRemote ? `${t('Commands')} (${t('Not available')})` : t('Commands'),
      count: typeCounts.command
    }
  ], [normalizedItems.length, typeCounts, t, isRemote])

  const showRemoteCommandsUnavailable = isRemote && (activeFilter === 'commands' || activeFilter === 'all')

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 stagger-item" style={{ animationDelay: '0ms' }}>
          <h2 className="text-lg font-semibold tracking-tight">{t('Extensions')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('Browse system-wide skills, agents and commands')}
          </p>
        </div>

        <div className="glass-card p-3 mb-6 stagger-item" style={{ animationDelay: '40ms' }}>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search extensions...')}
              className="w-full pl-9 pr-3 py-2 input-apple text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => {
              const isActive = activeFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                  }`}
                >
                  {tab.label} <span className="ml-1 text-[10px] opacity-80">{tab.count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 stagger-item" style={{ animationDelay: '80ms' }}>
            <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">{t('Loading extensions...')}</p>
          </div>
        ) : (
          <>
            {showRemoteCommandsUnavailable && (
              <div className="glass-card p-4 mb-4 stagger-item" style={{ animationDelay: '100ms' }}>
                <p className="text-sm text-muted-foreground">
                  {t('Commands are not available in remote mode')}
                </p>
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="stagger-item" style={{ animationDelay: '120ms' }}>
                <EmptyState
                  icon={Puzzle}
                  title={query ? t('No matching extensions') : t('No extensions available')}
                  description={query ? t('Try another search keyword') : t('Resources will appear here after loading')}
                />
              </div>
            ) : activeFilter === 'all' ? (
              <div className="space-y-8">
                <section className="stagger-item" style={{ animationDelay: '120ms' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <h3 className="text-sm font-medium">{t('Skills')} ({groupedItems.skill.length})</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {groupedItems.skill.map((item, index) => (
                      <ResourceCard
                        key={item.id}
                        resource={item.resource}
                        type="skill"
                        index={index}
                        actionMode="toolkit"
                      />
                    ))}
                  </div>
                </section>

                <section className="stagger-item" style={{ animationDelay: '160ms' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Bot className="w-4 h-4 text-cyan-500" />
                    <h3 className="text-sm font-medium">{t('Agents')} ({groupedItems.agent.length})</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {groupedItems.agent.map((item, index) => (
                      <ResourceCard
                        key={item.id}
                        resource={item.resource}
                        type="agent"
                        index={index}
                        actionMode="toolkit"
                      />
                    ))}
                  </div>
                </section>

                {!isRemote && (
                  <section className="stagger-item" style={{ animationDelay: '200ms' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Terminal className="w-4 h-4 text-violet-500" />
                      <h3 className="text-sm font-medium">{t('Commands')} ({groupedItems.command.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {groupedItems.command.map((item, index) => (
                        <ResourceCard
                          key={item.id}
                          resource={item.resource}
                          type="command"
                          index={index}
                          actionMode="toolkit"
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-item" style={{ animationDelay: '120ms' }}>
                {filteredItems.map((item, index) => (
                  <ResourceCard
                    key={item.id}
                    resource={item.resource}
                    type={item.type}
                    index={index}
                    actionMode="toolkit"
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
