/**
 * Tests for multi-instance support utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import {
  getInstanceId,
  getConfigDir,
  getVitePort,
  getInstanceConfig,
  isCustomInstance
} from '../../../src/main/utils/instance'

describe('instance utilities', () => {
  // Store original env values
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Save original values
    originalEnv.HALO_INSTANCE_ID = process.env.HALO_INSTANCE_ID
    originalEnv.HALO_CONFIG_DIR = process.env.HALO_CONFIG_DIR
    originalEnv.VITE_PORT = process.env.VITE_PORT

    // Clear env vars for clean test state
    delete process.env.HALO_INSTANCE_ID
    delete process.env.HALO_CONFIG_DIR
    delete process.env.VITE_PORT
  })

  afterEach(() => {
    // Restore original values
    if (originalEnv.HALO_INSTANCE_ID !== undefined) {
      process.env.HALO_INSTANCE_ID = originalEnv.HALO_INSTANCE_ID
    } else {
      delete process.env.HALO_INSTANCE_ID
    }
    if (originalEnv.HALO_CONFIG_DIR !== undefined) {
      process.env.HALO_CONFIG_DIR = originalEnv.HALO_CONFIG_DIR
    } else {
      delete process.env.HALO_CONFIG_DIR
    }
    if (originalEnv.VITE_PORT !== undefined) {
      process.env.VITE_PORT = originalEnv.VITE_PORT
    } else {
      delete process.env.VITE_PORT
    }
  })

  // Helper to get expected default config dir (uses mocked homedir)
  function getExpectedDefaultConfigDir(): string {
    return join(homedir(), '.halo')
  }

  describe('getInstanceId', () => {
    it('should return "default" when HALO_INSTANCE_ID is not set', () => {
      expect(getInstanceId()).toBe('default')
    })

    it('should return custom instance ID when HALO_INSTANCE_ID is set', () => {
      process.env.HALO_INSTANCE_ID = 'ai-sandbox'
      expect(getInstanceId()).toBe('ai-sandbox')
    })

    it('should return empty string if HALO_INSTANCE_ID is empty', () => {
      process.env.HALO_INSTANCE_ID = ''
      expect(getInstanceId()).toBe('default')
    })
  })

  describe('getConfigDir', () => {
    it('should return ~/.halo when HALO_CONFIG_DIR is not set', () => {
      // Uses mocked homedir from test setup
      expect(getConfigDir()).toBe(getExpectedDefaultConfigDir())
    })

    it('should return custom path when HALO_CONFIG_DIR is set', () => {
      process.env.HALO_CONFIG_DIR = '/tmp/halo-test'
      expect(getConfigDir()).toBe('/tmp/halo-test')
    })

    it('should handle path with spaces', () => {
      process.env.HALO_CONFIG_DIR = '/Users/test/My Documents/.halo-ai'
      expect(getConfigDir()).toBe('/Users/test/My Documents/.halo-ai')
    })
  })

  describe('getVitePort', () => {
    it('should return 5173 when VITE_PORT is not set', () => {
      expect(getVitePort()).toBe(5173)
    })

    it('should return custom port when VITE_PORT is set', () => {
      process.env.VITE_PORT = '5174'
      expect(getVitePort()).toBe(5174)
    })

    it('should return default port for invalid port string', () => {
      process.env.VITE_PORT = 'invalid'
      expect(getVitePort()).toBe(5173)
    })

    it('should return default port for negative port', () => {
      process.env.VITE_PORT = '-1'
      expect(getVitePort()).toBe(5173)
    })

    it('should return default port for port > 65535', () => {
      process.env.VITE_PORT = '70000'
      expect(getVitePort()).toBe(5173)
    })

    it('should return default port for zero', () => {
      process.env.VITE_PORT = '0'
      expect(getVitePort()).toBe(5173)
    })

    it('should handle port at boundary (65535)', () => {
      process.env.VITE_PORT = '65535'
      expect(getVitePort()).toBe(65535)
    })
  })

  describe('getInstanceConfig', () => {
    it('should return default config when no env vars set', () => {
      const config = getInstanceConfig()
      expect(config).toEqual({
        instanceId: 'default',
        configDir: getExpectedDefaultConfigDir(),
        vitePort: 5173
      })
    })

    it('should return custom config when all env vars set', () => {
      process.env.HALO_INSTANCE_ID = 'worktree-1'
      process.env.HALO_CONFIG_DIR = '/tmp/halo-wt1'
      process.env.VITE_PORT = '5200'

      const config = getInstanceConfig()
      expect(config).toEqual({
        instanceId: 'worktree-1',
        configDir: '/tmp/halo-wt1',
        vitePort: 5200
      })
    })
  })

  describe('isCustomInstance', () => {
    it('should return false when using default instance', () => {
      expect(isCustomInstance()).toBe(false)
    })

    it('should return true when using custom instance ID', () => {
      process.env.HALO_INSTANCE_ID = 'custom'
      expect(isCustomInstance()).toBe(true)
    })
  })
})
