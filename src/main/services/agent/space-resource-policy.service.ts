import { getSpaceConfig, updateSpaceConfig, type SpaceResourcePolicy } from '../space-config.service'
import { toExecutionScope, type ResourceSource } from '../resource-ref.service'

const EXECUTION_LAYER_ALLOWED_SOURCES: ResourceSource[] = ['app', 'global', 'space', 'installed', 'plugin']

export const DEFAULT_SPACE_RESOURCE_POLICY: SpaceResourcePolicy = {
  version: 1,
  mode: 'strict-space-only',
  allowMcp: true,
  allowPluginMcpDirective: true,
  allowedSources: [...EXECUTION_LAYER_ALLOWED_SOURCES]
}

function normalizeAllowedSources(sources?: ResourceSource[]): ResourceSource[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [...EXECUTION_LAYER_ALLOWED_SOURCES]
  }
  const normalized = sources.filter((source): source is ResourceSource => (
    EXECUTION_LAYER_ALLOWED_SOURCES.includes(source)
  ))
  return normalized.length > 0 ? normalized : [...EXECUTION_LAYER_ALLOWED_SOURCES]
}

export function getSpaceResourcePolicy(workDir: string): SpaceResourcePolicy {
  const config = getSpaceConfig(workDir)
  const merged = {
    ...DEFAULT_SPACE_RESOURCE_POLICY,
    ...(config?.resourcePolicy || {})
  }
  return {
    ...merged,
    allowedSources: normalizeAllowedSources(merged.allowedSources as ResourceSource[] | undefined)
  }
}

export function ensureSpaceResourcePolicy(workDir: string): SpaceResourcePolicy {
  const existing = getSpaceConfig(workDir)?.resourcePolicy
  if (existing?.version === DEFAULT_SPACE_RESOURCE_POLICY.version && (existing.mode === 'strict-space-only' || existing.mode === 'legacy')) {
    return getSpaceResourcePolicy(workDir)
  }

  const updated = updateSpaceConfig(workDir, (config) => ({
    ...config,
    resourcePolicy: {
      ...DEFAULT_SPACE_RESOURCE_POLICY,
      ...(config.resourcePolicy || {}),
      version: DEFAULT_SPACE_RESOURCE_POLICY.version,
      mode: config.resourcePolicy?.mode === 'legacy' ? 'legacy' : 'strict-space-only',
      allowedSources: normalizeAllowedSources(config.resourcePolicy?.allowedSources as ResourceSource[] | undefined)
    }
  }))

  const merged = {
    ...DEFAULT_SPACE_RESOURCE_POLICY,
    ...(updated?.resourcePolicy || {})
  }
  return {
    ...merged,
    allowedSources: normalizeAllowedSources(merged.allowedSources as ResourceSource[] | undefined)
  }
}

export function isStrictSpaceOnlyPolicy(policy: SpaceResourcePolicy): boolean {
  return policy.mode === 'strict-space-only'
}

export function isSourceAllowed(policy: SpaceResourcePolicy, source?: string): boolean {
  if (!source) return false
  const scope = toExecutionScope(source)
  if (!scope) return false
  const allowedSources = normalizeAllowedSources(policy.allowedSources as ResourceSource[] | undefined)
  return allowedSources.includes(source as ResourceSource)
}

export function getAllowedSources(policy: SpaceResourcePolicy): ResourceSource[] {
  return normalizeAllowedSources(policy.allowedSources as ResourceSource[] | undefined)
}

/**
 * Runtime directive expansion should always be able to resolve global resources
 * from ~/.kite as well as current space resources.
 * Direct invocation safety is still controlled by exposure rules.
 */
export function getExecutionLayerAllowedSources(): ResourceSource[] {
  return [...EXECUTION_LAYER_ALLOWED_SOURCES]
}
