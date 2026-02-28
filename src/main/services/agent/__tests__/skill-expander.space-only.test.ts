import { describe, expect, it, vi } from 'vitest'

const skillDefinitions = {
  'space-skill': { source: 'space', exposure: 'public' as const },
  'app-skill': { source: 'app', exposure: 'public' as const }
}

const commandDefinitions = {
  'space-command': { source: 'space', exposure: 'public' as const },
  'space-command-with-skill': {
    source: 'space',
    exposure: 'public' as const,
    requiresSkills: ['space-skill']
  },
  'app-command': { source: 'app', exposure: 'public' as const }
}

const agentDefinitions = {
  'space-agent': { source: 'space', exposure: 'public' as const },
  'app-agent': { source: 'app', exposure: 'public' as const }
}

vi.mock('../../skills.service', () => ({
  getSkillDefinition: vi.fn((name: string) => (
    (skillDefinitions as Record<string, { source: string }>)[name] || null
  )),
  getSkillContent: vi.fn((name: string) => {
    if (!(name in skillDefinitions)) return null
    return { name, content: `# ${name}` }
  })
}))

vi.mock('../../commands.service', () => ({
  getCommand: vi.fn((name: string) => (
    (commandDefinitions as Record<string, { source: string; requiresSkills?: string[] }>)[name] || null
  )),
  getCommandContent: vi.fn((name: string) => {
    if (!(name in commandDefinitions)) return null
    return `# ${name}`
  })
}))

vi.mock('../../agents.service', () => ({
  getAgent: vi.fn((name: string) => (
    (agentDefinitions as Record<string, { source: string }>)[name] || null
  )),
  getAgentContent: vi.fn((name: string) => {
    if (!(name in agentDefinitions)) return null
    return `# ${name}`
  })
}))

import { expandLazyDirectives } from '../skill-expander'

describe('skill-expander strict allowSources', () => {
  it('expands space resources when allowSources is space-only', () => {
    const result = expandLazyDirectives('/space-skill\n@space-agent', undefined, {
      allowSources: ['space']
    })

    expect(result.expanded.skills).toEqual(['space-skill'])
    expect(result.expanded.agents).toEqual(['space-agent'])
    expect(result.missing.skills).toEqual([])
    expect(result.missing.agents).toEqual([])
  })

  it('blocks non-space skill/agent/command when allowSources is space-only', () => {
    const result = expandLazyDirectives('/app-skill\n@app-agent\n/app-command', undefined, {
      allowSources: ['space']
    })

    expect(result.expanded.skills).toEqual([])
    expect(result.expanded.agents).toEqual([])
    expect(result.expanded.commands).toEqual([])
    expect(result.missing.skills).toEqual(['app-skill'])
    expect(result.missing.agents).toEqual(['app-agent'])
    expect(result.missing.commands).toEqual(['app-command'])
  })

  it('allows non-space resources when allowSources is not specified', () => {
    const result = expandLazyDirectives('/app-skill\n@app-agent\n/app-command')

    expect(result.expanded.skills).toEqual(['app-skill'])
    expect(result.expanded.agents).toEqual(['app-agent'])
    expect(result.expanded.commands).toEqual(['app-command'])
  })

  it('passes command args to explicit required skills', () => {
    const result = expandLazyDirectives('/space-command-with-skill target=prod')

    expect(result.expanded.skills).toEqual(['space-skill'])
    expect(result.expanded.commands).toEqual(['space-command-with-skill'])
    expect(result.text).toContain('<skill name="space-skill" args="target=prod">')
  })
})
