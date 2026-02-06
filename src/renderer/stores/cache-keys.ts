/**
 * Cache Key Utilities
 *
 * Provides safe cache key generation to prevent conflicts between
 * null/undefined workDir and actual workDir strings like '__global__'.
 */

/**
 * Symbol used as cache key for global (no workDir) context.
 * Using a Symbol ensures it cannot conflict with any string workDir.
 */
const GLOBAL_CACHE_KEY = Symbol('global')

/**
 * Prefix for string-based cache keys to prevent collision with the global key.
 * This ensures that even if workDir is '__global__', it won't conflict.
 */
const WORKDIR_PREFIX = 'workdir:'

/**
 * Generate a safe cache key for the given workDir.
 *
 * @param workDir - The workspace directory path, or null/undefined for global
 * @returns A unique cache key (Symbol for global, prefixed string for workDir)
 */
export function getCacheKey(workDir: string | null | undefined): symbol | string {
  if (workDir == null) {
    return GLOBAL_CACHE_KEY
  }
  return `${WORKDIR_PREFIX}${workDir}`
}

/**
 * Get all cache keys from a cache object, including the global key if present.
 *
 * @param cache - The cache object (Record with string keys and Symbol keys)
 * @returns Array of all cache keys
 */
export function getAllCacheKeys(cache: Record<string | symbol, unknown>): (string | symbol)[] {
  const stringKeys = Object.keys(cache)
  const symbolKeys = Object.getOwnPropertySymbols(cache)
  return [...stringKeys, ...symbolKeys]
}

/**
 * Check if a cache key is the global key.
 *
 * @param key - The cache key to check
 * @returns True if the key is the global cache key
 */
export function isGlobalCacheKey(key: string | symbol): boolean {
  return key === GLOBAL_CACHE_KEY
}

/**
 * Export the global cache key for direct use if needed.
 */
export { GLOBAL_CACHE_KEY }
