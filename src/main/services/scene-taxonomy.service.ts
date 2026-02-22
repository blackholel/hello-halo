import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getLockedUserConfigRootDir } from './config-source-mode.service'
import { getConfig } from './config.service'
import { SCENE_TAXONOMY_SEED } from '../../shared/scene-taxonomy-seed'
import {
  BUILTIN_SCENE_TAG_KEYS,
  createEmptySceneTaxonomyConfig,
  isBuiltinSceneTagKey,
  isValidSceneColorToken,
  isValidSceneTagKey,
  normalizeSceneDefinition,
  normalizeSceneTagKeys,
  sortSceneDefinitions,
  type SceneDefinition,
  type SceneResourceKeyInput,
  type SceneTagKey,
  type SceneTaxonomyConfig,
  type SceneTaxonomyView
} from '../../shared/scene-taxonomy'

type ImportMode = 'merge' | 'replace'
type MutationListener = () => void

interface SceneTaxonomyState {
  local: SceneTaxonomyConfig
  merged: SceneTaxonomyConfig
}

let taxonomyStateCache: SceneTaxonomyState | null = null
const mutationListeners = new Set<MutationListener>()

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
}

function getTaxonomyFilePath(): string {
  return join(getLockedUserConfigRootDir(), 'taxonomy', 'scene-taxonomy.json')
}

function assertAdminEnabled(): void {
  const config = getConfig() as { extensionTaxonomy?: { adminEnabled?: boolean } }
  if (config.extensionTaxonomy?.adminEnabled !== true) {
    throw new Error('Scene taxonomy admin access is disabled')
  }
}

function sanitizeDefinition(input: SceneDefinition): SceneDefinition {
  const rawKey = String(input.key || '').trim()
  if (!isValidSceneTagKey(rawKey)) {
    throw new Error(`Scene tag key must be kebab-case: ${input.key}`)
  }
  const normalized = normalizeSceneDefinition(input)
  if (normalized.key !== rawKey) {
    throw new Error(`Scene tag key must be kebab-case: ${input.key}`)
  }
  if (!isValidSceneColorToken(normalized.colorToken)) {
    throw new Error(`Unknown scene color token: ${String(input.colorToken)}`)
  }
  if (!normalized.label.en || !normalized.label.zhCN || !normalized.label.zhTW) {
    throw new Error(`Scene label is required for key: ${normalized.key}`)
  }

  if (isBuiltinSceneTagKey(normalized.key)) {
    normalized.builtin = true
  }

  if (normalized.key === 'office') {
    normalized.builtin = true
    normalized.enabled = true
  }

  return normalized
}

function normalizeConfigShape(input: Partial<SceneTaxonomyConfig> | null | undefined): SceneTaxonomyConfig {
  const base = createEmptySceneTaxonomyConfig(nowIso())
  if (!input) return base

  const definitions = Array.isArray(input.definitions)
    ? input.definitions.map((item) => sanitizeDefinition(item))
    : []
  const resourceOverridesRaw = input.resourceOverrides && typeof input.resourceOverrides === 'object'
    ? input.resourceOverrides
    : {}
  const resourceOverrides: Record<string, string[]> = {}
  for (const [key, tags] of Object.entries(resourceOverridesRaw)) {
    if (typeof key !== 'string' || key.trim().length === 0) continue
    resourceOverrides[key] = Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string')
      : []
  }

  return {
    version: 1,
    definitions,
    resourceOverrides,
    deletedDefinitionKeys: Array.isArray(input.deletedDefinitionKeys)
      ? Array.from(new Set(input.deletedDefinitionKeys
        .filter((key): key is string => typeof key === 'string')
        .map((key) => key.trim().toLowerCase())
        .filter((key) => isValidSceneTagKey(key) && !isBuiltinSceneTagKey(key))))
      : [],
    deletedOverrideKeys: Array.isArray(input.deletedOverrideKeys)
      ? Array.from(new Set(input.deletedOverrideKeys.filter((key): key is string => typeof key === 'string')))
      : [],
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : nowIso()
  }
}

