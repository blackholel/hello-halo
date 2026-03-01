import fs from 'fs'
import { describe, expect, it, beforeEach } from 'vitest'

import { getConfigPath, initializeApp, saveConfig } from '../../../src/main/services/config.service'
import {
  _testInitConfigSourceModeLock,
  _testResetConfigSourceModeLock,
  getLockedConfigSourceMode,
  getLockedUserConfigRootDir,
  initConfigSourceModeLock
} from '../../../src/main/services/config-source-mode.service'

describe('config-source-mode.service', () => {
  beforeEach(async () => {
    await initializeApp()
    _testResetConfigSourceModeLock()
  })

  it('locks claude configSourceMode input to kite at init', () => {
    const configPath = getConfigPath()
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    raw.configSourceMode = 'claude'
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2))

    initConfigSourceModeLock()

    expect(getLockedConfigSourceMode()).toBe('kite')
    expect(getLockedUserConfigRootDir()).toContain('.kite')
    expect(getLockedUserConfigRootDir()).not.toContain('.claude')
  })

  it('normalizes test lock helper input to kite', () => {
    _testInitConfigSourceModeLock('claude')

    expect(getLockedConfigSourceMode()).toBe('kite')
    expect(getLockedUserConfigRootDir()).not.toContain('.claude')
  })

  it('saveConfig keeps persisted configSourceMode as kite', () => {
    saveConfig({ configSourceMode: 'claude' as any })

    const persisted = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
    expect(persisted.configSourceMode).toBe('kite')
  })
})
