/**
 * Plugins Service Tests
 *
 * TDD tests for plugins loading functionality.
 * Tests use real filesystem with temporary directories created by setup.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import fs from 'fs'
import { getTestDir } from '../setup'

import {
  loadInstalledPlugins,
  getInstalledPluginPaths,
  clearPluginsCache
} from '../../../src/main/services/plugins.service'
import { getKiteDir } from '../../../src/main/services/config.service'

describe('plugins.service', () => {
  beforeEach(() => {
    clearPluginsCache()
  })

  describe('getInstalledPluginPaths', () => {
    it('should return plugin paths from ~/.kite/plugins/installed_plugins.json', () => {
      const testDir = getTestDir()
      const kiteDir = join(testDir, '.kite')
      const pluginsDir = join(kiteDir, 'plugins')
      const cacheDir = join(pluginsDir, 'cache', 'test-marketplace', 'test-plugin', '1.0.0')

      // Create directories
      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.mkdirSync(cacheDir, { recursive: true })

      // Create registry
      const registry = {
        version: 2,
        plugins: {
          'test-plugin@test-marketplace': [{
            scope: 'user',
            installPath: cacheDir,
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(registry))

      const paths = getInstalledPluginPaths()

      expect(paths).toContain(cacheDir)
    })

    it('should merge plugins from both ~/.kite/ and ~/.claude/ registries', () => {
      // This test verifies that plugins from BOTH registries are loaded
      const testDir = getTestDir()

      // Setup Kite registry
      const kiteDir = join(testDir, '.kite')
      const kitePluginsDir = join(kiteDir, 'plugins')
      const kiteCacheDir = join(kitePluginsDir, 'cache', 'kite-marketplace', 'kite-plugin', '1.0.0')
      fs.mkdirSync(kitePluginsDir, { recursive: true })
      fs.mkdirSync(kiteCacheDir, { recursive: true })

      const kiteRegistry = {
        version: 2,
        plugins: {
          'kite-plugin@kite-marketplace': [{
            scope: 'user',
            installPath: kiteCacheDir,
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(kitePluginsDir, 'installed_plugins.json'), JSON.stringify(kiteRegistry))

      // Setup Claude registry
      const claudeDir = join(testDir, '.claude')
      const claudePluginsDir = join(claudeDir, 'plugins')
      const claudeCacheDir = join(claudePluginsDir, 'cache', 'claude-marketplace', 'claude-plugin', '2.0.0')
      fs.mkdirSync(claudePluginsDir, { recursive: true })
      fs.mkdirSync(claudeCacheDir, { recursive: true })

      const claudeRegistry = {
        version: 2,
        plugins: {
          'claude-plugin@claude-marketplace': [{
            scope: 'user',
            installPath: claudeCacheDir,
            version: '2.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(claudePluginsDir, 'installed_plugins.json'), JSON.stringify(claudeRegistry))

      const paths = getInstalledPluginPaths()

      // Should contain plugins from BOTH registries
      expect(paths).toContain(kiteCacheDir)
      expect(paths).toContain(claudeCacheDir)
      expect(paths).toHaveLength(2)
    })

    it('should deduplicate plugins that exist in both registries', () => {
      // Same plugin in both registries should only appear once
      // Kite registry takes precedence
      const testDir = getTestDir()

      // Shared plugin path (in claude directory, but referenced by both)
      const claudeDir = join(testDir, '.claude')
      const sharedCacheDir = join(claudeDir, 'plugins', 'cache', 'shared-marketplace', 'shared-plugin', '1.0.0')
      fs.mkdirSync(sharedCacheDir, { recursive: true })

      const sharedPlugin = {
        scope: 'user',
        installPath: sharedCacheDir,
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        lastUpdated: '2024-01-01T00:00:00Z'
      }

      // Setup Kite registry with shared plugin
      const kiteDir = join(testDir, '.kite')
      const kitePluginsDir = join(kiteDir, 'plugins')
      fs.mkdirSync(kitePluginsDir, { recursive: true })

      const kiteRegistry = {
        version: 2,
        plugins: {
          'shared-plugin@shared-market': [sharedPlugin]
        }
      }
      fs.writeFileSync(join(kitePluginsDir, 'installed_plugins.json'), JSON.stringify(kiteRegistry))

      // Setup Claude registry with same shared plugin
      const claudePluginsDir = join(claudeDir, 'plugins')

      const claudeRegistry = {
        version: 2,
        plugins: {
          'shared-plugin@shared-marketplace': [sharedPlugin]
        }
      }
      fs.writeFileSync(join(claudePluginsDir, 'installed_plugins.json'), JSON.stringify(claudeRegistry))

      const paths = getInstalledPluginPaths()

      // Should only contain the plugin once (deduplicated)
      expect(paths).toHaveLength(1)
      expect(paths).toContain(sharedCacheDir)
    })

    it('should fallback to ~/.claude/ registry when ~/.kite/ registry does not exist', () => {
      const testDir = getTestDir()

      // Only setup Claude registry (no Kite registry)
      const claudeDir = join(testDir, '.claude')
      const claudePluginsDir = join(claudeDir, 'plugins')
      const claudeCacheDir = join(claudePluginsDir, 'cache', 'claude-marketplace', 'claude-only-plugin', '1.0.0')
      fs.mkdirSync(claudePluginsDir, { recursive: true })
      fs.mkdirSync(claudeCacheDir, { recursive: true })

      const claudeRegistry = {
        version: 2,
        plugins: {
          'claude-only-plugin@claude-marketplace': [{
            scope: 'user',
            installPath: claudeCacheDir,
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(claudePluginsDir, 'installed_plugins.json'), JSON.stringify(claudeRegistry))

      const paths = getInstalledPluginPaths()

      expect(paths).toContain(claudeCacheDir)
    })

    it('should reject symlink plugin paths for security', () => {
      const testDir = getTestDir()
      const kiteDir = join(testDir, '.kite')
      const pluginsDir = join(kiteDir, 'plugins')

      // Create a real directory and a symlink to it
      const realDir = join(testDir, 'real-plugin')
      const symlinkDir = join(pluginsDir, 'cache', 'test-marketplace', 'symlink-plugin', '1.0.0')

      fs.mkdirSync(realDir, { recursive: true })
      fs.mkdirSync(join(pluginsDir, 'cache', 'test-marketplace', 'symlink-plugin'), { recursive: true })
      fs.symlinkSync(realDir, symlinkDir)

      // Create registry pointing to symlink
      const registry = {
        version: 2,
        plugins: {
          'symlink-plugin@test-marketplace': [{
            scope: 'user',
            installPath: symlinkDir,
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(registry))

      const paths = getInstalledPluginPaths()

      // Symlink paths should be rejected
      expect(paths).toHaveLength(0)
    })

    it('should return empty array when no registries exist', () => {
      // No registry files created - should return empty
      const paths = getInstalledPluginPaths()

      expect(paths).toEqual([])
    })
  })

  describe('loadInstalledPlugins', () => {
    it('should parse plugin full name correctly', () => {
      const testDir = getTestDir()
      const kiteDir = join(testDir, '.kite')
      const pluginsDir = join(kiteDir, 'plugins')
      const cacheDir = join(pluginsDir, 'cache', 'my-marketplace', 'my-plugin', '1.0.0')

      fs.mkdirSync(pluginsDir, { recursive: true })
      fs.mkdirSync(cacheDir, { recursive: true })

      const registry = {
        version: 2,
        plugins: {
          'my-plugin@my-marketplace': [{
            scope: 'user',
            installPath: cacheDir,
            version: '1.0.0',
            installedAt: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-01T00:00:00Z'
          }]
        }
      }
      fs.writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(registry))

      const plugins = loadInstalledPlugins()

      expect(plugins).toHaveLength(1)
      expect(plugins[0]).toMatchObject({
        name: 'my-plugin',
        marketplace: 'my-marketplace',
        fullName: 'my-plugin@my-marketplace',
        version: '1.0.0',
        scope: 'user'
      })
    })
  })
})
