import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from '../components/icons/ToolIcons'
import { Header } from '../components/layout/Header'
import { api } from '../api'
import { useAppStore } from '../stores/app.store'
import { useTranslation } from '../i18n'
import { getDefaultSceneDefinitions } from '../components/resources/scene-tag-meta'
import type {
  SceneColorToken,
  SceneDefinition,
  SceneTaxonomyConfig,
  SceneResourceSource,
  SceneResourceType
} from '../../shared/scene-taxonomy'

const COLOR_TOKENS: SceneColorToken[] = ['blue', 'green', 'violet', 'orange', 'cyan', 'slate', 'pink', 'indigo']
const MAX_SCENE_TAGS = 3

const SOURCE_OPTIONS: Record<SceneResourceType, SceneResourceSource[]> = {
  skill: ['app', 'global', 'installed', 'space'],
  agent: ['app', 'global', 'plugin', 'space'],
  command: ['app', 'plugin', 'space']
}

interface SceneTaxonomyResponseShape {
  definitions?: SceneDefinition[]
  config?: SceneTaxonomyConfig
}

interface SpaceOption {
  id: string
  name: string
  path: string
}

interface ResourceListItem {
  name: string
  source: string
  namespace?: string
}

interface ResourceCandidate {
  id: string
  type: SceneResourceType
  source: SceneResourceSource
  name: string
  namespace: string
  workDir?: string
}

function toSceneTaxonomyConfig(definitions: SceneDefinition[]): SceneTaxonomyConfig {
  return {
    version: 1,
    definitions,
    resourceOverrides: {},
    deletedDefinitionKeys: [],
    deletedOverrideKeys: [],
    updatedAt: new Date().toISOString()
  }
}

function createResourceCandidateId(name: string, namespace: string): string {
  return `${namespace || '-'}::${name}`
}

function normalizeWorkDir(workDir: string): string {
  return workDir.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
}

async function sha1Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto.subtle is unavailable in current runtime')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

async function buildSceneResourceKey(input: {
  type: SceneResourceType
  source: SceneResourceSource
  namespace: string
  name: string
  workDir?: string
}): Promise<string> {
  const type = input.type.trim().toLowerCase()
  const source = input.source.trim().toLowerCase()
  const namespace = input.namespace.trim().length > 0 ? input.namespace.trim() : '-'
  const name = input.name.trim()
  if (!name) {
    throw new Error('Resource name is required')
  }

  let scope = '-'
  if (source === 'space') {
    const normalizedWorkDir = normalizeWorkDir(input.workDir || '')
    if (!normalizedWorkDir) {
      throw new Error('Space resource requires workspace')
    }
    scope = (await sha1Hex(normalizedWorkDir)).slice(0, 12)
  }

  return `${type}:${source}:${scope}:${namespace}:${name}`
}

