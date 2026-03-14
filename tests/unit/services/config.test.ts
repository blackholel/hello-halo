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
  initializeApp,
  validateApiConnection
} from '../../../src/main/services/config.service'
import { getTestDir } from '../setup'

const LEGACY_TAXONOMY_KEY = 'extension' + 'Taxonomy'

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

  describe('validateApiConnection', () => {
    const createFetchResponse = (status: number, body: unknown = '') => ({
      ok: status >= 200 && status < 300,
      status,
      json: vi.fn(async () => (typeof body === 'string' ? {} : body)),
      text: vi.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body)))
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('should treat 400 from configured endpoint as valid for openai_compat', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createFetchResponse(400, { detail: 'Input must be a list' })
      )
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-test',
        'https://api.tabcode.cc/openai/responses',
        'openai_compat',
        'openai_compat'
      )

      expect(result.valid).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tabcode.cc/openai/responses',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('should send test model in endpoint probe when model is provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createFetchResponse(200, { id: 'ok' })
      )
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-test',
        'https://api.tabcode.cc/openai/responses',
        'openai_compat',
        'openai_compat',
        'gpt-5.4'
      )

      expect(result.valid).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tabcode.cc/openai/responses',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            model: 'gpt-5.4',
            input: 'ping',
            max_output_tokens: 1
          })
        })
      )
    })

    it('should fail when endpoint reports test model not found', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createFetchResponse(400, {
          error: {
            message: 'Model gpt-unknown not found'
          }
        })
      )
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-test',
        'https://api.tabcode.cc/openai/responses',
        'openai_compat',
        'openai_compat',
        'gpt-unknown'
      )

      expect(result.valid).toBe(false)
      expect(result.message).toContain('not found')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should fail fast on 401 from configured endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createFetchResponse(401, 'Missing or invalid API Key')
      )
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-bad',
        'https://api.tabcode.cc/openai/responses',
        'openai_compat',
        'openai_compat'
      )

      expect(result.valid).toBe(false)
      expect(result.message).toContain('Missing or invalid API Key')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should fallback to /models when endpoint probe fails', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(createFetchResponse(404, 'Cannot POST /openai/responses'))
        .mockResolvedValueOnce(createFetchResponse(200, { data: [{ id: 'gpt-5.3-codex' }] }))
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-test',
        'https://api.tabcode.cc/openai/responses',
        'openai_compat',
        'openai_compat'
      )

      expect(result.valid).toBe(true)
      expect(result.model).toBe('gpt-5.3-codex')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.tabcode.cc/openai/v1/models',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('should use provided test model for anthropic-compatible validation', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createFetchResponse(200, { model: 'glm-4.7' })
      )
      vi.stubGlobal('fetch', fetchMock as any)

      const result = await validateApiConnection(
        'sk-test',
        'https://open.bigmodel.cn/api/anthropic',
        'anthropic_compat',
        'anthropic_compat',
        'glm-4.7'
      )

      expect(result.valid).toBe(true)
      expect(result.model).toBe('glm-4.7')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/anthropic/v1/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            model: 'glm-4.7',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }]
          })
        })
      )
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

    it('should inject only registered plugin directories from seed registry', async () => {
      const kiteDir = getKiteDir()
      const seedDir = path.join(getTestDir(), 'seed-registered-plugins-only')
      const registeredPluginDir = path.join(seedDir, 'plugins', 'registered-plugin', 'commands')
      const unregisteredPluginDir = path.join(seedDir, 'plugins', 'unregistered-plugin', 'commands')
      fs.mkdirSync(registeredPluginDir, { recursive: true })
      fs.mkdirSync(unregisteredPluginDir, { recursive: true })
      fs.writeFileSync(path.join(registeredPluginDir, 'registered.md'), '# registered')
      fs.writeFileSync(path.join(unregisteredPluginDir, 'unregistered.md'), '# unregistered')
      fs.writeFileSync(path.join(seedDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
          'registered-plugin@seed-market': [{
            scope: 'user',
            installPath: '__KITE_ROOT__/plugins/registered-plugin',
            version: '1.0.0'
          }]
        }
      }))

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      await initializeApp()

      expect(fs.existsSync(path.join(kiteDir, 'plugins', 'registered-plugin', 'commands', 'registered.md'))).toBe(true)
      expect(fs.existsSync(path.join(kiteDir, 'plugins', 'unregistered-plugin', 'commands', 'unregistered.md'))).toBe(false)
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

    it('should inject non-whitelisted seed entries and ignore seed metadata', async () => {
      const kiteDir = getKiteDir()
      const seedDir = path.join(getTestDir(), 'seed-full')
      fs.mkdirSync(path.join(seedDir, 'custom-bundles', 'demo'), { recursive: true })
      fs.writeFileSync(path.join(seedDir, 'custom-bundles', 'demo', 'readme.md'), 'bundle content')
      fs.writeFileSync(path.join(seedDir, 'seed-manifest.json'), JSON.stringify({ source: 'seed' }))

      process.env.KITE_BUILTIN_SEED_DIR = seedDir
      await initializeApp()

      expect(fs.existsSync(path.join(kiteDir, 'custom-bundles', 'demo', 'readme.md'))).toBe(true)
      expect(fs.existsSync(path.join(kiteDir, 'seed-manifest.json'))).toBe(false)
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

    it('should package allowlisted seed entries while removing sensitive and cache data', () => {
      const scriptPath = path.join(projectRoot, 'scripts', 'copy-kite-seed.mjs')
      const sourceSeedDir = path.join(getTestDir(), 'seed-source-full-copy')
      const outputDir = path.join(projectRoot, 'build', 'default-kite-config')
      const backupOutputDir = path.join(getTestDir(), 'seed-output-backup')
      const pluginCacheDir = path.join(sourceSeedDir, 'plugins', 'cache', 'demo-market', 'demo-plugin', '1.0.0')
      const pluginNonCacheDir = path.join(sourceSeedDir, 'plugins', 'superpowers')
      const instanceCacheDir = path.join(sourceSeedDir, 'instances', 'kite', 'electron-data', 'Cache')
      const tempDebugDir = path.join(sourceSeedDir, 'temp', 'claude-config', 'debug')
      const installPath = path.join(pluginCacheDir)
      const nonCacheInstallPath = path.join(pluginNonCacheDir)
      const hasOriginalOutput = fs.existsSync(outputDir)

      fs.rmSync(sourceSeedDir, { recursive: true, force: true })
      fs.rmSync(backupOutputDir, { recursive: true, force: true })
      if (hasOriginalOutput) {
        fs.cpSync(outputDir, backupOutputDir, { recursive: true })
      }
      fs.mkdirSync(path.join(sourceSeedDir, 'custom-dir', 'nested'), { recursive: true })
      fs.mkdirSync(pluginCacheDir, { recursive: true })
      fs.mkdirSync(path.join(pluginNonCacheDir, 'commands'), { recursive: true })
      fs.mkdirSync(path.join(pluginNonCacheDir, '.git'), { recursive: true })
      fs.mkdirSync(path.join(sourceSeedDir, 'skills', 'demo'), { recursive: true })
      fs.mkdirSync(instanceCacheDir, { recursive: true })
      fs.mkdirSync(tempDebugDir, { recursive: true })
      fs.writeFileSync(path.join(sourceSeedDir, 'custom-dir', 'nested', 'note.txt'), 'ok')
      fs.writeFileSync(path.join(pluginNonCacheDir, 'commands', 'plan.md'), '# plan')
      fs.writeFileSync(path.join(pluginNonCacheDir, '.git', 'HEAD'), 'ref: refs/heads/main')
      fs.writeFileSync(path.join(sourceSeedDir, 'skills', 'demo', 'SKILL.md'), '# demo skill')
      fs.writeFileSync(path.join(instanceCacheDir, 'cache.bin'), 'cache-data')
      fs.writeFileSync(path.join(tempDebugDir, 'debug.log'), 'debug-data')
      fs.writeFileSync(path.join(sourceSeedDir, '.DS_Store'), 'mac-noise')
      fs.writeFileSync(path.join(sourceSeedDir, 'runtime.log'), 'runtime-log')
      fs.writeFileSync(path.join(sourceSeedDir, 'settings.json'), JSON.stringify({
        token: 'secret-token',
        nested: { apiKey: 'abc' },
        enabledPlugins: {
          'demo-plugin@demo-market': false
        }
      }))
      fs.writeFileSync(path.join(sourceSeedDir, 'config.json'), JSON.stringify({
        api: { apiKey: 'should-not-ship', model: 'private-model' },
        ai: { defaultProfileId: 'profile-private' },
        mcpServers: { demo: { env: { SECRET_KEY: 'x' } } },
        claudeCode: { hooksEnabled: true }
      }))
      fs.writeFileSync(path.join(sourceSeedDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
          'demo-plugin@demo-market': [{
            scope: 'user',
            installPath,
            version: '1.0.0'
          }],
          'superpowers@superpowers-dev': [{
            scope: 'user',
            installPath: nonCacheInstallPath,
            version: '4.3.1'
          }]
        }
      }))

      try {
        const result = spawnSync(process.execPath, [scriptPath], {
          cwd: projectRoot,
          env: {
            ...process.env,
            KITE_SEED_SOURCE_DIR: sourceSeedDir
          },
          encoding: 'utf-8'
        })

        expect(result.status).toBe(0)
        expect(fs.existsSync(path.join(outputDir, 'skills', 'demo', 'SKILL.md'))).toBe(true)
        expect(fs.existsSync(path.join(outputDir, 'custom-dir', 'nested', 'note.txt'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, 'instances'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, 'temp'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, '.DS_Store'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, 'runtime.log'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, 'plugins', 'superpowers', '.git'))).toBe(false)
        expect(fs.existsSync(path.join(outputDir, 'plugins', 'superpowers', 'commands', 'plan.md'))).toBe(true)

        const packagedSettings = JSON.parse(fs.readFileSync(path.join(outputDir, 'settings.json'), 'utf-8'))
        expect(packagedSettings.token).toBe('')
        expect(packagedSettings.nested.apiKey).toBe('')
        expect(packagedSettings.enabledPlugins['demo-plugin@demo-market']).toBe(false)
        expect(packagedSettings.enabledPlugins['superpowers@superpowers-dev']).toBe(true)

        const packagedConfig = JSON.parse(fs.readFileSync(path.join(outputDir, 'config.json'), 'utf-8'))
        expect(packagedConfig.api).toBeUndefined()
        expect(packagedConfig.ai).toBeUndefined()
        expect(packagedConfig.mcpServers.demo.env).toEqual({})
        expect(packagedConfig.claudeCode.hooksEnabled).toBe(true)

        const packagedRegistry = JSON.parse(
          fs.readFileSync(path.join(outputDir, 'plugins', 'installed_plugins.json'), 'utf-8')
        )
        expect(packagedRegistry.plugins['demo-plugin@demo-market'][0].installPath)
          .toBe('__KITE_ROOT__/plugins/cache/demo-market/demo-plugin/1.0.0')
        expect(packagedRegistry.plugins['superpowers@superpowers-dev'][0].installPath)
          .toBe('__KITE_ROOT__/plugins/superpowers')
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true })
        if (hasOriginalOutput) {
          fs.cpSync(backupOutputDir, outputDir, { recursive: true })
        }
      }
    })
  })

  describe('getConfig', () => {
    it('should return default config when no config file exists', () => {
      const config = getConfig()

      expect(config.api.provider).toBe('anthropic')
      expect(config.api.apiKey).toBe('')
      expect(config.api.apiUrl).toBe('https://api.anthropic.com')
      expect(config.permissions.commandExecution).toBe('ask')
      expect(config.appearance.theme).toBe('light')
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

    it('should migrate legacy appearance themes to light and persist', async () => {
      await initializeApp()

      const configPath = getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify({
        appearance: { theme: 'mono' },
        isFirstLaunch: false
      }))

      const config = getConfig()
      expect(config.appearance.theme).toBe('light')

      const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(persisted.appearance.theme).toBe('light')
    })

    it('should remove legacy taxonomy field on read and persist migrated config', async () => {
      await initializeApp()
      const configPath = getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify({
        [LEGACY_TAXONOMY_KEY]: { adminEnabled: true },
        isFirstLaunch: false
      }))

      const config = getConfig() as Record<string, unknown>
      expect(config[LEGACY_TAXONOMY_KEY]).toBeUndefined()

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
      expect(saved[LEGACY_TAXONOMY_KEY]).toBeUndefined()
      expect(saved.isFirstLaunch).toBe(false)
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

    it('should strip legacy taxonomy field when saving updates', () => {
      saveConfig({ [LEGACY_TAXONOMY_KEY]: { adminEnabled: true } } as unknown as Record<string, unknown>)

      const configPath = getConfigPath()
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
      expect(saved[LEGACY_TAXONOMY_KEY]).toBeUndefined()
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
