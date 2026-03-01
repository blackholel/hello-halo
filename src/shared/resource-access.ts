export type ResourceType = 'skill' | 'agent' | 'command'
export type ResourceKind = 'skills' | 'agents' | 'commands'

export type ResourceExposure = 'public' | 'internal-only'

export const RESOURCE_EXPOSURES: ResourceExposure[] = ['public', 'internal-only']

export function isResourceExposure(value: unknown): value is ResourceExposure {
  return typeof value === 'string' && (RESOURCE_EXPOSURES as string[]).includes(value)
}

export const DEFAULT_RESOURCE_EXPOSURE: Record<ResourceType, ResourceExposure> = {
  skill: 'internal-only',
  agent: 'internal-only',
  command: 'public'
}

export type ResourceListView =
  | 'extensions'
  | 'composer'
  | 'template-library'
  | 'taxonomy-admin'
  | 'workflow-validation'
  | 'runtime-direct'
  | 'runtime-command-dependency'

export const RESOURCE_LIST_VIEWS: ResourceListView[] = [
  'extensions',
  'composer',
  'template-library',
  'taxonomy-admin',
  'workflow-validation',
  'runtime-direct',
  'runtime-command-dependency'
]

export function isResourceListView(value: unknown): value is ResourceListView {
  return typeof value === 'string' && (RESOURCE_LIST_VIEWS as string[]).includes(value)
}

export interface ResourceVisibilityOptions {
  allowLegacyWorkflowInternalDirect?: boolean
}

export function viewAllowsInternalResources(
  view: ResourceListView,
  options?: ResourceVisibilityOptions
): boolean {
  if (view === 'workflow-validation') {
    return options?.allowLegacyWorkflowInternalDirect === true
  }

  if (view === 'taxonomy-admin' || view === 'runtime-command-dependency') {
    return true
  }

  return false
}

export function isResourceVisibleInView(
  exposure: ResourceExposure,
  view: ResourceListView,
  options?: ResourceVisibilityOptions
): boolean {
  if (exposure === 'public') return true
  return viewAllowsInternalResources(view, options)
}

export type InvocationContext = 'interactive' | 'workflow-step' | 'command-dependency'

export function isInvocationContext(value: unknown): value is InvocationContext {
  return value === 'interactive' || value === 'workflow-step' || value === 'command-dependency'
}

export type ResourceRefreshReason =
  | 'file-change'
  | 'plugin-registry-change'
  | 'settings-change'
  | 'resource-exposure-change'
  | 'manual-refresh'
  | 'install-complete'

export interface ResourceChangedPayload {
  workDir?: string | null
  reason?: ResourceRefreshReason
  ts?: string
  resources?: ResourceKind[]
}

export interface ResourceIndexSnapshot {
  hash: string
  generatedAt: string
  reason: ResourceRefreshReason
  counts: {
    skills: number
    agents: number
    commands: number
  }
}
