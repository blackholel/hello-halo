import { getSpaceConfig, updateSpaceConfig, type SpaceResourcePolicy } from '../space-config.service'
import type { ResourceSource } from '../resource-ref.service'

export const DEFAULT_SPACE_RESOURCE_POLICY: SpaceResourcePolicy = {
  version: 1,
  mode: 'strict-space-only',
  allowHooks: false,
  allowMcp: false,
  allowPluginMcpDirective: false,
  allowedSources: ['space']
}

export function getSpaceResourcePolicy(workDir: string): SpaceResourcePolicy {
  const config = getSpaceConfig(workDir)
  return {
    ...DEFAULT_SPACE_RESOURCE_POLICY,
    ...(config?.resourcePolicy || {}),
    allowedSources: ['space']
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
      allowedSources: ['space']
    }
  }))

  return {
    ...DEFAULT_SPACE_RESOURCE_POLICY,
    ...(updated?.resourcePolicy || {}),
    allowedSources: ['space']
  }
}

export function isStrictSpaceOnlyPolicy(policy: SpaceResourcePolicy): boolean {
  return policy.mode === 'strict-space-only'
}

export function isSourceAllowed(policy: SpaceResourcePolicy, source?: string): boolean {
  if (!source) return false
  if (!isStrictSpaceOnlyPolicy(policy)) return true
  return source === 'space'
}

export function getAllowedSources(policy: SpaceResourcePolicy): ResourceSource[] {
  if (!isStrictSpaceOnlyPolicy(policy)) {
    return ['app', 'global', 'space', 'installed', 'plugin']
  }
  return ['space']
}
