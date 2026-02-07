/**
 * Tests for path validation utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidDirectoryPath, isPathWithinBasePaths, isFileNotFoundError, normalizePlatformPath } from '../../../src/main/utils/path-validation'
import * as fs from 'fs'

vi.mock('fs')

describe('isValidDirectoryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return true for valid directory', () => {
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    } as fs.Stats)

    expect(isValidDirectoryPath('/valid/path')).toBe(true)
  })

  it('should return false for symlink', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
    } as fs.Stats)

    expect(isValidDirectoryPath('/symlink/path')).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Security: Rejected symlink path')
    )
  })

  it('should return false for non-directory', () => {
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
    } as fs.Stats)

    expect(isValidDirectoryPath('/file/path')).toBe(false)
  })

  it('should return false when path does not exist', () => {
    vi.mocked(fs.lstatSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(isValidDirectoryPath('/nonexistent/path')).toBe(false)
  })

  it('should include custom context in warning message', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
    } as fs.Stats)

    isValidDirectoryPath('/symlink/path', 'Plugins')
    expect(warnSpy).toHaveBeenCalledWith(
      '[Plugins] Security: Rejected symlink path: /symlink/path'
    )
  })

  it('should use default context when not provided', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.lstatSync).mockReturnValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
    } as fs.Stats)

    isValidDirectoryPath('/symlink/path')
    expect(warnSpy).toHaveBeenCalledWith(
      '[Path] Security: Rejected symlink path: /symlink/path'
    )
  })
})

describe('isPathWithinBasePaths', () => {
  it('should return true when target equals base path', () => {
    expect(isPathWithinBasePaths('/base/path', ['/base/path'])).toBe(true)
  })

  it('should return true when target is within base path', () => {
    expect(isPathWithinBasePaths('/base/path/file.txt', ['/base/path'])).toBe(true)
  })

  it('should return false when target is outside base paths', () => {
    expect(isPathWithinBasePaths('/other/path/file.txt', ['/base/path'])).toBe(false)
  })

  it('should return false for empty targetPath', () => {
    expect(isPathWithinBasePaths('', ['/base/path'])).toBe(false)
  })

  it('should return false for empty basePaths array', () => {
    expect(isPathWithinBasePaths('/base/path/file.txt', [])).toBe(false)
  })

  it('should return false for path traversal attack', () => {
    expect(isPathWithinBasePaths('/base/path/../other/secret', ['/base/path'])).toBe(false)
  })

  it('should skip empty strings in basePaths', () => {
    expect(isPathWithinBasePaths('/base/path/file.txt', ['', '/base/path'])).toBe(true)
    expect(isPathWithinBasePaths('/base/path/file.txt', [''])).toBe(false)
  })

  it('should match against any of multiple basePaths', () => {
    expect(isPathWithinBasePaths('/second/dir/file.txt', ['/first/dir', '/second/dir'])).toBe(true)
    expect(isPathWithinBasePaths('/first/dir/file.txt', ['/first/dir', '/second/dir'])).toBe(true)
    expect(isPathWithinBasePaths('/third/dir/file.txt', ['/first/dir', '/second/dir'])).toBe(false)
  })

  it('should handle deeply nested paths', () => {
    expect(isPathWithinBasePaths('/base/a/b/c/d/file.txt', ['/base'])).toBe(true)
  })

  it('should reject prefix-matching sibling paths', () => {
    // /base/pathExtra is NOT within /base/path
    expect(isPathWithinBasePaths('/base/pathExtra/file.txt', ['/base/path'])).toBe(false)
  })
})

describe('isFileNotFoundError', () => {
  it('should return true for ENOENT error', () => {
    const error = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    expect(isFileNotFoundError(error)).toBe(true)
  })

  it('should return true for ENOTDIR error', () => {
    const error = Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' })
    expect(isFileNotFoundError(error)).toBe(true)
  })

  it('should return false for EACCES error', () => {
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    expect(isFileNotFoundError(error)).toBe(false)
  })

  it('should return false for generic Error without code', () => {
    expect(isFileNotFoundError(new Error('something'))).toBe(false)
  })

  it('should return false for non-Error values', () => {
    expect(isFileNotFoundError('string error')).toBe(false)
    expect(isFileNotFoundError(null)).toBe(false)
    expect(isFileNotFoundError(undefined)).toBe(false)
  })
})

describe('normalizePlatformPath', () => {
  it('should resolve relative paths to absolute', () => {
    const result = normalizePlatformPath('relative/path')
    expect(result).toMatch(/^\//)
  })

  it('should return resolved absolute paths unchanged on unix', () => {
    const result = normalizePlatformPath('/absolute/path')
    expect(result).toBe('/absolute/path')
  })

  it('should be idempotent', () => {
    const first = normalizePlatformPath('/some/path')
    const second = normalizePlatformPath(first)
    expect(first).toBe(second)
  })
})
