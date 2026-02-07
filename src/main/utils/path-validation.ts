/**
 * Path validation utilities
 *
 * Provides security-focused path validation to prevent symlink attacks
 * and ensure paths point to valid directories.
 */

import { lstatSync } from 'fs'
import { resolve, relative, isAbsolute } from 'path'

/**
 * Normalize a file path for cross-platform comparison.
 * Resolves to absolute and lowercases on Windows.
 */
export function normalizePlatformPath(value: string): string {
  const resolved = resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Validate that a path is a valid directory and not a symlink
 *
 * @param dirPath - Path to validate
 * @param context - Context for logging (e.g., 'Plugins', 'Agents')
 * @returns true if path is a valid directory, false otherwise
 */
export function isValidDirectoryPath(dirPath: string, context: string = 'Path'): boolean {
  try {
    const stat = lstatSync(dirPath)
    if (stat.isSymbolicLink()) {
      console.warn(`[${context}] Security: Rejected symlink path: ${dirPath}`)
      return false
    }
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Validate that a path is within one of the allowed base paths
 *
 * @param targetPath - Path to validate
 * @param basePaths - Allowed base directories
 * @returns true if targetPath is inside any base path (or equals it)
 */
export function isPathWithinBasePaths(targetPath: string, basePaths: string[]): boolean {
  if (!targetPath || basePaths.length === 0) return false

  const resolvedTarget = normalizePlatformPath(targetPath)

  return basePaths.some((basePath) => {
    if (!basePath) return false
    const resolvedBase = normalizePlatformPath(basePath)
    if (resolvedTarget === resolvedBase) return true
    const rel = relative(resolvedBase, resolvedTarget)
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

/**
 * Check if an error represents a file-not-found condition (ENOENT / ENOTDIR)
 *
 * Use this to decide log severity: file-not-found → debug, others → warn.
 */
export function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
  return false
}