function mergeWithSeed(localConfig: SceneTaxonomyConfig): SceneTaxonomyConfig {
  const mergedDefinitions = new Map<string, SceneDefinition>()
  for (const item of SCENE_TAXONOMY_SEED.definitions.map((definition) => sanitizeDefinition(definition))) {
    mergedDefinitions.set(item.key, item)
  }

  for (const item of localConfig.definitions.map((definition) => sanitizeDefinition(definition))) {
    mergedDefinitions.set(item.key, item)
  }

  for (const key of localConfig.deletedDefinitionKeys) {
    if (isBuiltinSceneTagKey(key)) continue
    mergedDefinitions.delete(key)
  }

  for (const builtinKey of BUILTIN_SCENE_TAG_KEYS) {
    const existing = mergedDefinitions.get(builtinKey)
    const seedBuiltin = SCENE_TAXONOMY_SEED.definitions.find((item) => item.key === builtinKey)
    if (!seedBuiltin) continue
    if (!existing) {
      mergedDefinitions.set(builtinKey, sanitizeDefinition(seedBuiltin))
      continue
    }

    mergedDefinitions.set(builtinKey, sanitizeDefinition({
      ...existing,
      builtin: true,
      enabled: builtinKey === 'office' ? true : existing.enabled
    }))
  }

  const definitions = sortSceneDefinitions(Array.from(mergedDefinitions.values()))
  const knownKeys = new Set(definitions.map((item) => item.key))

  const mergedOverrides: Record<string, string[]> = {
    ...SCENE_TAXONOMY_SEED.resourceOverrides
  }

  for (const [resourceKey, tags] of Object.entries(localConfig.resourceOverrides)) {
    const normalizedTags = normalizeSceneTagKeys(tags, knownKeys)
    if (normalizedTags.length > 0) {
      mergedOverrides[resourceKey] = normalizedTags
    }
  }

  for (const deletedKey of localConfig.deletedOverrideKeys) {
    delete mergedOverrides[deletedKey]
  }

  return {
    version: 1,
    definitions,
    resourceOverrides: mergedOverrides,
    deletedDefinitionKeys: [...localConfig.deletedDefinitionKeys],
    deletedOverrideKeys: [...localConfig.deletedOverrideKeys],
    updatedAt: localConfig.updatedAt || SCENE_TAXONOMY_SEED.updatedAt
  }
}

function readLocalConfig(): SceneTaxonomyConfig {
  const filePath = getTaxonomyFilePath()
  if (!existsSync(filePath)) return createEmptySceneTaxonomyConfig()

  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<SceneTaxonomyConfig>
    return normalizeConfigShape(parsed)
  } catch (error) {
    console.warn('[SceneTaxonomy] Failed to read local taxonomy config, fallback to empty:', error)
    return createEmptySceneTaxonomyConfig()
  }
}

function writeLocalConfig(localConfig: SceneTaxonomyConfig): void {
  const filePath = getTaxonomyFilePath()
  const dirPath = dirname(filePath)
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
  writeFileSync(filePath, JSON.stringify(localConfig, null, 2), 'utf-8')
}

function getState(): SceneTaxonomyState {
  if (taxonomyStateCache) return taxonomyStateCache
  const local = readLocalConfig()
  const merged = mergeWithSeed(local)
  taxonomyStateCache = { local, merged }
  return taxonomyStateCache
}

function setState(localConfig: SceneTaxonomyConfig): SceneTaxonomyState {
  const normalizedLocal = normalizeConfigShape(localConfig)
  normalizedLocal.updatedAt = nowIso()
  writeLocalConfig(normalizedLocal)
  taxonomyStateCache = {
    local: normalizedLocal,
    merged: mergeWithSeed(normalizedLocal)
  }
  notifyMutations()
  return taxonomyStateCache
}

function notifyMutations(): void {
  for (const listener of mutationListeners) {
    try {
      listener()
    } catch (error) {
      console.warn('[SceneTaxonomy] Mutation listener error:', error)
    }
  }
}

function mutateLocalConfig(mutator: (draft: SceneTaxonomyConfig, merged: SceneTaxonomyConfig) => void): SceneTaxonomyView {
  const { local, merged } = getState()
  const draft = clone(local)
  mutator(draft, merged)
  const nextState = setState(draft)
  return buildView(nextState.merged)
}

function buildView(merged: SceneTaxonomyConfig): SceneTaxonomyView {
  const config = clone(merged)
  const enabledDefinitions = sortSceneDefinitions(config.definitions.filter((item) => item.enabled))
  return {
    enabledDefinitions,
    definitions: sortSceneDefinitions(config.definitions),
    overrideCount: Object.keys(config.resourceOverrides).length,
    config
  }
}

export function getSceneTaxonomy(): SceneTaxonomyView {
  return buildView(getState().merged)
}

export function exportSceneTaxonomy(): SceneTaxonomyConfig {
  return clone(getState().merged)
}

