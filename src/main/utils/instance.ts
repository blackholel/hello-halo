/**
 * Multi-instance support utilities
 *
 * Environment-derived runtime utilities for instance id, config directory and dev server port.
 *
 * Environment variables:
 * - KITE_INSTANCE_ID: Unique identifier for this instance (used for single-instance lock)
 * - KITE_CONFIG_DIR: Custom config directory path (default: ~/.kite)
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
  // Deliberate policy: Kite only uses ~/.kite.
  // We do not read or auto-migrate legacy ~/.halo directories.
  return join(homedir(), '.kite')
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
 * Current policy always uses Electron default userData path.
 */
export function getUserDataDir(): string | null {
  return null
}
