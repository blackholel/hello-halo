import type { AgentDefinition } from '../../stores/agents.store'
import type { CommandDefinition } from '../../stores/commands.store'
import type { SkillDefinition } from '../../stores/skills.store'
import { commandKey } from '../../../shared/command-utils'
import type { ResourceType } from './types'
import type { TemplateLibraryTab } from '../../types/template-library'

export type FilterTab = 'all' | 'skills' | 'agents' | 'commands'

export interface ExtensionItem {
  id: string
  type: ResourceType
  resource: SkillDefinition | AgentDefinition | CommandDefinition
  searchable: string
  displayName: string
}

const FILTER_TO_TYPE: Record<FilterTab, ResourceType | null> = {
  all: null,
  skills: 'skill',
  agents: 'agent',
  commands: 'command'
}

const TYPE_PRIORITY: Record<ResourceType, number> = {
  skill: 0,
  agent: 1,
  command: 2
}

const SOURCE_PRIORITY: Record<string, number> = {
  app: 0,
  global: 1,
  installed: 2,
  plugin: 2,
  space: 3
}

export function mapTemplateTabToFilter(tab: TemplateLibraryTab): FilterTab {
  if (tab === 'agents') return 'agents'
  if (tab === 'commands') return 'commands'
  return 'skills'
}

export function buildTemplateFilterState(tab: TemplateLibraryTab): {
  activeFilter: FilterTab
  query: string
} {
  return {
    activeFilter: mapTemplateTabToFilter(tab),
    query: ''
  }
}

export function shouldShowRemoteCommandsUnavailable(isRemote: boolean, activeFilter: FilterTab): boolean {
  return isRemote && (activeFilter === 'commands' || activeFilter === 'all')
}

export function normalizeExtensionItems(params: {
  skills: SkillDefinition[]
  agents: AgentDefinition[]
  commands: CommandDefinition[]
  isRemote: boolean
}): ExtensionItem[] {
  const skillItems: ExtensionItem[] = params.skills.map((skill) => {
    const displayBase = skill.displayName || skill.name
    const displayName = skill.namespace ? `${skill.namespace}:${displayBase}` : displayBase
    return {
      id: `skill:${skill.namespace ?? '-'}:${skill.name}`,
      type: 'skill',
      resource: skill,
      searchable: [
        skill.name,
        skill.displayName,
        skill.namespace,
        skill.description,
        skill.category,
        ...(skill.triggers || [])
      ].filter(Boolean).join(' ').toLowerCase(),
      displayName
    }
  })

  const agentItems: ExtensionItem[] = params.agents.map((agent) => {
    const displayBase = agent.displayName || agent.name
    const displayName = agent.namespace ? `${agent.namespace}:${displayBase}` : displayBase
    return {
      id: `agent:${agent.namespace ?? '-'}:${agent.name}`,
      type: 'agent',
      resource: agent,
      searchable: [agent.name, agent.displayName, agent.namespace, agent.description].filter(Boolean).join(' ').toLowerCase(),
      displayName
    }
  })

  const commandItems: ExtensionItem[] = (params.isRemote ? [] : params.commands).map((command) => {
    const displayBase = command.displayName || command.name
    // Display should stay clean for users; keep namespace only in command key/search, not title.
    const displayName = `/${displayBase}`
    return {
      id: `command:${command.namespace ?? '-'}:${command.name}`,
      type: 'command',
      resource: command,
      searchable: [commandKey(command), command.displayName, command.description].filter(Boolean).join(' ').toLowerCase(),
      displayName
    }
  })

  return [...skillItems, ...agentItems, ...commandItems]
}

export function applyTypeAndSearchFilter(items: ExtensionItem[], activeFilter: FilterTab, query: string): ExtensionItem[] {
  const filterType = FILTER_TO_TYPE[activeFilter]
  const normalizedQuery = query.trim().toLowerCase()

  return items.filter((item) => {
    if (filterType && item.type !== filterType) return false
    if (!normalizedQuery) return true
    return item.searchable.includes(normalizedQuery)
  })
}

export function sortExtensions(items: ExtensionItem[]): ExtensionItem[] {
  return [...items].sort((a, b) => {
    const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
    if (typeDiff !== 0) return typeDiff

    const sourceA = (a.resource.source ?? '') as string
    const sourceB = (b.resource.source ?? '') as string
    const sourceDiff = (SOURCE_PRIORITY[sourceA] ?? 999) - (SOURCE_PRIORITY[sourceB] ?? 999)
    if (sourceDiff !== 0) return sourceDiff

    return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
  })
}

export function groupByType(items: ExtensionItem[]): Record<ResourceType, ExtensionItem[]> {
  const groups: Record<ResourceType, ExtensionItem[]> = {
    skill: [],
    agent: [],
    command: []
  }

  for (const item of items) {
    groups[item.type].push(item)
  }

  return groups
}

export function computeTypeCounts(items: ExtensionItem[]): Record<ResourceType, number> {
  const counts: Record<ResourceType, number> = {
    skill: 0,
    agent: 0,
    command: 0
  }

  for (const item of items) {
    counts[item.type] += 1
  }

  return counts
}
