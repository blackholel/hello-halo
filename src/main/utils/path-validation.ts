/**
 * Path validation utilities
 *
 * Provides security-focused path validation to prevent symlink attacks
 * and ensure paths point to valid directories.
 */

import { lstatSync } from 'fs'
import { resolve, sep } from 'path'

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

  const resolvedTarget = resolve(targetPath)

  return basePaths.some((basePath) => {
    if (!basePath) return false
    const resolvedBase = resolve(basePath)
    return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep)
  })
}
