/**
 * Path validation utilities
 *
 * Provides security-focused path validation to prevent symlink attacks
 * and ensure paths point to valid directories.
 */

import { lstatSync } from 'fs'

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
