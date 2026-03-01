/**
 * Multi-instance support utilities
 *
 * Enables running multiple Kite instances in parallel (e.g., different git worktrees)
 * by using environment variables to differentiate instances.
 *
 * Environment variables:
 * - KITE_INSTANCE_ID: Unique identifier for this instance (used for single-instance lock)
 * - KITE_CONFIG_DIR: Custom config directory path (default: ~/.kite)
 * - VITE_PORT: Custom Vite dev server port (default: 5173)
 */

import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { existsSync, realpathSync } from 'fs'

/**
 * Instance configuration derived from environment variables
 */
export interface InstanceConfig {
  /** Unique instance identifier for single-instance lock */
  instanceId: string
  /** Configuration directory path */
  configDir: string
  /** Vite dev server port */
  vitePort: number
}

/** Default values */
const DEFAULTS = {
  INSTANCE_ID: 'default',
  VITE_PORT: 5173
} as const
const BLOCKED_CLAUDE_DIR_NAME = '.claude'

/** Get default config directory (computed at call time for testability) */
function getDefaultConfigDir(): string {
  // Deliberate policy: Kite only uses ~/.kite.
  // We do not read or auto-migrate legacy ~/.halo directories.
  return join(homedir(), '.kite')
}

function normalizeComparisonPath(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function realpathWithMissingTail(pathValue: string): string {
  const resolvedPath = resolve(pathValue)
  const missingSegments: string[] = []
  let cursor = resolvedPath

  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) {
      break
    }
    missingSegments.unshift(basename(cursor))
    cursor = parent
  }

  let canonicalBase = cursor
  if (existsSync(cursor)) {
    try {
      canonicalBase = realpathSync(cursor)
    } catch {
      canonicalBase = cursor
    }
  }

  return missingSegments.reduce((acc, segment) => join(acc, segment), canonicalBase)
}

function isBlockedClaudeUserRoot(pathValue: string): boolean {
  const targetPath = normalizeComparisonPath(realpathWithMissingTail(pathValue))
  const blockedPath = normalizeComparisonPath(realpathWithMissingTail(join(homedir(), BLOCKED_CLAUDE_DIR_NAME)))
  return targetPath === blockedPath
}

/**
 * Get the instance identifier from environment variable
 * Used to differentiate single-instance locks across worktrees
 */
export function getInstanceId(): string {
  return process.env.KITE_INSTANCE_ID || DEFAULTS.INSTANCE_ID
}

/**
 * Get the Kite configuration directory path
 * Supports custom path via KITE_CONFIG_DIR environment variable
 * Policy note: if KITE_CONFIG_DIR is not set, fallback is always ~/.kite only.
 */
export function getConfigDir(): string {
  const configuredPath = process.env.KITE_CONFIG_DIR
  if (!configuredPath) {
    return getDefaultConfigDir()
  }

  if (isBlockedClaudeUserRoot(configuredPath)) {
    console.warn('[Instance] KITE_CONFIG_DIR points to ~/.claude (or equivalent). Falling back to ~/.kite.')
    return getDefaultConfigDir()
  }

  return configuredPath
}

/**
 * Get the Vite dev server port
 * Supports custom port via VITE_PORT environment variable
 */
export function getVitePort(): number {
  const envPort = process.env.VITE_PORT
  if (envPort) {
    const parsed = parseInt(envPort, 10)
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed
    }
  }
  return DEFAULTS.VITE_PORT
}

/**
 * Get the complete instance configuration
 */
export function getInstanceConfig(): InstanceConfig {
  return {
    instanceId: getInstanceId(),
    configDir: getConfigDir(),
    vitePort: getVitePort()
  }
}

/**
 * Check if running in a custom instance (non-default)
 */
export function isCustomInstance(): boolean {
  return getInstanceId() !== DEFAULTS.INSTANCE_ID
}

/**
 * Get Electron userData directory path for multi-instance support.
 *
 * When KITE_INSTANCE_ID is set (non-default), use a separate userData directory
 * to allow multiple instances to run in parallel.
 *
 * Note: This is separate from KITE_CONFIG_DIR (Kite config like agents/skills).
 * All instances can share the same Kite config while having separate userData.
 *
 * @returns Custom userData path for non-default instances, null for default instance
 */
export function getUserDataDir(): string | null {
  const instanceId = getInstanceId()
  if (instanceId !== DEFAULTS.INSTANCE_ID) {
    // Custom instance: use instance-specific userData
    // Place it under ~/.kite/instances/{instanceId}/electron-data
    return join(getDefaultConfigDir(), 'instances', instanceId, 'electron-data')
  }
  return null // Use Electron default for default instance
}
