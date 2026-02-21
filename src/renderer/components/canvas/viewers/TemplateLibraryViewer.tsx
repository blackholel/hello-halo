import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Puzzle, Search, Terminal, X, Zap } from 'lucide-react'
import { commandKey } from '../../../../shared/command-utils'
import { api } from '../../../api'
import { useTranslation } from '../../../i18n'
import { useCanvasLifecycle } from '../../../hooks/useCanvasLifecycle'
import { ResourceCard } from '../../resources/ResourceCard'
import { resourceKey } from '../../resources/resource-meta'
import type { ResourceType } from '../../resources/types'
import { useAgentsStore, type AgentDefinition } from '../../../stores/agents.store'
import { useCommandsStore, type CommandDefinition } from '../../../stores/commands.store'
import { useSkillsStore, type SkillDefinition } from '../../../stores/skills.store'
import type { TabState } from '../../../services/canvas-lifecycle'
import type { TemplateLibraryTab } from '../../../types/template-library'

type FilterTab = 'all' | 'skills' | 'agents' | 'commands'

interface TemplateLibraryViewerProps {
  tab: TabState
}

interface TemplateItem {
  id: string
  type: ResourceType
  resource: SkillDefinition | AgentDefinition | CommandDefinition
  searchable: string
}

interface EmptyStateProps {
  icon: typeof Puzzle
  title: string
  description: string
}

const FILTER_TO_TYPE: Record<FilterTab, ResourceType | null> = {
  all: null,
  skills: 'skill',
  agents: 'agent',
  commands: 'command'
}

