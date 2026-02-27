/**
 * Config Service Unit Tests
 *
 * Tests for the configuration management service.
 * Covers config loading, saving, validation, and defaults.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

// Import after mocks are set up
import {
  getConfig,
  saveConfig,
  getKiteDir,
  getSpacesDir,
  resolveSpacesRootFromConfigDir,
  resolveSeedDir,
  getConfigPath,
  initializeApp
} from '../../../src/main/services/config.service'
import { getTestDir } from '../setup'

describe('Config Service', () => {
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(thisFileDir, '../../..')

  const originalEnv = {
    seedDir: process.env.KITE_BUILTIN_SEED_DIR,
    disableSeed: process.env.KITE_DISABLE_BUILTIN_SEED,
    sourceDir: process.env.KITE_SEED_SOURCE_DIR
  }

  beforeEach(() => {
    delete process.env.KITE_BUILTIN_SEED_DIR
    process.env.KITE_DISABLE_BUILTIN_SEED = '1'
    delete process.env.KITE_SEED_SOURCE_DIR
  })

  afterEach(() => {
    if (originalEnv.seedDir === undefined) {
      delete process.env.KITE_BUILTIN_SEED_DIR
    } else {
      process.env.KITE_BUILTIN_SEED_DIR = originalEnv.seedDir
    }
    if (originalEnv.disableSeed === undefined) {
      delete process.env.KITE_DISABLE_BUILTIN_SEED
    } else {
      process.env.KITE_DISABLE_BUILTIN_SEED = originalEnv.disableSeed
    }
    if (originalEnv.sourceDir === undefined) {
      delete process.env.KITE_SEED_SOURCE_DIR
    } else {
      process.env.KITE_SEED_SOURCE_DIR = originalEnv.sourceDir
    }
  })

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

  describe('built-in seed injection', () => {
    beforeEach(() => {
      delete process.env.KITE_BUILTIN_SEED_DIR
      delete process.env.KITE_DISABLE_BUILTIN_SEED
    })

    it('should resolve seed dir from KITE_BUILTIN_SEED_DIR first', () => {
      const seedDir = path.join(getTestDir(), 'seed-env')
      fs.mkdirSync(seedDir, { recursive: true })
      process.env.KITE_BUILTIN_SEED_DIR = seedDir

      expect(resolveSeedDir()).toBe(seedDir)
    })

    it('should inject seed files without overriding existing user files', async () => {
      const kiteDir = getKiteDir()
      const seedDir = path.join(getTestDir(), 'seed')
      fs.mkdirSync(path.join(seedDir, 'skills', 'demo'), { recursive: true })
      fs.mkdirSync(path.join(seedDir, 'plugins'), { recursive: true })

      fs.writeFileSync(path.join(seedDir, 'skills', 'demo', 'SKILL.md'), 'seed skill')
      fs.writeFileSync(path.join(seedDir, 'config.json'), JSON.stringify({
        api: {
          provider: 'openai',
          apiKey: '',
          apiUrl: 'https://example.com',
          model: 'seed-model'
        },
        claudeCode: {
          hooksEnabled: false
        }
      }))
      fs.writeFileSync(path.join(seedDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
          'seed-plugin@seed-market': [{
            scope: 'user',
            installPath: '__KITE_ROOT__/plugins/cache/seed-market/seed-plugin/1.0.0',
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }))

      fs.mkdirSync(path.join(kiteDir, 'skills', 'demo'), { recursive: true })
      fs.mkdirSync(path.join(kiteDir, 'plugins'), { recursive: true })
      fs.writeFileSync(path.join(kiteDir, 'skills', 'demo', 'SKILL.md'), 'user skill')
      fs.writeFileSync(path.join(getConfigPath()), JSON.stringify({
        api: {
          provider: 'anthropic',
          apiKey: 'user-key',
          apiUrl: 'https://api.anthropic.com',
          model: 'user-model'
        }
      }))
      fs.writeFileSync(path.join(kiteDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
          'existing@market': [{
            scope: 'user',
            installPath: '/existing/path',
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }))

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      await initializeApp()

      const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
      expect(config.api.provider).toBe('anthropic')
      expect(config.api.apiKey).toBe('user-key')
      expect(config.claudeCode?.hooksEnabled).toBe(false)
      expect(fs.readFileSync(path.join(kiteDir, 'skills', 'demo', 'SKILL.md'), 'utf-8')).toBe('user skill')
      expect(fs.existsSync(path.join(kiteDir, '.seed-state.json'))).toBe(true)

      const pluginRegistry = JSON.parse(
        fs.readFileSync(path.join(kiteDir, 'plugins', 'installed_plugins.json'), 'utf-8')
      )
      expect(pluginRegistry.plugins['existing@market']).toBeDefined()
      expect(pluginRegistry.plugins['seed-plugin@seed-market'][0].installPath)
        .toBe(path.join(kiteDir, 'plugins', 'cache', 'seed-market', 'seed-plugin', '1.0.0'))
    })

    it('should skip seed injection when KITE_DISABLE_BUILTIN_SEED is enabled', async () => {
      const seedDir = path.join(getTestDir(), 'seed-disabled')
      fs.mkdirSync(seedDir, { recursive: true })
      fs.writeFileSync(path.join(seedDir, 'config.json'), JSON.stringify({
        claudeCode: {
          hooksEnabled: false
        }
      }))

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      process.env.KITE_DISABLE_BUILTIN_SEED = '1'
      await initializeApp()

      const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
      expect(config.claudeCode).toBeUndefined()
      expect(fs.existsSync(path.join(getKiteDir(), '.seed-state.json'))).toBe(false)
    })

    it('should inject only once after seed state is written', async () => {
      const kiteDir = getKiteDir()
      const seedDir = path.join(getTestDir(), 'seed-once')
      fs.mkdirSync(path.join(seedDir, 'commands'), { recursive: true })
      fs.writeFileSync(path.join(seedDir, 'commands', 'first.md'), '# first')

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      await initializeApp()
      expect(fs.existsSync(path.join(kiteDir, 'commands', 'first.md'))).toBe(true)

      fs.writeFileSync(path.join(seedDir, 'commands', 'second.md'), '# second')
      await initializeApp()
      expect(fs.existsSync(path.join(kiteDir, 'commands', 'second.md'))).toBe(false)
    })

    it('should not write seed state for empty seed and should retry on next launch', async () => {
      const kiteDir = getKiteDir()
      const seedDir = path.join(getTestDir(), 'seed-empty-then-ready')
      fs.mkdirSync(seedDir, { recursive: true })

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      await initializeApp()
      expect(fs.existsSync(path.join(kiteDir, '.seed-state.json'))).toBe(false)

      fs.mkdirSync(path.join(seedDir, 'commands'), { recursive: true })
      fs.writeFileSync(path.join(seedDir, 'commands', 'ready.md'), '# ready')

      await initializeApp()
      expect(fs.existsSync(path.join(kiteDir, 'commands', 'ready.md'))).toBe(true)
      expect(fs.existsSync(path.join(kiteDir, '.seed-state.json'))).toBe(true)
    })

    it('should fail seed prepare script when source dir is missing', () => {
      const scriptPath = path.join(projectRoot, 'scripts', 'copy-kite-seed.mjs')
      const missingSeedDir = path.join(getTestDir(), 'seed-source-missing')
      fs.rmSync(missingSeedDir, { recursive: true, force: true })

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: projectRoot,
        env: {
          ...process.env,
          KITE_SEED_SOURCE_DIR: missingSeedDir
        },
        encoding: 'utf-8'
      })

      expect(result.status).toBe(1)
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

    it('should force configSourceMode to kite when save input is claude', () => {
      saveConfig({ configSourceMode: 'claude' as any } as any)

      const configPath = getConfigPath()
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(saved.configSourceMode).toBe('kite')
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

    it('should migrate persisted claude mode to kite during initializeApp', async () => {
      await initializeApp()
      const configPath = getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify({
        configSourceMode: 'claude'
      }))

      await initializeApp()

      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(raw.configSourceMode).toBe('kite')
    })
  })
})
