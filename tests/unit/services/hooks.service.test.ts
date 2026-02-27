/**
 * Hooks Service Tests
 * TDD: Tests for hooks configuration management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock config.service
vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(),
  getKiteDir: vi.fn(() => '/home/user/.kite')
}))

// Mock space-config.service
vi.mock('../../../src/main/services/space-config.service', () => ({
  getSpaceConfig: vi.fn()
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/user/.kite')
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

import {
  buildHooksConfig,
  mergeHooksConfigs,
  convertToSdkHooksFormat,
  clearSettingsCache
} from '../../../src/main/services/hooks.service'
import { getConfig } from '../../../src/main/services/config.service'
import { getSpaceConfig } from '../../../src/main/services/space-config.service'
import { getLockedConfigSourceMode } from '../../../src/main/services/config-source-mode.service'
import type { HooksConfig, HookDefinition } from '../../../src/main/services/config.service'

const mockGetConfig = vi.mocked(getConfig)
const mockGetSpaceConfig = vi.mocked(getSpaceConfig)
const mockGetLockedConfigSourceMode = vi.mocked(getLockedConfigSourceMode)

// Helper to create hook definitions
function createHookDef(matcher: string, command: string): HookDefinition {
  return {
    matcher,
    hooks: [{ type: 'command' as const, command }]
  }
}

describe('hooks.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSettingsCache()

    // Setup default mocks
    mockGetConfig.mockReturnValue({
      claudeCode: {}
    } as ReturnType<typeof getConfig>)
    mockGetSpaceConfig.mockReturnValue(null)
    mockGetLockedConfigSourceMode.mockReturnValue('kite')
  })

  describe('mergeHooksConfigs', () => {
    it('should return undefined when all configs are undefined', () => {
      const result = mergeHooksConfigs(undefined, undefined, undefined)
      expect(result).toBeUndefined()
    })

    it('should return single config when only one is provided', () => {
      const config: HooksConfig = {
        PreToolUse: [createHookDef('*', 'echo pre')]
      }

      const result = mergeHooksConfigs(undefined, config, undefined)

      expect(result).toBeDefined()
      expect(result?.PreToolUse).toHaveLength(1)
      expect(result?.PreToolUse?.[0].matcher).toBe('*')
    })

    it('should merge PreToolUse hooks from multiple configs', () => {
      const config1: HooksConfig = {
        PreToolUse: [createHookDef('Bash', 'echo bash')]
      }
      const config2: HooksConfig = {
        PreToolUse: [createHookDef('Read', 'echo read')]
      }

      const result = mergeHooksConfigs(config1, config2)

      expect(result?.PreToolUse).toHaveLength(2)
      expect(result?.PreToolUse?.[0].matcher).toBe('Bash')
      expect(result?.PreToolUse?.[1].matcher).toBe('Read')
    })

    it('should preserve hook order (settings -> global -> space)', () => {
      const settings: HooksConfig = {
        PreToolUse: [createHookDef('first', 'echo 1')]
      }
      const global: HooksConfig = {
        PreToolUse: [createHookDef('second', 'echo 2')]
      }
      const space: HooksConfig = {
        PreToolUse: [createHookDef('third', 'echo 3')]
      }

      const result = mergeHooksConfigs(settings, global, space)

      expect(result?.PreToolUse).toHaveLength(3)
      expect(result?.PreToolUse?.[0].matcher).toBe('first')
      expect(result?.PreToolUse?.[1].matcher).toBe('second')
      expect(result?.PreToolUse?.[2].matcher).toBe('third')
    })

    it('should merge different event types from different configs', () => {
      const config1: HooksConfig = {
        PreToolUse: [createHookDef('*', 'echo pre')]
      }
      const config2: HooksConfig = {
        PostToolUse: [createHookDef('*', 'echo post')]
      }
      const config3: HooksConfig = {
        Stop: [createHookDef('*', 'echo stop')]
      }

      const result = mergeHooksConfigs(config1, config2, config3)

      expect(result?.PreToolUse).toHaveLength(1)
      expect(result?.PostToolUse).toHaveLength(1)
      expect(result?.Stop).toHaveLength(1)
    })

    it('should handle empty hooks arrays', () => {
      const config1: HooksConfig = {
        PreToolUse: []
      }
      const config2: HooksConfig = {
        PreToolUse: [createHookDef('*', 'echo test')]
      }

      const result = mergeHooksConfigs(config1, config2)

      expect(result?.PreToolUse).toHaveLength(1)
    })

    it('should merge PostToolUse hooks', () => {
      const config1: HooksConfig = {
        PostToolUse: [createHookDef('Bash', 'echo bash')]
      }
      const config2: HooksConfig = {
        PostToolUse: [createHookDef('Write', 'echo write')]
      }

      const result = mergeHooksConfigs(config1, config2)

      expect(result?.PostToolUse).toHaveLength(2)
    })

    it('should merge Stop hooks', () => {
      const config1: HooksConfig = {
        Stop: [createHookDef('*', 'echo stop1')]
      }
      const config2: HooksConfig = {
        Stop: [createHookDef('*', 'echo stop2')]
      }

      const result = mergeHooksConfigs(config1, config2)

      expect(result?.Stop).toHaveLength(2)
    })

    it('should merge Notification hooks', () => {
      const config1: HooksConfig = {
        Notification: [createHookDef('*', 'echo notify')]
      }

      const result = mergeHooksConfigs(config1)

      expect(result?.Notification).toHaveLength(1)
    })

    it('should merge UserPromptSubmit hooks', () => {
      const config1: HooksConfig = {
        UserPromptSubmit: [createHookDef('*', 'echo submit')]
      }

      const result = mergeHooksConfigs(config1)

      expect(result?.UserPromptSubmit).toHaveLength(1)
    })
  })

  describe('buildHooksConfig mode boundaries', () => {
    it('should disable hooks by default in strict space-only mode', () => {
      mockGetLockedConfigSourceMode.mockReturnValue('kite')
      mockGetConfig.mockReturnValue({
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('global', 'echo global')]
          }
        }
      } as ReturnType<typeof getConfig>)
      mockGetSpaceConfig.mockReturnValue({
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('space', 'echo space')]
          }
        }
      } as any)

      const result = buildHooksConfig('/test/workdir')
      expect(result).toBeUndefined()
    })

    it('should merge global and space hooks in kite mode when policy is legacy', () => {
      mockGetLockedConfigSourceMode.mockReturnValue('kite')
      mockGetConfig.mockReturnValue({
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('global', 'echo global')]
          }
        }
      } as ReturnType<typeof getConfig>)
      mockGetSpaceConfig.mockReturnValue({
        resourcePolicy: {
          version: 1,
          mode: 'legacy'
        },
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('space', 'echo space')]
          }
        }
      } as any)

      const result = buildHooksConfig('/test/workdir')
      expect(result?.PreToolUse).toHaveLength(2)
      expect(result?.PreToolUse?.[0].matcher).toBe('global')
      expect(result?.PreToolUse?.[1].matcher).toBe('space')
    })

    it('should keep merging global and space hooks under forced kite mode', () => {
      mockGetLockedConfigSourceMode.mockReturnValue('kite')
      mockGetConfig.mockReturnValue({
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('global', 'echo global')]
          }
        }
      } as ReturnType<typeof getConfig>)
      mockGetSpaceConfig.mockReturnValue({
        resourcePolicy: {
          version: 1,
          mode: 'legacy'
        },
        claudeCode: {
          hooks: {
            PreToolUse: [createHookDef('space', 'echo space')]
          }
        }
      } as any)

      const result = buildHooksConfig('/test/workdir')
      expect(result?.PreToolUse).toHaveLength(2)
      expect(result?.PreToolUse?.[0].matcher).toBe('global')
      expect(result?.PreToolUse?.[1].matcher).toBe('space')
    })
  })

  describe('convertToSdkHooksFormat', () => {
    it('should return undefined for undefined hooks', () => {
      const result = convertToSdkHooksFormat(undefined)
      expect(result).toBeUndefined()
    })

    it('should return undefined for empty hooks', () => {
      const result = convertToSdkHooksFormat({})
      expect(result).toBeUndefined()
    })

    it('should convert Kite hooks to SDK format', () => {
      const hooks: HooksConfig = {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo test', timeout: 5000 }]
        }]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result).toBeDefined()
      expect(result?.PreToolUse).toHaveLength(1)
      expect(result?.PreToolUse[0].matcher).toBe('Bash')
      expect(result?.PreToolUse[0].hooks[0].type).toBe('command')
      expect(result?.PreToolUse[0].hooks[0].command).toBe('echo test')
      expect(result?.PreToolUse[0].hooks[0].timeout).toBe(5000)
    })

    it('should handle multiple event types', () => {
      const hooks: HooksConfig = {
        PreToolUse: [createHookDef('*', 'echo pre')],
        PostToolUse: [createHookDef('*', 'echo post')],
        Stop: [createHookDef('*', 'echo stop')]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result?.PreToolUse).toBeDefined()
      expect(result?.PostToolUse).toBeDefined()
      expect(result?.Stop).toBeDefined()
    })

    it('should not include timeout if not specified', () => {
      const hooks: HooksConfig = {
        PreToolUse: [{
          matcher: '*',
          hooks: [{ type: 'command', command: 'echo test' }]
        }]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result?.PreToolUse[0].hooks[0]).not.toHaveProperty('timeout')
    })

    it('should handle multiple hooks per event type', () => {
      const hooks: HooksConfig = {
        PreToolUse: [
          createHookDef('Bash', 'echo bash'),
          createHookDef('Read', 'echo read'),
          createHookDef('Write', 'echo write')
        ]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result?.PreToolUse).toHaveLength(3)
    })

    it('should preserve hook definition structure', () => {
      const hooks: HooksConfig = {
        PreToolUse: [{
          matcher: 'Bash*',
          hooks: [
            { type: 'command', command: 'echo first' },
            { type: 'command', command: 'echo second', timeout: 10000 }
          ]
        }]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result?.PreToolUse[0].hooks).toHaveLength(2)
      expect(result?.PreToolUse[0].hooks[0].command).toBe('echo first')
      expect(result?.PreToolUse[0].hooks[1].timeout).toBe(10000)
    })

    it('should handle all event types', () => {
      const hooks: HooksConfig = {
        PreToolUse: [createHookDef('*', 'echo pre')],
        PostToolUse: [createHookDef('*', 'echo post')],
        Stop: [createHookDef('*', 'echo stop')],
        Notification: [createHookDef('*', 'echo notify')],
        UserPromptSubmit: [createHookDef('*', 'echo submit')]
      }

      const result = convertToSdkHooksFormat(hooks)

      expect(result?.PreToolUse).toBeDefined()
      expect(result?.PostToolUse).toBeDefined()
      expect(result?.Stop).toBeDefined()
      expect(result?.Notification).toBeDefined()
      expect(result?.UserPromptSubmit).toBeDefined()
    })
  })
})
