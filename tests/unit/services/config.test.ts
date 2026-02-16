/**
 * Config Service Unit Tests
 *
 * Tests for the configuration management service.
 * Covers config loading, saving, validation, and defaults.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Import after mocks are set up
import {
  getConfig,
  saveConfig,
  getKiteDir,
  getSpacesDir,
  resolveSpacesRootFromConfigDir,
  getConfigPath,
  initializeApp
} from '../../../src/main/services/config.service'

describe('Config Service', () => {
  describe('getKiteDir', () => {
    it('should return path to .kite directory in home', () => {
      const kiteDir = getKiteDir()
      expect(kiteDir).toContain('.kite')
    })
  })

  describe('getConfigPath', () => {
    it('should return path to config.json', () => {
      const configPath = getConfigPath()
      expect(configPath).toContain('config.json')
      expect(configPath).toContain('.kite')
    })
  })

  describe('resolveSpacesRootFromConfigDir', () => {
    it('should resolve sibling kite directory for .kite config dir', () => {
      expect(resolveSpacesRootFromConfigDir('/A/.kite')).toBe(path.resolve('/A/kite'))
    })

    it('should resolve sibling kite directory for .kite config dir with trailing slash', () => {
      expect(resolveSpacesRootFromConfigDir('/A/.kite/')).toBe(path.resolve('/A/kite'))
    })

    it('should resolve nested kite directory for non-.kite config dir', () => {
      expect(resolveSpacesRootFromConfigDir('/A/custom-config')).toBe(path.resolve('/A/custom-config/kite'))
    })

    it('should resolve nested kite directory for non-.kite config dir with trailing slash', () => {
      expect(resolveSpacesRootFromConfigDir('/A/custom-config/')).toBe(path.resolve('/A/custom-config/kite'))
    })

    it('should compare basename case-insensitively on windows', () => {
      expect(resolveSpacesRootFromConfigDir('C:\\Users\\dl\\.KITE', 'win32')).toBe(path.win32.resolve('C:\\Users\\dl\\kite'))
      expect(resolveSpacesRootFromConfigDir('C:\\Users\\dl\\Custom', 'win32')).toBe(path.win32.resolve('C:\\Users\\dl\\Custom\\kite'))
    })
  })

  describe('getSpacesDir', () => {
    it('should use instance-isolated kite root derived from config dir', () => {
      const spacesDir = getSpacesDir()
      expect(spacesDir.endsWith(path.join('kite'))).toBe(true)
      expect(spacesDir.includes(path.join('.kite', 'spaces'))).toBe(false)
    })
  })

  describe('initializeApp', () => {
    it('should create necessary directories', async () => {
      await initializeApp()

      const kiteDir = getKiteDir()
      const spacesDir = getSpacesDir()
      expect(fs.existsSync(kiteDir)).toBe(true)
      expect(fs.existsSync(path.join(kiteDir, 'temp'))).toBe(true)
      expect(fs.existsSync(spacesDir)).toBe(true)
    })

    it('should create default config if not exists', async () => {
      await initializeApp()

      const configPath = getConfigPath()
      expect(fs.existsSync(configPath)).toBe(true)

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(config.api).toBeDefined()
      expect(config.permissions).toBeDefined()
    })
  })

  describe('getConfig', () => {
    it('should return default config when no config file exists', () => {
      const config = getConfig()

      expect(config.api.provider).toBe('anthropic')
      expect(config.api.apiKey).toBe('')
      expect(config.api.apiUrl).toBe('https://api.anthropic.com')
      expect(config.permissions.commandExecution).toBe('ask')
      expect(config.appearance.theme).toBe('dark')
      expect(config.isFirstLaunch).toBe(true)
      expect(config.configSourceMode).toBe('kite')
    })

    it('should merge saved config with defaults', async () => {
      await initializeApp()

      // Save partial config
      const configPath = getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify({
        api: { apiKey: 'test-key' },
        isFirstLaunch: false
      }))

      const config = getConfig()

      // Saved values
      expect(config.api.apiKey).toBe('test-key')
      expect(config.isFirstLaunch).toBe(false)

      // Default values for missing fields
      expect(config.api.provider).toBe('anthropic')
      expect(config.api.apiUrl).toBe('https://api.anthropic.com')
      expect(config.permissions.fileAccess).toBe('allow')
    })
  })

  describe('saveConfig', () => {
    beforeEach(async () => {
      await initializeApp()
    })

    it('should save config to file', () => {
      saveConfig({ api: { apiKey: 'new-key' } } as any)

      const configPath = getConfigPath()
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

      expect(saved.api.apiKey).toBe('new-key')
    })

    it('should merge with existing config', () => {
      // Save initial config
      saveConfig({ api: { apiKey: 'key1' } } as any)

      // Save another field
      saveConfig({ isFirstLaunch: false })

      const config = getConfig()
      expect(config.api.apiKey).toBe('key1')
      expect(config.isFirstLaunch).toBe(false)
    })

    it('should deep merge nested objects', () => {
      saveConfig({
        api: { apiKey: 'test-key' }
      } as any)

      saveConfig({
        api: { model: 'claude-3-opus' }
      } as any)

      const config = getConfig()
      expect(config.api.apiKey).toBe('test-key')
      expect(config.api.model).toBe('claude-3-opus')
    })

    it('should replace mcpServers entirely', () => {
      saveConfig({
        mcpServers: { server1: { command: 'cmd1' } }
      } as any)

      saveConfig({
        mcpServers: { server2: { command: 'cmd2' } }
      } as any)

      const config = getConfig()
      expect(config.mcpServers).toEqual({ server2: { command: 'cmd2' } })
    })

    it('should normalize invalid configSourceMode to kite', () => {
      saveConfig({ configSourceMode: 'bad-mode' as any } as any)

      const config = getConfig()
      expect(config.configSourceMode).toBe('kite')
    })
  })

  describe('configSourceMode normalization', () => {
    it('should fallback to kite for invalid value in config file', async () => {
      await initializeApp()
      const configPath = getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify({
        configSourceMode: 'invalid'
      }))

      const config = getConfig()
      expect(config.configSourceMode).toBe('kite')
    })
  })
})
