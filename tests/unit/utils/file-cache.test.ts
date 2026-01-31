/**
 * Tests for FileCache utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileCache } from '../../../src/main/utils/file-cache'
import * as fs from 'fs'

vi.mock('fs')

describe('FileCache', () => {
  let cache: FileCache<string>

  beforeEach(() => {
    vi.clearAllMocks()
    cache = new FileCache<string>()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('get', () => {
    it('should call loader on first access', () => {
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats)

      const result = cache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(1)
      expect(result).toBe('loaded-data')
    })

    it('should return cached value when mtime unchanged', () => {
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats)

      // First call
      cache.get('/path/to/file', loader)
      // Second call
      const result = cache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(1)
      expect(result).toBe('loaded-data')
    })

    it('should reload when mtime changes', () => {
      const loader = vi.fn()
        .mockReturnValueOnce('first-data')
        .mockReturnValueOnce('second-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({ mtimeMs: 1000 } as fs.Stats)
        .mockReturnValueOnce({ mtimeMs: 2000 } as fs.Stats)
        .mockReturnValueOnce({ mtimeMs: 2000 } as fs.Stats)

      // First call
      cache.get('/path/to/file', loader)
      // Second call with different mtime
      const result = cache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(2)
      expect(result).toBe('second-data')
    })

    it('should reload when file is deleted and recreated', () => {
      const loader = vi.fn()
        .mockReturnValueOnce('first-data')
        .mockReturnValueOnce('second-data')

      // First call - file exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.mocked(fs.statSync).mockReturnValueOnce({ mtimeMs: 1000 } as fs.Stats)
      cache.get('/path/to/file', loader)

      // Second call - file was deleted then recreated
      vi.mocked(fs.existsSync).mockReturnValueOnce(false)
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.mocked(fs.statSync).mockReturnValueOnce({ mtimeMs: 2000 } as fs.Stats)
      const result = cache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(2)
      expect(result).toBe('second-data')
    })

    it('should handle stat errors gracefully', () => {
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('EACCES')
      })

      const result = cache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(1)
      expect(result).toBe('loaded-data')
    })
  })

  describe('clear', () => {
    it('should clear specific file from cache', () => {
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats)

      // Populate cache
      cache.get('/path/to/file1', loader)
      cache.get('/path/to/file2', loader)

      // Clear one file
      cache.clear('/path/to/file1')

      // Access both files again
      cache.get('/path/to/file1', loader)
      cache.get('/path/to/file2', loader)

      // file1 should be reloaded, file2 should use cache
      expect(loader).toHaveBeenCalledTimes(3)
    })

    it('should clear all files when no path provided', () => {
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats)

      // Populate cache
      cache.get('/path/to/file1', loader)
      cache.get('/path/to/file2', loader)

      // Clear all
      cache.clear()

      // Access both files again
      cache.get('/path/to/file1', loader)
      cache.get('/path/to/file2', loader)

      // Both should be reloaded
      expect(loader).toHaveBeenCalledTimes(4)
    })
  })

  describe('with TTL', () => {
    it('should reload after TTL expires', () => {
      vi.useFakeTimers()
      const ttlCache = new FileCache<string>(1000) // 1 second TTL
      const loader = vi.fn()
        .mockReturnValueOnce('first-data')
        .mockReturnValueOnce('second-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as fs.Stats)

      // First call
      ttlCache.get('/path/to/file', loader)

      // Advance time past TTL
      vi.advanceTimersByTime(1500)

      // Second call should reload
      const result = ttlCache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(2)
      expect(result).toBe('second-data')

      vi.useRealTimers()
    })

    it('should use cache within TTL even if mtime changes', () => {
      vi.useFakeTimers()
      const ttlCache = new FileCache<string>(5000) // 5 second TTL
      const loader = vi.fn().mockReturnValue('loaded-data')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({ mtimeMs: 1000 } as fs.Stats)
        .mockReturnValueOnce({ mtimeMs: 2000 } as fs.Stats) // mtime changed

      // First call
      ttlCache.get('/path/to/file', loader)

      // Advance time but stay within TTL
      vi.advanceTimersByTime(2000)

      // Second call should still use cache (TTL not expired)
      ttlCache.get('/path/to/file', loader)

      expect(loader).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })
})
