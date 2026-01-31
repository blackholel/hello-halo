/**
 * Multi-instance support utilities
 *
 * Enables running multiple Halo instances in parallel (e.g., different git worktrees)
 * by using environment variables to differentiate instances.
 *
 * Environment variables:
 * - HALO_INSTANCE_ID: Unique identifier for this instance (used for single-instance lock)
 * - HALO_CONFIG_DIR: Custom config directory path (default: ~/.halo)
 * - VITE_PORT: Custom Vite dev server port (default: 5173)
 */

import { homedir } from 'os'
import { join } from 'path'

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

/** Get default config directory (computed at call time for testability) */
function getDefaultConfigDir(): string {
  return join(homedir(), '.halo')
}

/**
 * Get the instance identifier from environment variable
 * Used to differentiate single-instance locks across worktrees
 */
export function getInstanceId(): string {
  return process.env.HALO_INSTANCE_ID || DEFAULTS.INSTANCE_ID
}

/**
 * Get the Halo configuration directory path
 * Supports custom path via HALO_CONFIG_DIR environment variable
 */
export function getConfigDir(): string {
  return process.env.HALO_CONFIG_DIR || getDefaultConfigDir()
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
 * When HALO_INSTANCE_ID is set (non-default), use a separate userData directory
 * to allow multiple instances to run in parallel.
 *
 * Note: This is separate from HALO_CONFIG_DIR (Halo config like agents/skills).
 * All instances can share the same Halo config while having separate userData.
 *
 * @returns Custom userData path for non-default instances, null for default instance
 */
export function getUserDataDir(): string | null {
  const instanceId = getInstanceId()
  if (instanceId !== DEFAULTS.INSTANCE_ID) {
    // Custom instance: use instance-specific userData
    // Place it under ~/.halo/instances/{instanceId}/electron-data
    return join(getDefaultConfigDir(), 'instances', instanceId, 'electron-data')
  }
  return null // Use Electron default for default instance
}