function mapTemplateTabToFilter(tab: TemplateLibraryTab): FilterTab {
  if (tab === 'agents') return 'agents'
  if (tab === 'commands') return 'commands'
  return 'skills'
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

export function TemplateLibraryViewer({ tab }: TemplateLibraryViewerProps): JSX.Element {
  const { t } = useTranslation()
  const { closeTab } = useCanvasLifecycle()
  const isRemote = api.isRemoteMode()
  const workDir = tab.workDir

  const loadSkills = useSkillsStore((state) => state.loadSkills)
  const markSkillsDirty = useSkillsStore((state) => state.markDirty)
  const loadAgents = useAgentsStore((state) => state.loadAgents)
  const markAgentsDirty = useAgentsStore((state) => state.markDirty)
  const loadCommands = useCommandsStore((state) => state.loadCommands)

  const [activeFilter, setActiveFilter] = useState<FilterTab>(mapTemplateTabToFilter(tab.templateLibraryTab ?? 'skills'))
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [templateSkills, setTemplateSkills] = useState<SkillDefinition[]>([])
  const [templateAgents, setTemplateAgents] = useState<AgentDefinition[]>([])
  const [templateCommands, setTemplateCommands] = useState<CommandDefinition[]>([])
  const [spaceSkillKeys, setSpaceSkillKeys] = useState<Set<string>>(new Set())
  const [spaceAgentKeys, setSpaceAgentKeys] = useState<Set<string>>(new Set())
  const [spaceCommandKeys, setSpaceCommandKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    setActiveFilter(mapTemplateTabToFilter(tab.templateLibraryTab ?? 'skills'))
    setQuery('')
  }, [tab.id, tab.templateLibraryTab])

  useEffect(() => {
    let cancelled = false

    const loadResources = async (): Promise<void> => {
      setLoading(true)

      const [globalSkillsRes, globalAgentsRes, globalCommandsRes] = await Promise.all([
        api.listSkills(),
        api.listAgents(),
        isRemote
          ? Promise.resolve({ success: true, data: [] as CommandDefinition[] })
          : api.listCommands()
      ])

      const [spaceSkillsRes, spaceAgentsRes, spaceCommandsRes] = workDir
        ? await Promise.all([
          api.listSkills(workDir),
          api.listAgents(workDir),
          isRemote
            ? Promise.resolve({ success: true, data: [] as CommandDefinition[] })
            : api.listCommands(workDir)
        ])
        : [
          { success: true, data: [] as SkillDefinition[] },
          { success: true, data: [] as AgentDefinition[] },
          { success: true, data: [] as CommandDefinition[] }
        ]

      if (cancelled) return

      setTemplateSkills(globalSkillsRes.success && globalSkillsRes.data ? globalSkillsRes.data as SkillDefinition[] : [])
      setTemplateAgents(globalAgentsRes.success && globalAgentsRes.data ? globalAgentsRes.data as AgentDefinition[] : [])
      setTemplateCommands(globalCommandsRes.success && globalCommandsRes.data ? globalCommandsRes.data as CommandDefinition[] : [])

      const skillSet = new Set<string>()
      const agentSet = new Set<string>()
      const commandSet = new Set<string>()

      if (spaceSkillsRes.success && spaceSkillsRes.data) {
        for (const skill of (spaceSkillsRes.data as SkillDefinition[]).filter((item) => item.source === 'space')) {
          skillSet.add(resourceKey(skill))
        }
      }
      if (spaceAgentsRes.success && spaceAgentsRes.data) {
        for (const agent of (spaceAgentsRes.data as AgentDefinition[]).filter((item) => item.source === 'space')) {
          agentSet.add(resourceKey(agent))
        }
      }
      if (spaceCommandsRes.success && spaceCommandsRes.data) {
        for (const command of (spaceCommandsRes.data as CommandDefinition[]).filter((item) => item.source === 'space')) {
          commandSet.add(resourceKey(command))
        }
      }

      setSpaceSkillKeys(skillSet)
      setSpaceAgentKeys(agentSet)
      setSpaceCommandKeys(commandSet)
      setLoading(false)
    }

    void loadResources()

    return () => {
      cancelled = true
    }
  }, [isRemote, refreshToken, workDir])

  const refreshStores = useCallback(async (targetWorkDir: string): Promise<void> => {
    markSkillsDirty(targetWorkDir)
    markAgentsDirty(targetWorkDir)
    await Promise.all([
      loadSkills(targetWorkDir),
      loadAgents(targetWorkDir),
      loadCommands(targetWorkDir, true)
    ])
  }, [loadAgents, loadCommands, loadSkills, markAgentsDirty, markSkillsDirty])

  const triggerRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1)
  }, [])

  const handleAfterImport = useCallback(() => {
    triggerRefresh()
    if (workDir) {
      void refreshStores(workDir)
    }
  }, [refreshStores, triggerRefresh, workDir])

  const normalizedItems = useMemo<TemplateItem[]>(() => {
    const skillItems: TemplateItem[] = templateSkills.map((skill) => ({
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

    const agentItems: TemplateItem[] = templateAgents.map((agent) => ({
      id: `agent:${agent.namespace ?? '-'}:${agent.name}`,
      type: 'agent',
      resource: agent,
      searchable: [agent.name, agent.namespace, agent.description].filter(Boolean).join(' ').toLowerCase()
    }))

    const commandItems: TemplateItem[] = (isRemote ? [] : templateCommands).map((command) => ({
      id: `command:${command.namespace ?? '-'}:${command.name}`,
      type: 'command',
      resource: command,
      searchable: [commandKey(command), command.description].filter(Boolean).join(' ').toLowerCase()
    }))

    return [...skillItems, ...agentItems, ...commandItems]
  }, [isRemote, templateAgents, templateCommands, templateSkills])

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
    const groups: Record<ResourceType, TemplateItem[]> = {
      skill: [],
      agent: [],
      command: []
    }

    filteredItems.forEach((item) => {
      groups[item.type].push(item)
    })

    return groups
  }, [filteredItems])

  const counts = useMemo(() => {
    const value = {
      skill: 0,
      agent: 0,
      command: 0
    }
    for (const item of normalizedItems) {
      value[item.type]++
    }
    return value
  }, [normalizedItems])

  const tabs = useMemo<Array<{ key: FilterTab; label: string; count: number }>>(() => [
    { key: 'all', label: t('All'), count: normalizedItems.length },
    { key: 'skills', label: t('Skills'), count: counts.skill },
    { key: 'agents', label: t('Agents'), count: counts.agent },
    {
      key: 'commands',
      label: isRemote ? `${t('Commands')} (${t('Not available')})` : t('Commands'),
      count: counts.command
    }
  ], [counts, isRemote, normalizedItems.length, t])

  const isAdded = useCallback((item: TemplateItem): boolean => {
    const key = resourceKey(item.resource)
    if (item.type === 'skill') return spaceSkillKeys.has(key)
    if (item.type === 'agent') return spaceAgentKeys.has(key)
    return spaceCommandKeys.has(key)
  }, [spaceAgentKeys, spaceCommandKeys, spaceSkillKeys])

  const getDisabledReason = useCallback((item: TemplateItem): string | undefined => {
    if (item.type === 'command' && isRemote) return t('Not available')
    if (!workDir) return t('No space selected')
    if (isAdded(item)) return t('Already added')
    return undefined
  }, [isAdded, isRemote, t, workDir])

  const showRemoteCommandsUnavailable = isRemote && (activeFilter === 'commands' || activeFilter === 'all')

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="text-sm font-semibold">{t('Template Library')}</div>
        <button
          className="p-1 rounded hover:bg-secondary/70"
          onClick={() => void closeTab(tab.id)}
          title={t('Close (⌘W / Middle-click)')}
        >
          <X size={16} />
        </button>
      </div>

      <div className="h-full overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="mb-6 stagger-item" style={{ animationDelay: '0ms' }}>
            <h2 className="text-lg font-semibold tracking-tight">{t('Template Library')}</h2>
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
                placeholder={t('Search templates...')}
                className="w-full pl-9 pr-3 py-2 input-apple text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {tabs.map((item) => {
                const isActive = activeFilter === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveFilter(item.key)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                      isActive
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                    }`}
                  >
                    {item.label} <span className="ml-1 text-[10px] opacity-80">{item.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {loading ? (
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
                      {groupedItems.skill.map((item, index) => {
                        const disabledReason = getDisabledReason(item)
                        return (
                          <ResourceCard
                            key={item.id}
                            resource={item.resource}
                            type="skill"
                            index={index}
                            actionMode="copy-to-space"
                            workDir={workDir}
                            isActionDisabled={!!disabledReason}
                            actionDisabledReason={disabledReason}
                            onAfterAction={handleAfterImport}
                          />
                        )
                      })}
                    </div>
                  </section>

                  <section className="stagger-item" style={{ animationDelay: '160ms' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Bot className="w-4 h-4 text-cyan-500" />
                      <h3 className="text-sm font-medium">{t('Agents')} ({groupedItems.agent.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {groupedItems.agent.map((item, index) => {
                        const disabledReason = getDisabledReason(item)
                        return (
                          <ResourceCard
                            key={item.id}
                            resource={item.resource}
                            type="agent"
                            index={index}
                            actionMode="copy-to-space"
                            workDir={workDir}
                            isActionDisabled={!!disabledReason}
                            actionDisabledReason={disabledReason}
                            onAfterAction={handleAfterImport}
                          />
                        )
                      })}
                    </div>
                  </section>

                  {!isRemote && (
                    <section className="stagger-item" style={{ animationDelay: '200ms' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <Terminal className="w-4 h-4 text-violet-500" />
                        <h3 className="text-sm font-medium">{t('Commands')} ({groupedItems.command.length})</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {groupedItems.command.map((item, index) => {
                          const disabledReason = getDisabledReason(item)
                          return (
                            <ResourceCard
                              key={item.id}
                              resource={item.resource}
                              type="command"
                              index={index}
                              actionMode="copy-to-space"
                              workDir={workDir}
                              isActionDisabled={!!disabledReason}
                              actionDisabledReason={disabledReason}
                              onAfterAction={handleAfterImport}
                            />
                          )
                        })}
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-item" style={{ animationDelay: '120ms' }}>
                  {filteredItems.map((item, index) => {
                    const disabledReason = getDisabledReason(item)
                    return (
                      <ResourceCard
                        key={item.id}
                        resource={item.resource}
                        type={item.type}
                        index={index}
                        actionMode="copy-to-space"
                        workDir={workDir}
                        isActionDisabled={!!disabledReason}
                        actionDisabledReason={disabledReason}
                        onAfterAction={handleAfterImport}
                      />
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

