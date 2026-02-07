/**
 * Unit Tests for Toolkit Service
 *
 * Tests toolkit CRUD operations, namespace resolution, and migration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock space-config.service
const mockSpaceConfigs: Record<string, Record<string, unknown>> = {}

type Config = Record<string, unknown>

vi.mock('../space-config.service', () => ({
  getSpaceConfig: vi.fn((workDir: string) => mockSpaceConfigs[workDir] || null),
  updateSpaceConfig: vi.fn((workDir: string, updater: (config: Config) => Config) => {
    const updated = updater(mockSpaceConfigs[workDir] || {})
    mockSpaceConfigs[workDir] = updated
    return updated
  })
}))

import {
  buildDirectiveId,
  getSpaceToolkit,
  addToolkitResource,
  removeToolkitResource,
  clearSpaceToolkit,
  toolkitContains,
  migrateToToolkit
} from '../toolkit.service'

beforeEach(() => {
  for (const key of Object.keys(mockSpaceConfigs)) delete mockSpaceConfigs[key]
})

describe('buildDirectiveId', () => {
  it('builds id with all fields', () => {
    const id = buildDirectiveId({ type: 'skill', name: 'coding-standards', source: 'app', namespace: 'superpowers' })
    expect(id).toBe('skill:app:superpowers:coding-standards')
  })

  it('uses - for missing source and namespace', () => {
    const id = buildDirectiveId({ type: 'agent', name: 'debugger' })
    expect(id).toBe('agent:-:-:debugger')
  })
})

describe('getSpaceToolkit', () => {
  it('returns null when no config exists', () => {
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit).toBeNull()
  })

  it('returns null when config has no toolkit', () => {
    mockSpaceConfigs['/test/workspace'] = { claudeCode: {} }
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit).toBeNull()
  })

  it('returns toolkit when configured', () => {
    mockSpaceConfigs['/test/workspace'] = {
      toolkit: {
        skills: [{ id: 'skill:-:-:test', type: 'skill', name: 'test' }],
        commands: [],
        agents: []
      }
    }
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit).not.toBeNull()
    expect(toolkit!.skills).toHaveLength(1)
    expect(toolkit!.skills[0].name).toBe('test')
  })

  it('deduplicates entries', () => {
    mockSpaceConfigs['/test/workspace'] = {
      toolkit: {
        skills: [
          { id: 'skill:-:-:test', type: 'skill', name: 'test' },
          { id: 'skill:-:-:test', type: 'skill', name: 'test' }
        ],
        commands: [],
        agents: []
      }
    }
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit!.skills).toHaveLength(1)
  })
})

describe('addToolkitResource', () => {
  it('creates toolkit when adding to empty space', () => {
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'coding-standards'
    })
    const config = mockSpaceConfigs['/test/workspace'] as { toolkit?: { skills: unknown[] } }
    expect(config.toolkit).toBeDefined()
    expect(config.toolkit!.skills).toHaveLength(1)
  })

  it('does not duplicate entries', () => {
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'coding-standards'
    })
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'coding-standards'
    })
    const config = mockSpaceConfigs['/test/workspace'] as { toolkit?: { skills: unknown[] } }
    expect(config.toolkit!.skills).toHaveLength(1)
  })
})

describe('removeToolkitResource', () => {
  it('removes a resource from toolkit', () => {
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'skill-a'
    })
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'skill-b'
    })
    removeToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'skill-a'
    })
    const config = mockSpaceConfigs['/test/workspace'] as { toolkit?: { skills: Array<{ name: string }> } }
    expect(config.toolkit!.skills).toHaveLength(1)
    expect(config.toolkit!.skills[0].name).toBe('skill-b')
  })
})

describe('toolkitContains', () => {
  it('returns false for null toolkit', () => {
    expect(toolkitContains(null, 'skill', { name: 'test' })).toBe(false)
  })

  it('returns true when resource exists', () => {
    const toolkit = {
      skills: [{ id: 'skill:-:-:test', type: 'skill' as const, name: 'test' }],
      commands: [],
      agents: []
    }
    expect(toolkitContains(toolkit, 'skill', { name: 'test' })).toBe(true)
  })

  it('returns false when resource does not exist', () => {
    const toolkit = {
      skills: [{ id: 'skill:-:-:test', type: 'skill' as const, name: 'test' }],
      commands: [],
      agents: []
    }
    expect(toolkitContains(toolkit, 'skill', { name: 'other' })).toBe(false)
  })

  it('distinguishes between types', () => {
    const toolkit = {
      skills: [{ id: 'skill:-:-:test', type: 'skill' as const, name: 'test' }],
      commands: [],
      agents: []
    }
    expect(toolkitContains(toolkit, 'command', { name: 'test' })).toBe(false)
  })
})

describe('migrateToToolkit', () => {
  it('migrates enabled skills and agents to toolkit', () => {
    const result = migrateToToolkit(
      '/test/workspace',
      ['coding-standards', 'tdd-workflow'],
      ['code-reviewer']
    )
    expect(result).not.toBeNull()
    expect(result!.skills).toHaveLength(2)
    expect(result!.agents).toHaveLength(1)
    expect(result!.commands).toHaveLength(0)
    expect(result!.skills[0].name).toBe('coding-standards')
    expect(result!.agents[0].name).toBe('code-reviewer')
  })

  it('handles empty arrays', () => {
    const result = migrateToToolkit('/test/workspace', [], [])
    expect(result).not.toBeNull()
    expect(result!.skills).toHaveLength(0)
    expect(result!.agents).toHaveLength(0)
  })
})

describe('clearSpaceToolkit', () => {
  it('removes toolkit from config', () => {
    addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'test'
    })
    clearSpaceToolkit('/test/workspace')
    const config = mockSpaceConfigs['/test/workspace'] as { toolkit?: unknown }
    expect(config.toolkit).toBeUndefined()
  })
})
