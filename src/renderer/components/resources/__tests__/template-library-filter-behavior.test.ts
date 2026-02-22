import { describe, expect, it } from 'vitest'
import {
  buildTemplateFilterState,
  shouldShowRemoteCommandsUnavailable
} from '../extension-filtering'

describe('template library filter behavior', () => {
  it('keeps entry tab mapping and clears query on tab state build', () => {
    const skillsState = buildTemplateFilterState('skills')
    const agentsState = buildTemplateFilterState('agents')
    const commandsState = buildTemplateFilterState('commands')

    expect(skillsState).toEqual({ activeFilter: 'skills', query: '', sceneFilter: 'all' })
    expect(agentsState).toEqual({ activeFilter: 'agents', query: '', sceneFilter: 'all' })
    expect(commandsState).toEqual({ activeFilter: 'commands', query: '', sceneFilter: 'all' })
  })

  it('keeps remote commands limitation independent from scene filter', () => {
    expect(shouldShowRemoteCommandsUnavailable(true, 'all')).toBe(true)
    expect(shouldShowRemoteCommandsUnavailable(true, 'commands')).toBe(true)
    expect(shouldShowRemoteCommandsUnavailable(true, 'skills')).toBe(false)
    expect(shouldShowRemoteCommandsUnavailable(false, 'commands')).toBe(false)
  })
})