export function SceneTaxonomyAdminPage(): JSX.Element {
  const { t } = useTranslation()
  const { goBack } = useAppStore()
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingResources, setIsLoadingResources] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [definitions, setDefinitions] = useState<SceneDefinition[]>(getDefaultSceneDefinitions())
  const [resourceOverrides, setResourceOverrides] = useState<Record<string, string[]>>({})
  const [selectedType, setSelectedType] = useState<SceneResourceType>('skill')
  const [selectedSource, setSelectedSource] = useState<SceneResourceSource>('app')
  const [spaces, setSpaces] = useState<SpaceOption[]>([])
  const [selectedWorkDir, setSelectedWorkDir] = useState('')
  const [resourceCandidates, setResourceCandidates] = useState<ResourceCandidate[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [selectedResourceName, setSelectedResourceName] = useState('')
  const [selectedResourceNamespace, setSelectedResourceNamespace] = useState('')
  const [resourceSearchQuery, setResourceSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [generatedResourceKey, setGeneratedResourceKey] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importText, setImportText] = useState('')
  const prefilledResourceKeyRef = useRef('')

  const sortedDefinitions = useMemo(
    () => [...definitions].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
    [definitions]
  )
  const definitionByKey = useMemo(
    () => new Map(sortedDefinitions.map((item) => [item.key, item])),
    [sortedDefinitions]
  )
  const selectedResource = useMemo(
    () => resourceCandidates.find((item) => item.id === selectedResourceId) || null,
    [resourceCandidates, selectedResourceId]
  )
  const filteredResourceCandidates = useMemo(() => {
    const query = resourceSearchQuery.trim().toLowerCase()
    if (!query) return resourceCandidates
    return resourceCandidates.filter((item) => {
      const name = item.name.toLowerCase()
      const namespace = item.namespace.toLowerCase()
      const fullName = item.namespace ? `${namespace}:${name}` : name
      return name.includes(query) || namespace.includes(query) || fullName.includes(query)
    })
  }, [resourceCandidates, resourceSearchQuery])
  const visibleResourceCandidates = useMemo(() => {
    if (!selectedResource) return filteredResourceCandidates
    if (filteredResourceCandidates.some((item) => item.id === selectedResource.id)) {
      return filteredResourceCandidates
    }
    return [selectedResource, ...filteredResourceCandidates]
  }, [filteredResourceCandidates, selectedResource])

  const availableSources = SOURCE_OPTIONS[selectedType]
  const hasCurrentOverride = generatedResourceKey.length > 0
    && Object.prototype.hasOwnProperty.call(resourceOverrides, generatedResourceKey)

  const loadTaxonomy = async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await api.getSceneTaxonomy()
      if (!response.success || !response.data) {
        setError(response.error || 'Failed to load scene taxonomy')
        return
      }
      const data = response.data as SceneTaxonomyResponseShape
      const loadedDefinitions = data.definitions || data.config?.definitions || getDefaultSceneDefinitions()
      const loadedOverrides = data.config?.resourceOverrides || {}
      setDefinitions(loadedDefinitions)
      setResourceOverrides(loadedOverrides)
      setImportText(JSON.stringify(data.config || toSceneTaxonomyConfig(loadedDefinitions), null, 2))
    } finally {
      setIsLoading(false)
    }
  }

  const loadSpaceOptions = async (): Promise<void> => {
    const response = await api.listSpaces()
    if (!response.success || !Array.isArray(response.data)) return

    const nextSpaces = (response.data as Array<{ id: string; name: string; path: string }>)
      .filter((item) => typeof item.path === 'string' && item.path.length > 0)
      .map((item) => ({ id: item.id, name: item.name, path: item.path }))

    setSpaces(nextSpaces)
    if (!selectedWorkDir && nextSpaces.length > 0) {
      setSelectedWorkDir(nextSpaces[0].path)
    }
  }

  const loadResourceCandidates = async (
    type: SceneResourceType,
    source: SceneResourceSource,
    workDir: string
  ): Promise<void> => {
    if (source === 'space' && !workDir) {
      setResourceCandidates([])
      setSelectedResourceId('')
      return
    }

    setIsLoadingResources(true)
    setError(null)
    try {
      const targetWorkDir = source === 'space' ? workDir : undefined
      const response = type === 'skill'
        ? await api.listSkills(targetWorkDir)
        : type === 'agent'
          ? await api.listAgents(targetWorkDir)
          : await api.listCommands(targetWorkDir)

      if (!response.success || !Array.isArray(response.data)) {
        setError(response.error || 'Failed to load resources')
        setResourceCandidates([])
        setSelectedResourceId('')
        return
      }

      const candidates = (response.data as ResourceListItem[])
        .filter((item) => item.source === source)
        .map((item) => {
          const namespace = typeof item.namespace === 'string' ? item.namespace : ''
          return {
            id: createResourceCandidateId(item.name, namespace),
            type,
            source,
            name: item.name,
            namespace,
            workDir: source === 'space' ? workDir : undefined
          } satisfies ResourceCandidate
        })
        .sort((a, b) => {
          const namespaceDiff = a.namespace.localeCompare(b.namespace)
          if (namespaceDiff !== 0) return namespaceDiff
          return a.name.localeCompare(b.name)
        })

      setResourceCandidates(candidates)
      if (candidates.length === 0) {
        setSelectedResourceId('')
      } else if (!candidates.some((item) => item.id === selectedResourceId)) {
        setSelectedResourceId(candidates[0].id)
      }
    } finally {
      setIsLoadingResources(false)
    }
  }

  useEffect(() => {
    void loadTaxonomy()
    void loadSpaceOptions()
  }, [])

  useEffect(() => {
    if (availableSources.includes(selectedSource)) return
    setSelectedSource(availableSources[0])
  }, [availableSources, selectedSource])

  useEffect(() => {
    void loadResourceCandidates(selectedType, selectedSource, selectedWorkDir)
  }, [selectedType, selectedSource, selectedWorkDir])

  useEffect(() => {
    setResourceSearchQuery('')
  }, [selectedType, selectedSource, selectedWorkDir])

  useEffect(() => {
    if (!selectedResourceId) {
      setSelectedResourceName('')
      setSelectedResourceNamespace('')
      return
    }

    const selectedCandidate = resourceCandidates.find((item) => item.id === selectedResourceId)
    if (!selectedCandidate) return
    setSelectedResourceName(selectedCandidate.name)
    setSelectedResourceNamespace(selectedCandidate.namespace)
  }, [selectedResourceId, resourceCandidates])

  useEffect(() => {
    let cancelled = false

    const refreshResourceKey = async (): Promise<void> => {
      if (!selectedResourceName.trim()) {
        setGeneratedResourceKey('')
        return
      }

      try {
        const key = await buildSceneResourceKey({
          type: selectedType,
          source: selectedSource,
          name: selectedResourceName,
          namespace: selectedResourceNamespace,
          workDir: selectedSource === 'space' ? selectedWorkDir : undefined
        })
        if (cancelled) return
        setGeneratedResourceKey(key)

        if (prefilledResourceKeyRef.current !== key) {
          setSelectedTags(resourceOverrides[key] || [])
          prefilledResourceKeyRef.current = key
        }
      } catch (err) {
        if (!cancelled) {
          setGeneratedResourceKey('')
          setError((err as Error).message)
        }
      }
    }

    void refreshResourceKey()
    return () => {
      cancelled = true
    }
  }, [selectedType, selectedSource, selectedWorkDir, selectedResourceName, selectedResourceNamespace, resourceOverrides])

  const handleSaveDefinition = async (definition: SceneDefinition): Promise<void> => {
    const response = await api.upsertSceneDefinition(definition as unknown as Record<string, unknown>)
    if (!response.success) {
      setError(response.error || 'Failed to save definition')
      return
    }
    await loadTaxonomy()
  }

  const handleDeleteDefinition = async (key: string): Promise<void> => {
    const response = await api.removeSceneDefinition(key)
    if (!response.success) {
      setError(response.error || 'Failed to delete definition')
      return
    }
    await loadTaxonomy()
  }

  const handleSetOverride = async (): Promise<void> => {
    if (!generatedResourceKey) {
      setError('Please select a valid resource first')
      return
    }
    if (selectedTags.length === 0) {
      setError('Please select at least one scene tag')
      return
    }
    const response = await api.setResourceSceneOverride(generatedResourceKey, selectedTags)
    if (!response.success) {
      setError(response.error || 'Failed to set override')
      return
    }
    await loadTaxonomy()
  }

  const handleRemoveOverride = async (resourceKey: string): Promise<void> => {
    const response = await api.removeResourceSceneOverride(resourceKey)
    if (!response.success) {
      setError(response.error || 'Failed to remove override')
      return
    }
    await loadTaxonomy()
  }

  const handleImport = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(importText) as Record<string, unknown>
      const response = await api.importSceneTaxonomy(parsed, importMode)
      if (!response.success) {
        setError(response.error || 'Failed to import taxonomy')
        return
      }
      await loadTaxonomy()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleExport = async (): Promise<void> => {
    const response = await api.exportSceneTaxonomy()
    if (!response.success || !response.data) {
      setError(response.error || 'Failed to export taxonomy')
      return
    }
    setImportText(JSON.stringify(response.data, null, 2))
  }

  const toggleSceneTag = (key: string): void => {
    setError(null)
    setSelectedTags((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key)
      }
      if (current.length >= MAX_SCENE_TAGS) {
        setError(`At most ${MAX_SCENE_TAGS} tags are allowed`)
        return current
      }
      return [...current, key]
    })
  }

  const formatOverrideTags = (tags: string[]): string => {
    return tags
      .map((tag) => {
        const definition = definitionByKey.get(tag)
        return definition ? `${definition.label.zhCN} (${definition.key})` : tag
      })
      .join(', ')
  }

  return (
    <div className="h-full w-full flex flex-col relative">
      <Header
        left={(
          <>
            <button
              onClick={goBack}
              className="p-1.5 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
            >
              <ArrowLeft className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
            <span className="font-semibold text-sm tracking-tight">{t('Scene Taxonomy Manager')}</span>
          </>
        )}
      />

      <main className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {error && (
            <div className="settings-warning">
              {error}
            </div>
          )}

          <section className="settings-section">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold tracking-tight">{t('Scene Definitions')}</h2>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-lg bg-secondary/80 hover:bg-secondary"
                onClick={() => void loadTaxonomy()}
                disabled={isLoading}
              >
                {isLoading ? t('Loading...') : t('Reload')}
              </button>
            </div>

            <div className="space-y-3">
              {sortedDefinitions.map((definition) => (
                <div key={definition.key} className="glass-subtle rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      className="input-apple px-3 py-2 text-xs"
                      value={definition.key}
                      disabled={definition.builtin}
                      onChange={(event) => {
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key ? { ...item, key: event.target.value } : item
                        )))
                      }}
                    />
                    <input
                      className="input-apple px-3 py-2 text-xs"
                      value={definition.label.en}
                      onChange={(event) => {
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key
                            ? { ...item, label: { ...item.label, en: event.target.value } }
                            : item
                        )))
                      }}
                    />
                    <input
                      className="input-apple px-3 py-2 text-xs"
                      value={definition.label.zhCN}
                      onChange={(event) => {
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key
                            ? { ...item, label: { ...item.label, zhCN: event.target.value } }
                            : item
                        )))
                      }}
                    />
                    <input
                      className="input-apple px-3 py-2 text-xs"
                      value={definition.label.zhTW}
                      onChange={(event) => {
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key
                            ? { ...item, label: { ...item.label, zhTW: event.target.value } }
                            : item
                        )))
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                    <select
                      className="select-apple text-xs"
                      value={definition.colorToken}
                      onChange={(event) => {
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key
                            ? { ...item, colorToken: event.target.value as SceneColorToken }
                            : item
                        )))
                      }}
                    >
                      {COLOR_TOKENS.map((token) => (
                        <option key={token} value={token}>{token}</option>
                      ))}
                    </select>

                    <input
                      type="number"
                      className="input-apple px-3 py-2 text-xs"
                      value={definition.order}
                      onChange={(event) => {
                        const nextOrder = Number(event.target.value || 0)
                        setDefinitions((current) => current.map((item) => (
                          item.key === definition.key ? { ...item, order: nextOrder } : item
                        )))
                      }}
                    />

                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={definition.enabled}
                        disabled={definition.key === 'office'}
                        onChange={(event) => {
                          setDefinitions((current) => current.map((item) => (
                            item.key === definition.key
                              ? { ...item, enabled: event.target.checked || item.key === 'office' }
                              : item
                          )))
                        }}
                      />
                      {t('Enabled')}
                    </label>

                    <button
                      type="button"
                      className="px-3 py-2 text-xs rounded-lg bg-primary/15 text-primary hover:bg-primary/20"
                      onClick={() => void handleSaveDefinition(definition)}
                    >
                      {t('Save')}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive disabled:opacity-50"
                      disabled={definition.builtin}
                      onClick={() => void handleDeleteDefinition(definition.key)}
                    >
                      {t('Delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-4">{t('Resource Overrides')}</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
              <select
                className="select-apple text-xs"
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as SceneResourceType)}
              >
                <option value="skill">{t('Skill')}</option>
                <option value="agent">{t('Agent')}</option>
                <option value="command">{t('Command')}</option>
              </select>

              <select
                className="select-apple text-xs"
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value as SceneResourceSource)}
              >
                {availableSources.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>

              {selectedSource === 'space' ? (
                <select
                  className="select-apple text-xs"
                  value={selectedWorkDir}
                  onChange={(event) => setSelectedWorkDir(event.target.value)}
                >
                  {spaces.length === 0 && (
                    <option value="">{t('No workspace found')}</option>
                  )}
                  {spaces.map((space) => (
                    <option key={space.id} value={space.path}>{space.name}</option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="px-3 py-2 text-xs rounded-lg bg-secondary/80 hover:bg-secondary"
                  onClick={() => void loadResourceCandidates(selectedType, selectedSource, selectedWorkDir)}
                  disabled={isLoadingResources}
                >
                  {isLoadingResources ? t('Loading...') : t('Reload Resources')}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
              <input
                className="input-apple px-3 py-2 text-xs"
                value={resourceSearchQuery}
                onChange={(event) => setResourceSearchQuery(event.target.value)}
                placeholder={t('Search resource name or namespace')}
              />
              <select
                className="select-apple text-xs"
                value={selectedResourceId}
                onChange={(event) => setSelectedResourceId(event.target.value)}
                disabled={visibleResourceCandidates.length === 0}
              >
                {visibleResourceCandidates.length === 0 ? (
                  <option value="">
                    {isLoadingResources
                      ? t('Loading resources...')
                      : resourceSearchQuery.trim()
                        ? t('No resource matches search')
                        : t('No resource under selected source')}
                  </option>
                ) : (
                  visibleResourceCandidates.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.namespace ? `${resource.namespace}:${resource.name}` : resource.name}
                      {resource.id === selectedResourceId
                        && !filteredResourceCandidates.some((item) => item.id === resource.id)
                        ? ` (${t('current selection')})`
                        : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="mb-3">
              <input
                className="input-apple px-3 py-2 text-xs"
                value={generatedResourceKey}
                readOnly
                placeholder={t('resourceKey is generated automatically')}
              />
            </div>

            <div className="glass-subtle rounded-xl p-3 space-y-3 mb-3">
              <p className="text-xs text-muted-foreground">
                {t('Select up to 3 scene tags. Display format: Chinese (English key).')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {sortedDefinitions.map((definition) => (
                  <label
                    key={definition.key}
                    className="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-secondary/40"
                  >
                    <span>{definition.label.zhCN} ({definition.key})</span>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(definition.key)}
                      onChange={() => toggleSceneTag(definition.key)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-2 text-xs rounded-lg bg-primary/15 text-primary hover:bg-primary/20 disabled:opacity-50"
                onClick={() => void handleSetOverride()}
                disabled={!generatedResourceKey || selectedTags.length === 0}
              >
                {t('Set Override')}
              </button>
              <button
                type="button"
                className="px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive disabled:opacity-50"
                onClick={() => void handleRemoveOverride(generatedResourceKey)}
                disabled={!hasCurrentOverride}
              >
                {t('Remove Current Override')}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {Object.entries(resourceOverrides).map(([resourceKey, tags]) => (
                <div key={resourceKey} className="flex items-center justify-between text-xs bg-secondary/40 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono truncate">{resourceKey}</p>
                    <p className="text-muted-foreground">{formatOverrideTags(tags)}</p>
                  </div>
                  <button
                    type="button"
                    className="ml-3 px-2 py-1 rounded-md bg-destructive/10 text-destructive"
                    onClick={() => void handleRemoveOverride(resourceKey)}
                  >
                    {t('Remove')}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-4">{t('Import / Export')}</h2>
            <div className="flex items-center gap-2 mb-3">
              <select
                className="select-apple text-xs"
                value={importMode}
                onChange={(event) => setImportMode(event.target.value as 'merge' | 'replace')}
              >
                <option value="merge">{t('merge')}</option>
                <option value="replace">{t('replace')}</option>
              </select>
              <button
                type="button"
                className="px-3 py-2 text-xs rounded-lg bg-secondary/80 hover:bg-secondary"
                onClick={() => void handleExport()}
              >
                {t('Export')}
              </button>
              <button
                type="button"
                className="px-3 py-2 text-xs rounded-lg bg-primary/15 text-primary hover:bg-primary/20"
                onClick={() => void handleImport()}
              >
                {t('Import')}
              </button>
            </div>
            <textarea
              className="w-full min-h-[220px] input-apple p-3 text-xs font-mono"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
          </section>
        </div>
      </main>
    </div>
  )
}
