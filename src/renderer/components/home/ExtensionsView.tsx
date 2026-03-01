import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Puzzle, Search, Terminal, Zap } from 'lucide-react'
import { api } from '../../api'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { type AgentDefinition, useAgentsStore } from '../../stores/agents.store'
import { useChatStore } from '../../stores/chat.store'
import { type CommandDefinition, useCommandsStore } from '../../stores/commands.store'
import { type SkillDefinition, useSkillsStore } from '../../stores/skills.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { useSpaceStore } from '../../stores/space.store'
import { ResourceCard } from '../resources/ResourceCard'
import {
  applySceneFilter,
  applyTypeAndSearchFilter,
  computeSceneCounts,
  computeTypeCounts,
  getSceneOrder,
  groupByType,
  normalizeExtensionItems,
  shouldShowRemoteCommandsUnavailable,
  sortExtensions,
  type FilterTab
} from '../resources/extension-filtering'
import {
  getDefaultSceneDefinitions,
  getSceneClassName,
  getSceneLabel,
  normalizeSceneDefinitions
} from '../resources/scene-tag-meta'
import type { SceneFilter } from '../../../shared/extension-taxonomy'
import type { SceneDefinition } from '../../../shared/scene-taxonomy'

interface EmptyStateProps {
  icon: typeof Puzzle
  title: string
  description: string
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

type SessionReadyState = 'ready' | 'stale' | 'unknown' | 'na'

export function ExtensionsView(): JSX.Element {
  const { t } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [sceneFilter, setSceneFilter] = useState<SceneFilter>('all')
  const [query, setQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sceneDefinitions, setSceneDefinitions] = useState<SceneDefinition[]>(getDefaultSceneDefinitions())
  const isRemote = api.isRemoteMode()
  const hasRequestedGlobalResources = useRef(false)
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const currentSpaceId = currentSpace?.id
  const currentConversationId = useChatStore((state) => {
    if (!state.currentSpaceId) return null
    return state.spaceStates.get(state.currentSpaceId)?.currentConversationId ?? null
  })
  const { loadToolkit } = useToolkitStore()
  const [resourceIndexHash, setResourceIndexHash] = useState<string | null>(null)
  const [sessionResourceHash, setSessionResourceHash] = useState<string | null>(null)
  const [resourceHashError, setResourceHashError] = useState<string | null>(null)
  const [isCheckingResourceHash, setIsCheckingResourceHash] = useState(false)

  const {
    skills,
    isLoading: skillsLoading,
    loadSkills,
    loadedWorkDir,
    lastRefreshReason,
    lastRefreshTs
  } = useSkillsStore()

  const {
    agents,
    isLoading: agentsLoading,
    loadAgents
  } = useAgentsStore()

  const {
    commands,
    isLoading: commandsLoading,
    loadCommands
  } = useCommandsStore()

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

  useEffect(() => {
    let cancelled = false
    const loadSceneTaxonomy = async (): Promise<void> => {
      const response = await api.getSceneTaxonomy()
      if (!response.success || !response.data || cancelled) return
      const data = response.data as { definitions?: unknown; config?: { definitions?: unknown } }
      const definitions = normalizeSceneDefinitions(data.definitions ?? data.config?.definitions)
      setSceneDefinitions(definitions)
    }
    void loadSceneTaxonomy()
    return () => {
      cancelled = true
    }
  }, [])

  const sceneDefinitionMap = useMemo(
    () => new Map(sceneDefinitions.map((item) => [item.key, item])),
    [sceneDefinitions]
  )
  const sceneKeys = useMemo(() => getSceneOrder(sceneDefinitions), [sceneDefinitions])

  const normalizedItems = useMemo(() => normalizeExtensionItems({
    skills: skills as SkillDefinition[],
    agents: agents as AgentDefinition[],
    commands: commands as CommandDefinition[],
    isRemote,
    sceneDefinitions
  }), [agents, commands, isRemote, sceneDefinitions, skills])

  const typeSearchFilteredItems = useMemo(
    () => sortExtensions(applyTypeAndSearchFilter(normalizedItems, activeFilter, query)),
    [activeFilter, normalizedItems, query]
  )

  const sceneCounts = useMemo(
    () => computeSceneCounts(typeSearchFilteredItems, sceneKeys),
    [sceneKeys, typeSearchFilteredItems]
  )

  const filteredItems = useMemo(
    () => applySceneFilter(typeSearchFilteredItems, sceneFilter),
    [sceneFilter, typeSearchFilteredItems]
  )

  const groupedItems = useMemo(() => groupByType(filteredItems), [filteredItems])

  const isLoading = skillsLoading || agentsLoading || (!isRemote && commandsLoading)

  const typeCounts = useMemo(() => computeTypeCounts(normalizedItems), [normalizedItems])

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

  const showRemoteCommandsUnavailable = shouldShowRemoteCommandsUnavailable(isRemote, activeFilter)

  const sceneOptions = useMemo(() => {
    const allCount = typeSearchFilteredItems.length
    return [
      { key: 'all' as const, label: t('All scenes'), count: allCount },
      ...sceneKeys.map((tag) => ({
        key: tag,
        label: sceneDefinitionMap.has(tag)
          ? getSceneLabel(sceneDefinitionMap.get(tag)!, getCurrentLanguage())
          : tag,
        count: sceneCounts[tag] ?? 0
      }))
    ]
  }, [sceneCounts, sceneDefinitionMap, sceneKeys, t, typeSearchFilteredItems.length])

  const sourceCounts = useMemo(() => {
    const counts = {
      app: 0,
      global: 0,
      installed: 0,
      plugin: 0,
      space: 0,
      other: 0
    }
    for (const item of normalizedItems) {
      const source = (item.resource as { source?: string }).source
      if (!source || !(source in counts)) {
        counts.other += 1
        continue
      }
      counts[source as keyof typeof counts] += 1
    }
    return counts
  }, [normalizedItems])

  const refreshResourceHash = useCallback(async (): Promise<void> => {
    try {
      setIsCheckingResourceHash(true)
      setResourceHashError(null)
      const response = await api.getAgentResourceHash({
        spaceId: currentSpaceId || undefined,
        workDir: currentSpaceId ? undefined : (loadedWorkDir ?? undefined),
        conversationId: currentConversationId ?? undefined
      })

      if (!response.success || !response.data) {
        setResourceHashError(response.error || 'Failed to get resource hash')
        setResourceIndexHash(null)
        setSessionResourceHash(null)
        return
      }

      const data = response.data as { hash?: unknown; sessionResourceHash?: unknown }
      setResourceIndexHash(typeof data.hash === 'string' ? data.hash : null)
      setSessionResourceHash(typeof data.sessionResourceHash === 'string' ? data.sessionResourceHash : null)
    } catch (error) {
      console.error('[ExtensionsView] Failed to get resource hash:', error)
      setResourceHashError('Failed to get resource hash')
      setResourceIndexHash(null)
      setSessionResourceHash(null)
    } finally {
      setIsCheckingResourceHash(false)
    }
  }, [currentConversationId, currentSpaceId, loadedWorkDir])

  useEffect(() => {
    void refreshResourceHash()
  }, [refreshResourceHash, lastRefreshTs])

  const sessionReadyState = useMemo<SessionReadyState>(() => {
    if (!currentConversationId) return 'na'
    if (resourceHashError || !resourceIndexHash) return 'unknown'
    if (!sessionResourceHash) return 'unknown'
    return sessionResourceHash === resourceIndexHash ? 'ready' : 'stale'
  }, [currentConversationId, resourceHashError, resourceIndexHash, sessionResourceHash])

  const sessionReadyText = useMemo(() => {
    if (sessionReadyState === 'ready') return t('Ready')
    if (sessionReadyState === 'stale') return t('Outdated')
    if (sessionReadyState === 'na') return t('N/A')
    return t('Unknown')
  }, [sessionReadyState, t])

  const indexedBadgeClass = useMemo(() => {
    if (resourceIndexHash) {
      return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    }
    return 'border-border/60 bg-foreground/5 text-muted-foreground'
  }, [resourceIndexHash])

  const indexedDisplayText = useMemo(() => {
    if (isCheckingResourceHash) return t('Checking...')
    if (!resourceIndexHash) return t('Unknown')
    return resourceIndexHash.slice(0, 8)
  }, [isCheckingResourceHash, resourceIndexHash, t])

  const sessionBadgeClass = useMemo(() => {
    if (sessionReadyState === 'ready') {
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    }
    if (sessionReadyState === 'stale') {
      return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    }
    return 'border-border/60 bg-foreground/5 text-muted-foreground'
  }, [sessionReadyState])

  const handleClearFilters = (): void => {
    setSceneFilter('all')
    setQuery('')
  }

  const handleRefreshResources = useCallback(async (): Promise<void> => {
    if (isRefreshing) return
    try {
      setIsRefreshing(true)
      const refreshResult = await api.refreshSkillsIndex(loadedWorkDir ?? undefined)
      if (!refreshResult.success) {
        setResourceHashError(refreshResult.error || 'Failed to refresh resources')
        return
      }
      await Promise.all([
        loadSkills(loadedWorkDir ?? undefined),
        loadAgents(loadedWorkDir ?? undefined),
        !isRemote ? loadCommands(loadedWorkDir ?? undefined, true) : Promise.resolve()
      ])
      useSkillsStore.setState({
        lastRefreshReason: 'manual-refresh',
        lastRefreshTs: new Date().toISOString()
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, loadedWorkDir, loadAgents, loadCommands, loadSkills, isRemote])

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 stagger-item" style={{ animationDelay: '0ms' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{t('Extensions')}</h2>
            <button
              type="button"
              onClick={() => void handleRefreshResources()}
              disabled={isRefreshing}
              className="px-3 py-1.5 text-xs rounded-lg bg-secondary/70 hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {isRefreshing ? t('Refreshing...') : t('Refresh')}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t('Browse system-wide skills, agents and commands')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {t('Installed')}: {normalizedItems.length}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md border ${indexedBadgeClass}`}>
              {t('Indexed')}: {indexedDisplayText}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md border ${sessionBadgeClass}`}>
              {t('Session Ready')}: {sessionReadyText}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            app {sourceCounts.app} · global {sourceCounts.global} · plugin {sourceCounts.installed + sourceCounts.plugin} · space {sourceCounts.space}
          </p>
          {sessionReadyState === 'stale' && (
            <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 mt-1">
              {t('Current session is using an older resource snapshot; next message will rebuild the session.')}
            </p>
          )}
          {lastRefreshTs && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t('Last refresh')}: {new Date(lastRefreshTs).toLocaleString()} ({lastRefreshReason || t('unknown')})
            </p>
          )}
          {resourceHashError && (
            <p className="text-xs text-destructive/80 mt-1">{resourceHashError}</p>
          )}
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

          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/40">
            {sceneOptions.map((scene) => {
              const isActive = sceneFilter === scene.key
              const isZero = scene.count === 0 && scene.key !== 'all'
              const canClick = isActive || !isZero

              const sceneStyle = scene.key === 'all'
                ? 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                : getSceneClassName(sceneDefinitions, scene.key)

              return (
                <button
                  key={scene.key}
                  type="button"
                  onClick={() => canClick && setSceneFilter(scene.key)}
                  disabled={!canClick}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-all ${
                    isActive
                      ? 'bg-primary/15 text-primary border-primary/25 font-medium'
                      : `${sceneStyle} ${isZero ? 'opacity-45 cursor-not-allowed' : 'hover:opacity-90'}`
                  }`}
                >
                  {scene.label}
                  <span className="ml-1 text-[10px] opacity-80">{scene.count}</span>
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
                  title={query || sceneFilter !== 'all' ? t('No matching extensions') : t('No extensions available')}
                  description={query || sceneFilter !== 'all' ? t('Try another search keyword') : t('Resources will appear here after loading')}
                />
                {(query || sceneFilter !== 'all') && (
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="px-3 py-1.5 text-xs rounded-lg bg-secondary/80 hover:bg-secondary text-muted-foreground"
                    >
                      {t('Clear filters')}
                    </button>
                  </div>
                )}
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
                        sceneDefinitions={sceneDefinitions}
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
                        sceneDefinitions={sceneDefinitions}
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
                          sceneDefinitions={sceneDefinitions}
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
                    sceneDefinitions={sceneDefinitions}
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
