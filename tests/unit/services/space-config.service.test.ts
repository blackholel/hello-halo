/**
 * Space Config Service Tests
 * TDD: Tests for space-level configuration management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock hooks.service
vi.mock('../../../src/main/services/hooks.service', () => ({
  mergeHooksConfigs: vi.fn((...configs) => {
    // Simple merge implementation for testing
    const merged: Record<string, any[]> = {}
    for (const config of configs) {
      if (!config) continue
      for (const [key, value] of Object.entries(config)) {
        if (Array.isArray(value) && value.length > 0) {
          if (!merged[key]) merged[key] = []
          merged[key].push(...value)
        }
      }
    }
    return Object.keys(merged).length > 0 ? merged : undefined
  })
}))

import {
  mergeClaudeCodeConfigs,
  mergeMcpServers,
  clearSpaceConfigCache
} from '../../../src/main/services/space-config.service'
import type { SpaceClaudeCodeConfig } from '../../../src/main/services/space-config.service'
import type { ClaudeCodeConfig, HooksConfig } from '../../../src/main/services/config.service'

// Helper to create hook definitions
function createHookDef(matcher: string, command: string) {
  return {
    matcher,
    hooks: [{ type: 'command' as const, command }]
  }
}

describe('space-config.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSpaceConfigCache()
  })

  describe('mergeClaudeCodeConfigs', () => {
    it('should return empty object when both configs are undefined', () => {
      const result = mergeClaudeCodeConfigs(undefined, undefined)
      expect(result).toEqual({})
    })

    it('should return global config when space is undefined', () => {
      const global: ClaudeCodeConfig = {
        plugins: {
          enabled: true,
          globalPaths: ['/path/to/plugins']
        }
      }

      const result = mergeClaudeCodeConfigs(global, undefined)

      expect(result).toEqual(global)
    })

    it('should convert space config when global is undefined', () => {
      const space: SpaceClaudeCodeConfig = {
        plugins: {
          paths: ['/space/plugins'],
          loadDefaultPath: false
        }
      }

      const result = mergeClaudeCodeConfigs(undefined, space)

      expect(result.plugins?.globalPaths).toEqual(['/space/plugins'])
      expect(result.plugins?.loadDefaultPaths).toBe(false)
    })

    it('should merge hooks using mergeHooksConfigs', () => {
      const global: ClaudeCodeConfig = {
        hooks: {
          PreToolUse: [createHookDef('global', 'echo global')]
        }
      }
      const space: SpaceClaudeCodeConfig = {
        hooks: {
          PreToolUse: [createHookDef('space', 'echo space')]
        }
      }

      const result = mergeClaudeCodeConfigs(global, space)

      expect(result.hooks?.PreToolUse).toHaveLength(2)
    })

    it('should allow space to override loadDefaultPaths', () => {
      const global: ClaudeCodeConfig = {
        plugins: {
          enabled: true,
          loadDefaultPaths: true
        }
      }
      const space: SpaceClaudeCodeConfig = {
        plugins: {
          loadDefaultPath: false
        }
      }

      const result = mergeClaudeCodeConfigs(global, space)

      expect(result.plugins?.loadDefaultPaths).toBe(false)
    })

    it('should preserve global plugins.enabled', () => {
      const global: ClaudeCodeConfig = {
        plugins: {
          enabled: true,
          globalPaths: ['/global/path']
        }
      }
      const space: SpaceClaudeCodeConfig = {
        plugins: {
          paths: ['/space/path']
        }
      }

      const result = mergeClaudeCodeConfigs(global, space)

      expect(result.plugins?.enabled).toBe(true)
    })

    it('should preserve global plugins.globalPaths', () => {
      const global: ClaudeCodeConfig = {
        plugins: {
          globalPaths: ['/global/path1', '/global/path2']
        }
      }
      const space: SpaceClaudeCodeConfig = {}

      const result = mergeClaudeCodeConfigs(global, space)

      expect(result.plugins?.globalPaths).toEqual(['/global/path1', '/global/path2'])
    })

    it('should handle space with only hooks', () => {
      const global: ClaudeCodeConfig = {
        plugins: { enabled: true }
      }
      const space: SpaceClaudeCodeConfig = {
        hooks: {
          PostToolUse: [createHookDef('*', 'echo post')]
        }
      }

      const result = mergeClaudeCodeConfigs(global, space)

      expect(result.plugins?.enabled).toBe(true)
      expect(result.hooks?.PostToolUse).toBeDefined()
    })
  })

  describe('mergeMcpServers', () => {
    it('should return empty object when both are undefined', () => {
      const result = mergeMcpServers(undefined, undefined)
      expect(result).toEqual({})
    })

    it('should return global servers when space is undefined', () => {
      const global = {
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' }
      }

      const result = mergeMcpServers(global, undefined)

      expect(result).toEqual(global)
    })

    it('should return space servers when global is undefined', () => {
      const space = {
        server1: { command: 'space-cmd1' }
      }

      const result = mergeMcpServers(undefined, space)

      expect(result).toEqual(space)
    })

    it('should override global servers with space servers', () => {
      const global = {
        server1: { command: 'global-cmd1' },
        server2: { command: 'global-cmd2' }
      }
      const space = {
        server1: { command: 'space-cmd1' }  // Override server1
      }

      const result = mergeMcpServers(global, space)

      expect(result.server1.command).toBe('space-cmd1')
      expect(result.server2.command).toBe('global-cmd2')
    })

    it('should add new space servers', () => {
      const global = {
        server1: { command: 'cmd1' }
      }
      const space = {
        server2: { command: 'cmd2' }
      }

      const result = mergeMcpServers(global, space)

      expect(result.server1).toBeDefined()
      expect(result.server2).toBeDefined()
    })

    it('should handle disabled servers from space', () => {
      const global = {
        server1: { command: 'cmd1' }
      }
      const space = {
        server1: { command: 'cmd1', disabled: true }
      }

      const result = mergeMcpServers(global, space)

      expect(result.server1.disabled).toBe(true)
    })

    it('should preserve all server properties', () => {
      const global = {
        server1: {
          command: 'cmd1',
          args: ['--arg1'],
          env: { KEY: 'value' },
          timeout: 5000
        }
      }
      const space = {
        server2: {
          type: 'http' as const,
          url: 'http://localhost:8080',
          headers: { 'X-API-Key': 'secret' }
        }
      }

      const result = mergeMcpServers(global, space)

      expect(result.server1.args).toEqual(['--arg1'])
      expect(result.server1.env).toEqual({ KEY: 'value' })
      expect(result.server2.type).toBe('http')
      expect(result.server2.url).toBe('http://localhost:8080')
    })
  })

  describe('clearSpaceConfigCache', () => {
    it('should be callable without arguments', () => {
      expect(() => clearSpaceConfigCache()).not.toThrow()
    })

    it('should be callable with workDir argument', () => {
      expect(() => clearSpaceConfigCache('/some/path')).not.toThrow()
    })
  })
})
