import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  DEFAULT_RESOURCE_EXPOSURE,
  isResourceExposure,
  isResourceVisibleInView,
  type ResourceExposure,
  type ResourceListView,
  type ResourceType
} from '../../shared/resource-access'
import { getConfig } from './config.service'
import { getLockedUserConfigRootDir } from './config-source-mode.service'

interface ResourceExposureFile {
  version?: number
  resources?: Record<string, unknown>
  overrides?: Record<string, unknown>
  skills?: Record<string, unknown>
  agents?: Record<string, unknown>
  commands?: Record<string, unknown>
}

interface ResourceExposureConfig {
  resources: Record<string, ResourceExposure>
  byType: Record<ResourceType, Record<string, ResourceExposure>>
}

export interface ResolveResourceExposureInput {
  type: ResourceType
  source: 'app' | 'global' | 'space' | 'installed' | 'plugin'
  name: string
  namespace?: string
  workDir?: string
  frontmatterExposure?: unknown
}

interface RuntimeExposureFlags {
  exposureEnabled: boolean
  allowLegacyInternalDirect: boolean
  legacyDependencyRegexEnabled: boolean
}

let cache: ResourceExposureConfig | null = null

function getExposureFilePath(): string {
  return join(getLockedUserConfigRootDir(), 'taxonomy', 'resource-exposure.json')
}

export function getResourceExposureConfigPath(): string {
  return getExposureFilePath()
}

function normalizeRecord(input: unknown): Record<string, ResourceExposure> {
  const result: Record<string, ResourceExposure> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result

  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== 'string') continue
    const trimmedKey = key.trim()
    if (!trimmedKey) continue
    if (!isResourceExposure(value)) continue
    result[trimmedKey] = value
  }

  return result
}

function parseExposureFile(): ResourceExposureConfig {
  const filePath = getExposureFilePath()
  if (!existsSync(filePath)) {
    return {
      resources: {},
      byType: { skill: {}, agent: {}, command: {} }
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as ResourceExposureFile
    const resources = {
      ...normalizeRecord(parsed.resources),
      ...normalizeRecord(parsed.overrides)
    }

    return {
      resources,
      byType: {
        skill: normalizeRecord(parsed.skills),
        agent: normalizeRecord(parsed.agents),
        command: normalizeRecord(parsed.commands)
      }
    }
  } catch (error) {
    console.warn('[ResourceExposure] Failed to parse resource-exposure.json, fallback to defaults:', error)
    return {
      resources: {},
      byType: { skill: {}, agent: {}, command: {} }
    }
  }
}

function getConfigSnapshot(): ResourceExposureConfig {
  if (!cache) {
    cache = parseExposureFile()
  }
  return cache
}

function normalizeFrontmatterExposure(value: unknown): ResourceExposure | null {
  if (!isResourceExposure(value)) return null
  return value
}

function normalizePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
}

function buildResourceExposureKey(input: ResolveResourceExposureInput): string {
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

function buildCandidateKeys(input: ResolveResourceExposureInput): string[] {
  const namespace = input.namespace?.trim() ? input.namespace.trim() : '-'
  const candidates: string[] = []

  try {
    candidates.push(buildResourceExposureKey(input))
  } catch {
    // Ignore invalid resource key build cases.
  }

  candidates.push(`${input.type}:${namespace}:${input.name}`)
  candidates.push(`${input.type}:${input.name}`)
  if (namespace !== '-') {
    candidates.push(`${namespace}:${input.name}`)
  }
  candidates.push(input.name)

  return Array.from(new Set(candidates))
}

function findOverrideExposure(input: ResolveResourceExposureInput): ResourceExposure | null {
  const config = getConfigSnapshot()
  const keys = buildCandidateKeys(input)

  for (const key of keys) {
    const byResource = config.resources[key]
    if (byResource) return byResource
  }

  const typeOverrides = config.byType[input.type]
  for (const key of keys) {
    const byType = typeOverrides[key]
    if (byType) return byType
  }

  return null
}

export function clearResourceExposureCache(): void {
  cache = null
}

export function isResourceExposureEnabled(): boolean {
  const config = getConfig() as {
    resourceExposure?: { enabled?: boolean }
  }

  return config.resourceExposure?.enabled !== false
}

export function getResourceExposureRuntimeFlags(): RuntimeExposureFlags {
  const config = getConfig() as {
    resourceExposure?: { enabled?: boolean }
    workflow?: { allowLegacyInternalDirect?: boolean }
    commands?: { legacyDependencyRegexEnabled?: boolean }
  }

  return {
    exposureEnabled: config.resourceExposure?.enabled !== false,
    allowLegacyInternalDirect: config.workflow?.allowLegacyInternalDirect === true,
    legacyDependencyRegexEnabled: config.commands?.legacyDependencyRegexEnabled !== false
  }
}

export function resolveResourceExposure(input: ResolveResourceExposureInput): ResourceExposure {
  if (!isResourceExposureEnabled()) {
    return 'public'
  }

  const overrideExposure = findOverrideExposure(input)
  if (overrideExposure) return overrideExposure

  const frontmatterExposure = normalizeFrontmatterExposure(input.frontmatterExposure)
  if (frontmatterExposure) return frontmatterExposure

  return DEFAULT_RESOURCE_EXPOSURE[input.type]
}

export function filterByResourceExposure<T extends { exposure: ResourceExposure }>(
  resources: T[],
  view: ResourceListView
): T[] {
  if (!isResourceExposureEnabled()) return resources
  const runtimeFlags = getResourceExposureRuntimeFlags()
  return resources.filter((resource) => isResourceVisibleInView(resource.exposure, view, {
    allowLegacyWorkflowInternalDirect: runtimeFlags.allowLegacyInternalDirect
  }))
}
