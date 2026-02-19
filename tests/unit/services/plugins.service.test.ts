/**
 * Plugins Service Tests
 *
 * Verifies single-source loading behavior:
 * - kite mode reads only ~/.kite
 * - claude mode reads only ~/.claude
 * - cache signature includes mode/path fingerprint
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import fs from 'fs'
import { getTestDir } from '../setup'

import {
  loadInstalledPlugins,
  listEnabledPlugins,
  getInstalledPluginPaths,
  clearPluginsCache
} from '../../../src/main/services/plugins.service'
import {
  _testInitConfigSourceModeLock,
  _testResetConfigSourceModeLock
} from '../../../src/main/services/config-source-mode.service'

function writeRegistry(rootDir: string, fullName: string, installPath: string): void {
  const pluginsDir = join(rootDir, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.mkdirSync(installPath, { recursive: true })
  const registry = {
    version: 2,
    plugins: {
      [fullName]: [{
        scope: 'user',
        installPath,
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
        lastUpdated: '2024-01-01T00:00:00Z'
      }]
    }
  }
  fs.writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(registry))
}

function writeEnabledPluginsSettings(rootDir: string, enabledPlugins: Record<string, boolean>): void {
  fs.mkdirSync(rootDir, { recursive: true })
  fs.writeFileSync(
    join(rootDir, 'settings.json'),
    JSON.stringify({ enabledPlugins }, null, 2)
  )
}

describe('plugins.service', () => {
  beforeEach(() => {
    clearPluginsCache()
    _testResetConfigSourceModeLock()
    _testInitConfigSourceModeLock('kite')
  })

  it('should read only ~/.kite registry in kite mode', () => {
    const testDir = getTestDir()
    const kiteRoot = join(testDir, '.kite')
    const claudeRoot = join(testDir, '.claude')
    const kiteInstallPath = join(kiteRoot, 'plugins', 'cache', 'kite-market', 'kite-plugin', '1.0.0')
    const claudeInstallPath = join(claudeRoot, 'plugins', 'cache', 'claude-market', 'claude-plugin', '1.0.0')

    writeRegistry(kiteRoot, 'kite-plugin@kite-market', kiteInstallPath)
    writeRegistry(claudeRoot, 'claude-plugin@claude-market', claudeInstallPath)

    const paths = getInstalledPluginPaths()
    expect(paths).toEqual([kiteInstallPath])
  })

  it('should read only ~/.claude registry in claude mode', () => {
    const testDir = getTestDir()
    const kiteRoot = join(testDir, '.kite')
    const claudeRoot = join(testDir, '.claude')
    const kiteInstallPath = join(kiteRoot, 'plugins', 'cache', 'kite-market', 'kite-plugin', '1.0.0')
    const claudeInstallPath = join(claudeRoot, 'plugins', 'cache', 'claude-market', 'claude-plugin', '1.0.0')

    writeRegistry(kiteRoot, 'kite-plugin@kite-market', kiteInstallPath)
    writeRegistry(claudeRoot, 'claude-plugin@claude-market', claudeInstallPath)

    _testResetConfigSourceModeLock()
    _testInitConfigSourceModeLock('claude')

    const paths = getInstalledPluginPaths()
    expect(paths).toEqual([claudeInstallPath])
  })

  it('should invalidate cache when mode changes without manual cache clear', () => {
    const testDir = getTestDir()
    const kiteRoot = join(testDir, '.kite')
    const claudeRoot = join(testDir, '.claude')
    const kiteInstallPath = join(kiteRoot, 'plugins', 'cache', 'kite-market', 'kite-plugin', '1.0.0')
    const claudeInstallPath = join(claudeRoot, 'plugins', 'cache', 'claude-market', 'claude-plugin', '1.0.0')

    writeRegistry(kiteRoot, 'kite-plugin@kite-market', kiteInstallPath)
    writeRegistry(claudeRoot, 'claude-plugin@claude-market', claudeInstallPath)

    const kitePlugins = loadInstalledPlugins()
    expect(kitePlugins).toHaveLength(1)
    expect(kitePlugins[0]?.installPath).toBe(kiteInstallPath)

    _testResetConfigSourceModeLock()
    _testInitConfigSourceModeLock('claude')

    const claudePlugins = loadInstalledPlugins()
    expect(claudePlugins).toHaveLength(1)
    expect(claudePlugins[0]?.installPath).toBe(claudeInstallPath)
  })

  it('should read enabledPlugins from active source settings only', () => {
    const testDir = getTestDir()
    const kiteRoot = join(testDir, '.kite')
    const claudeRoot = join(testDir, '.claude')
    const kiteInstallPath = join(kiteRoot, 'plugins', 'cache', 'kite-market', 'kite-plugin', '1.0.0')
    const claudeInstallPath = join(claudeRoot, 'plugins', 'cache', 'claude-market', 'claude-plugin', '1.0.0')

    writeRegistry(kiteRoot, 'kite-plugin@kite-market', kiteInstallPath)
    writeRegistry(claudeRoot, 'claude-plugin@claude-market', claudeInstallPath)
    writeEnabledPluginsSettings(kiteRoot, { 'kite-plugin@kite-market': false })
    writeEnabledPluginsSettings(claudeRoot, { 'claude-plugin@claude-market': true })

    // Kite mode: disabled in kite settings -> no enabled plugins
    _testResetConfigSourceModeLock()
    _testInitConfigSourceModeLock('kite')
    expect(listEnabledPlugins()).toEqual([])

    // Claude mode: enabled in claude settings -> one enabled plugin
    _testResetConfigSourceModeLock()
    _testInitConfigSourceModeLock('claude')
    const enabled = listEnabledPlugins()
    expect(enabled).toHaveLength(1)
    expect(enabled[0]?.fullName).toBe('claude-plugin@claude-market')
  })
})
