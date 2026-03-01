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
  it('is write-disabled in global execution mode', () => {
    expect(() => addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'coding-standards'
    })).toThrow('Toolkit write operations are deprecated and disabled')
  })
})

describe('removeToolkitResource', () => {
  it('is write-disabled in global execution mode', () => {
    expect(() => removeToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'skill-a'
    })).toThrow('Toolkit write operations are deprecated and disabled')
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
  it('is write-disabled in global execution mode', () => {
    expect(() => migrateToToolkit(
      '/test/workspace',
      ['coding-standards', 'tdd-workflow'],
      ['code-reviewer']
    )).toThrow('Toolkit write operations are deprecated and disabled')
  })
})

describe('clearSpaceToolkit', () => {
  it('is write-disabled in global execution mode', () => {
    expect(() => clearSpaceToolkit('/test/workspace')).toThrow('Toolkit write operations are deprecated and disabled')
  })
})

describe('legacy toolkit snapshot reads', () => {
  it('still loads existing toolkit entries for compatibility read path', () => {
    mockSpaceConfigs['/test/workspace'] = {
      toolkit: {
        skills: [{
          id: '',
          type: 'skill',
          name: 'test'
        }],
        commands: [],
        agents: []
      }
    }
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit?.skills).toHaveLength(1)
    expect(toolkit?.skills[0].name).toBe('test')
  })

  it('write-disabled mode does not mutate existing toolkit snapshot', () => {
    mockSpaceConfigs['/test/workspace'] = {
      toolkit: {
        skills: [{
          id: '',
          type: 'skill',
          name: 'test'
        }],
        commands: [],
        agents: []
      }
    }
    expect(() => addToolkitResource('/test/workspace', {
      id: '',
      type: 'skill',
      name: 'test'
    })).toThrow()
    const toolkit = getSpaceToolkit('/test/workspace')
    expect(toolkit?.skills).toHaveLength(1)
  })
})
