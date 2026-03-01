export type ResourceType = 'skill' | 'agent' | 'command'

export type ResourceSource = 'app' | 'global' | 'space' | 'installed' | 'plugin'
export type ExecutionScope = 'global-exec' | 'space-local'

export interface ResourceRef {
  type: ResourceType
  name: string
  namespace?: string
  source?: ResourceSource
  path?: string
}

export interface CopyToSpaceOptions {
  overwrite?: boolean
}

export interface CopyToSpaceResult<T> {
  status: 'copied' | 'conflict' | 'not_found'
  data?: T
  existingPath?: string
  error?: string
}

/**
 * Normalize heterogeneous resource sources into execution scopes.
 * global-exec: app/global/installed/plugin resources
 * space-local: resources created inside current workspace
 */
export function toExecutionScope(source?: string): ExecutionScope | null {
  if (!source) return null
  if (source === 'space') return 'space-local'
  if (source === 'app' || source === 'global' || source === 'installed' || source === 'plugin') {
    return 'global-exec'
  }
  return null
}
