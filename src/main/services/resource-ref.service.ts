export type ResourceType = 'skill' | 'agent' | 'command'

export type ResourceSource = 'app' | 'global' | 'space' | 'installed' | 'plugin'

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
