/**
 * File Cache utility
 *
 * Generic file-based cache with mtime validation and optional TTL.
 * Used to avoid repeated file reads when content hasn't changed.
 */

import { statSync } from 'fs'
import { relative, isAbsolute } from 'path'
import { normalizePlatformPath } from './path-validation'

interface CacheEntry<T> {
  data: T
  mtime: number
  size: number
  timestamp: number
}

/**
 * Generic file cache with mtime+size-based invalidation and optional LRU eviction.
 *
 * Two mutually exclusive modes:
 * - TTL mode (ttlMs): For non-file or rarely-changing data. Skips mtime/size checks
 *   within the TTL window. File changes won't be visible until TTL expires.
 * - File mode (maxSize): For file content caching. Uses mtime+size validation on
 *   every hit. Supports LRU eviction when maxSize is reached.
 */
export class FileCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private ttlMs: number | null
  private maxSize: number | null

  constructor(opts?: number | { ttlMs?: number; maxSize?: number }) {
    if (typeof opts === 'number') {
      this.ttlMs = opts
      this.maxSize = null
    } else {
      this.ttlMs = opts?.ttlMs ?? null
      this.maxSize = opts?.maxSize ?? null
    }
    if (this.ttlMs !== null && this.maxSize !== null) {
      throw new Error('FileCache: ttlMs and maxSize are mutually exclusive')
    }
  }

  private normalizeKey(filePath: string): string {
    return normalizePlatformPath(filePath)
  }

  /** Move entry to the end of the Map (most recently used). */
  private touch(key: string, entry: CacheEntry<T>): void {
    this.cache.delete(key)
    this.cache.set(key, entry)
  }

  get(filePath: string, loader: () => T): T {
    const key = this.normalizeKey(filePath)
    const cached = this.cache.get(key)
    const now = Date.now()

    if (cached) {
      if (this.ttlMs !== null && now - cached.timestamp < this.ttlMs) {
        this.touch(key, cached)
        return cached.data
      }

      if (this.ttlMs === null) {
        try {
          const stat = statSync(filePath)
          if (stat.mtimeMs === cached.mtime && stat.size === cached.size) {
            this.touch(key, cached)
            return cached.data
          }
        } catch {
          this.cache.delete(key)
        }
      }
    }

    const data = loader()

    if (this.maxSize !== null && this.cache.size >= this.maxSize) {
      const deleteCount = Math.max(1, Math.floor(this.maxSize * 0.25))
      const iter = this.cache.keys()
      for (let i = 0; i < deleteCount; i++) {
        const oldest = iter.next()
        if (oldest.done) break
        this.cache.delete(oldest.value)
      }
    }

    try {
      const stat = statSync(filePath)
      this.cache.set(key, { data, mtime: stat.mtimeMs, size: stat.size, timestamp: now })
    } catch {
      this.cache.set(key, { data, mtime: 0, size: 0, timestamp: now })
    }

    return data
  }

  clearForDir(dir: string): void {
    const normalizedDir = this.normalizeKey(dir)
    for (const key of this.cache.keys()) {
      const rel = relative(normalizedDir, key)
      if (rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel))) {
        this.cache.delete(key)
      }
    }
  }

  clear(filePath?: string): void {
    if (filePath) {
      this.cache.delete(this.normalizeKey(filePath))
    } else {
      this.cache.clear()
    }
  }

  get currentSize(): number {
    return this.cache.size
  }
}