export function importSceneTaxonomy(payload: SceneTaxonomyConfig, mode: ImportMode = 'merge'): SceneTaxonomyView {
  assertAdminEnabled()
  const incoming = normalizeConfigShape(payload)

  if (mode === 'replace') {
    return buildView(setState(incoming).merged)
  }

  return mutateLocalConfig((draft) => {
    const incomingDefinitionKeys = new Set(incoming.definitions.map((definition) => definition.key))
    const incomingOverrideKeys = new Set(Object.keys(incoming.resourceOverrides))
    const definitionMap = new Map<string, SceneDefinition>()
    for (const definition of draft.definitions) {
      definitionMap.set(definition.key, sanitizeDefinition(definition))
    }
    for (const definition of incoming.definitions) {
      definitionMap.set(definition.key, sanitizeDefinition(definition))
    }
    draft.definitions = Array.from(definitionMap.values())

    draft.resourceOverrides = {
      ...draft.resourceOverrides,
      ...incoming.resourceOverrides
    }

    draft.deletedDefinitionKeys = Array.from(new Set([
      ...draft.deletedDefinitionKeys,
      ...incoming.deletedDefinitionKeys
    ])).filter((key) => !incomingDefinitionKeys.has(key))
    draft.deletedOverrideKeys = Array.from(new Set([
      ...draft.deletedOverrideKeys,
      ...incoming.deletedOverrideKeys
    ])).filter((key) => !incomingOverrideKeys.has(key))
  })
}

export function upsertSceneDefinition(definition: SceneDefinition): SceneTaxonomyView {
  assertAdminEnabled()
  const normalized = sanitizeDefinition(definition)
  return mutateLocalConfig((draft) => {
    const map = new Map<string, SceneDefinition>()
    for (const item of draft.definitions) {
      map.set(item.key, sanitizeDefinition(item))
    }
    map.set(normalized.key, normalized)
    draft.definitions = Array.from(map.values())
    draft.deletedDefinitionKeys = draft.deletedDefinitionKeys.filter((key) => key !== normalized.key)
  })
}

export function removeSceneDefinition(key: string): SceneTaxonomyView {
  assertAdminEnabled()
  const normalizedKey = key.trim().toLowerCase()
  if (!isValidSceneTagKey(normalizedKey)) {
    throw new Error(`Invalid scene key: ${key}`)
  }

  const existing = getState().merged.definitions.find((item) => item.key === normalizedKey)
  if (!existing) {
    return getSceneTaxonomy()
  }
  if (existing.builtin || isBuiltinSceneTagKey(normalizedKey)) {
    throw new Error(`Cannot remove builtin scene definition: ${normalizedKey}`)
  }

  return mutateLocalConfig((draft) => {
    draft.definitions = draft.definitions.filter((item) => item.key !== normalizedKey)
    if (!draft.deletedDefinitionKeys.includes(normalizedKey)) {
      draft.deletedDefinitionKeys.push(normalizedKey)
    }
  })
}

export function setResourceSceneOverride(resourceKey: string, tags: SceneTagKey[]): SceneTaxonomyView {
  assertAdminEnabled()
  if (!resourceKey || typeof resourceKey !== 'string') {
    throw new Error('resourceKey is required')
  }

  const known = new Set(getState().merged.definitions.map((item) => item.key))
  const normalizedTags = normalizeSceneTagKeys(tags, known, { fallback: null })
  if (normalizedTags.length === 0) {
    throw new Error('At least one known scene tag is required')
  }

  return mutateLocalConfig((draft) => {
    draft.resourceOverrides[resourceKey] = normalizedTags
    draft.deletedOverrideKeys = draft.deletedOverrideKeys.filter((key) => key !== resourceKey)
  })
}

export function removeResourceSceneOverride(resourceKey: string): SceneTaxonomyView {
  assertAdminEnabled()
  if (!resourceKey || typeof resourceKey !== 'string') {
    throw new Error('resourceKey is required')
  }

  return mutateLocalConfig((draft) => {
    delete draft.resourceOverrides[resourceKey]
    if (!draft.deletedOverrideKeys.includes(resourceKey)) {
      draft.deletedOverrideKeys.push(resourceKey)
    }
  })
}

export function buildResourceSceneKey(input: SceneResourceKeyInput): string {
  const type = input.type.trim().toLowerCase()
  const source = input.source.trim().toLowerCase()
  const namespace = input.namespace && input.namespace.trim().length > 0 ? input.namespace.trim() : '-'
  const name = input.name.trim()
  if (!name) {
    throw new Error('Resource name is required')
  }

  let scope = '-'
  if (source === 'space') {
    const normalizedWorkDir = normalizePath(input.workDir || '')
    if (!normalizedWorkDir) {
      throw new Error('Space resource key requires workDir')
    }
    scope = createHash('sha1').update(normalizedWorkDir).digest('hex').slice(0, 12)
  }

  return `${type}:${source}:${scope}:${namespace}:${name}`
}

export function onSceneTaxonomyMutated(listener: MutationListener): () => void {
  mutationListeners.add(listener)
  return () => {
    mutationListeners.delete(listener)
  }
}

export function resetSceneTaxonomyCache(): void {
  taxonomyStateCache = null
}
