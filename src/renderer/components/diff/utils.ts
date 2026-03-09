/**
 * Diff Utilities
 * Extract file changes from thoughts and compute diff statistics
 */

import type { Thought } from '../../types'
import type { FileChange, FileChanges, EditChunk } from './types'
import { calculateLineDiffStats } from '../../../shared/utils/diff-stats'

// Re-export EditChunk for DiffContent
export type { EditChunk } from './types'

/**
 * Extract file name from path
 */
export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/**
 * Calculate line diff statistics
 * Uses a real line-based diff instead of heuristic estimation.
 */
export function calculateDiffStats(oldStr: string, newStr: string): { added: number; removed: number } {
  return calculateLineDiffStats(oldStr || '', newStr || '')
}

/**
 * Extract file changes from thoughts array
 * Only processes Write and Edit tool calls
 *
 * Key fix: Instead of merging multiple edits by concatenating strings,
 * we now store each edit as a separate "chunk" and display them sequentially.
 * This prevents diff algorithm confusion from '\n---\n' separators.
 */
export function extractFileChanges(thoughts: Thought[]): FileChanges {
  const edits: FileChange[] = []
  const writes: FileChange[] = []
  let totalAdded = 0
  let totalRemoved = 0

  // Track processed thought IDs to avoid duplicates
  const processedIds = new Set<string>()

  // Process each thought looking for Write/Edit tool calls
  for (const thought of thoughts) {
    if (thought.type !== 'tool_use') continue

    // Skip duplicate thoughts (same thought ID)
    if (processedIds.has(thought.id)) continue
    processedIds.add(thought.id)

    const input = thought.toolInput as Record<string, unknown> | undefined
    if (!input) continue

    if (thought.toolName === 'Write') {
      // New file creation
      const filePath = input.file_path as string
      const content = input.content as string | undefined

      if (filePath) {
        // Check if this file was already written (keep only the latest)
        const existingIndex = writes.findIndex(w => w.file === filePath)
        if (existingIndex >= 0) {
          // Remove old stats from total
          totalAdded -= writes[existingIndex].stats.added
          // Replace with new write
          writes.splice(existingIndex, 1)
        }

        const lineCount = calculateLineDiffStats('', content || '').added
        writes.push({
          id: thought.id,
          file: filePath,
          fileName: getFileName(filePath),
          type: 'write',
          content: content,
          stats: {
            added: lineCount,
            removed: 0
          }
        })
        totalAdded += lineCount
      }
    } else if (thought.toolName === 'Edit') {
      // File modification
      const filePath = input.file_path as string
      const oldString = input.old_string as string | undefined
      const newString = input.new_string as string | undefined

      if (filePath && (oldString !== undefined || newString !== undefined)) {
        const stats = calculateDiffStats(oldString || '', newString || '')

        // Check if this file was already edited
        const existingIndex = edits.findIndex(e => e.file === filePath)
        if (existingIndex >= 0) {
          // Store as additional edit chunk instead of merging
          const existing = edits[existingIndex]
          if (!existing.editChunks) {
            // Convert first edit to chunk format
            existing.editChunks = [{
              id: existing.id,
              oldString: existing.oldString || '',
              newString: existing.newString || '',
              stats: { ...existing.stats }
            }]
          }
          // Add new chunk
          existing.editChunks.push({
            id: thought.id,
            oldString: oldString || '',
            newString: newString || '',
            stats
          })
          // Update aggregated stats
          existing.stats.added += stats.added
          existing.stats.removed += stats.removed
        } else {
          edits.push({
            id: thought.id,
            file: filePath,
            fileName: getFileName(filePath),
            type: 'edit',
            oldString,
            newString,
            stats
          })
        }
        totalAdded += stats.added
        totalRemoved += stats.removed
      }
    }
  }

  return {
    edits,
    writes,
    totalFiles: edits.length + writes.length,
    totalAdded,
    totalRemoved
  }
}

/**
 * Check if there are any file changes
 */
export function hasFileChanges(changes: FileChanges): boolean {
  return changes.totalFiles > 0
}

/**
 * Get all file changes as a flat array (for modal navigation)
 */
export function getAllFileChanges(changes: FileChanges): FileChange[] {
  return [...changes.edits, ...changes.writes]
}

/**
 * Format stats for display (e.g., "+12 -5")
 */
export function formatStats(stats: { added: number; removed: number }): string {
  const parts: string[] = []
  if (stats.added > 0) parts.push(`+${stats.added}`)
  if (stats.removed > 0) parts.push(`-${stats.removed}`)
  return parts.join(' ') || '+0'
}
