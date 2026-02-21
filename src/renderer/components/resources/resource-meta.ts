import type { LucideIcon } from 'lucide-react'
import { Bot, Terminal, Zap } from 'lucide-react'
import { commandKey } from '../../../shared/command-utils'
import { api } from '../../api'
import type { AnyResource, ResourceType } from './types'

export type AnySource = 'app' | 'global' | 'space' | 'installed' | 'plugin'

export interface ResourceMeta {
  title: string
  subtitle?: string
  path: string
  source: AnySource
  namespace?: string
  icon: LucideIcon
  iconClassName: string
  details?: string[]
}

const DISPLAY_LABEL: Record<AnySource, string> = {
  app: 'App',
  global: 'Global',
  space: 'Space',
  installed: 'Plugin',
  plugin: 'Plugin'
}

const DISPLAY_COLOR: Record<AnySource, string> = {
  app: 'bg-blue-500/10 text-blue-500',
  global: 'bg-purple-500/10 text-purple-500',
  space: 'bg-green-500/10 text-green-500',
  installed: 'bg-orange-500/10 text-orange-500',
  plugin: 'bg-orange-500/10 text-orange-500'
}

export function resourceKey(item: { name: string; namespace?: string }): string {
  return item.namespace ? `${item.namespace}:${item.name}` : item.name
}

export function getSourceLabel(source: AnySource, t: (key: string) => string): string {
  return t(DISPLAY_LABEL[source])
}

export function getSourceColor(source: AnySource): string {
  return DISPLAY_COLOR[source]
}

export function mapResourceMeta(resource: AnyResource, type: ResourceType): ResourceMeta {
  if (type === 'skill') {
    return {
      title: resourceKey(resource),
      subtitle: resource.description,
      path: resource.path,
      source: resource.source as AnySource,
      namespace: resource.namespace,
      icon: Zap,
      iconClassName: 'text-yellow-500 bg-yellow-500/10',
      details: 'triggers' in resource ? resource.triggers : undefined
    }
  }

  if (type === 'agent') {
    return {
      title: resourceKey(resource),
      subtitle: resource.description,
      path: resource.path,
      source: resource.source as AnySource,
      namespace: resource.namespace,
      icon: Bot,
      iconClassName: 'text-cyan-500 bg-cyan-500/10'
    }
  }

  return {
    title: `/${commandKey(resource)}`,
    subtitle: resource.description,
    path: resource.path,
    source: resource.source as AnySource,
    namespace: resource.namespace,
    icon: Terminal,
    iconClassName: 'text-violet-500 bg-violet-500/10'
  }
}

export function fetchResourceContent(
  resource: AnyResource,
  type: ResourceType,
  workDir?: string
) {
  const spaceWorkDir = resource.source === 'space' ? workDir : undefined

  if (type === 'skill') {
    return api.getSkillContent(resourceKey(resource), spaceWorkDir)
  }
  if (type === 'agent') {
    return api.getAgentContent(resourceKey(resource), spaceWorkDir)
  }
  return api.getCommandContent(commandKey(resource), spaceWorkDir)
}

