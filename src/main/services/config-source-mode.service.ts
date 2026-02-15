import { homedir } from 'os'
import { join } from 'path'
import { getConfig, getKiteDir, normalizeConfigSourceMode, type ConfigSourceMode } from './config.service'

let lockedConfigSourceMode: ConfigSourceMode | null = null

/**
 * Initialize and lock config source mode for current process lifetime.
 * This prevents runtime mixed-source reads when user toggles mode without restart.
 */
export function initConfigSourceModeLock(): void {
  if (lockedConfigSourceMode) {
    return
  }
  lockedConfigSourceMode = normalizeConfigSourceMode((getConfig() as { configSourceMode?: unknown }).configSourceMode)
  console.log(`[ConfigSourceMode] Locked mode: ${lockedConfigSourceMode}`)
}

export function getLockedConfigSourceMode(): ConfigSourceMode {
  if (!lockedConfigSourceMode) {
    throw new Error('Config source mode not initialized. Call initConfigSourceModeLock() first.')
  }
  return lockedConfigSourceMode
}

export function getLockedUserConfigRootDir(): string {
  const mode = getLockedConfigSourceMode()
  if (mode === 'claude') {
    return join(homedir(), '.claude')
  }
  return getKiteDir()
}

// Test-only helpers
export function _testResetConfigSourceModeLock(): void {
  lockedConfigSourceMode = null
}

export function _testInitConfigSourceModeLock(mode: ConfigSourceMode): void {
  lockedConfigSourceMode = mode
}
