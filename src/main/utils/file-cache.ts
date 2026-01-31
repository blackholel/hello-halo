/**
 * File Cache utility
 *
 * Generic file-based cache with mtime validation and optional TTL.
 * Used to avoid repeated file reads when content hasn't changed.
 */

import { existsSync, statSync } from 'fs'

interface CacheEntry<T> {
  data: T
  mtime: number
  timestamp: number
}

/**
 * Generic file cache with mtime-based invalidation
 *
 * @template T - Type of cached data
 */
export class FileCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private ttlMs: number | null

  /**
   * Create a new FileCache
   *
   * @param ttlMs - Optional TTL in milliseconds. If provided, cache entries
   *                expire after this duration regardless of mtime.
   */
  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? null
  }

  /**
   * Get cached data or load it using the provided loader function
   *
   * @param filePath - Path to the file being cached
   * @param loader - Function to load data when cache is invalid
   * @returns Cached or freshly loaded data
   */
  get(filePath: string, loader: () => T): T {
    const cached = this.cache.get(filePath)
    const now = Date.now()

    if (cached) {
      // Check TTL first if configured
      if (this.ttlMs !== null && now - cached.timestamp < this.ttlMs) {
        return cached.data
      }

      // Check mtime if no TTL or TTL expired
      if (this.ttlMs === null) {
        try {
          if (existsSync(filePath)) {
            const stat = statSync(filePath)
            if (stat.mtimeMs === cached.mtime) {
              return cached.data
            }
          }
        } catch {
          // Stat failed, proceed to reload
        }
      }
    }

    // Load fresh data
    const data = loader()

    // Cache with mtime
    try {
      const mtime = existsSync(filePath) ? statSync(filePath).mtimeMs : 0
      this.cache.set(filePath, { data, mtime, timestamp: now })
    } catch {
      // Cache without mtime if stat fails
      this.cache.set(filePath, { data, mtime: 0, timestamp: now })
    }

    return data
  }

  /**
   * Clear cache entries
   *
   * @param filePath - Optional specific file to clear. If omitted, clears all.
   */
  clear(filePath?: string): void {
    if (filePath) {
      this.cache.delete(filePath)
    } else {
      this.cache.clear()
    }
  }
}
