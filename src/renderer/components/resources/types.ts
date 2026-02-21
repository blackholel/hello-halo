import type { AgentDefinition } from '../../stores/agents.store'
import type { CommandDefinition } from '../../stores/commands.store'
import type { SkillDefinition } from '../../stores/skills.store'

export type ResourceType = 'skill' | 'agent' | 'command'

export type AnyResource = SkillDefinition | AgentDefinition | CommandDefinition

export type ResourceActionMode = 'toolkit' | 'copy-to-space' | 'none'

