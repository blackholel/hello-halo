/**
 * Tests for path validation utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidDirectoryPath } from '../../../src/main/utils/path-validation'
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
