/**
 * Thought Utils - Shared utility functions for thought processing
 *
 * These functions are used by ThoughtProcess, SubAgentCard, and chat.store
 * to extract and format information from thoughts.
 */

import type { Thought, ParallelGroup } from '../types'

/**
 * Generate a unique key for thought deduplication
 * Combines type and id to allow tool_use and tool_result with same id
 */
export function getThoughtKey(thought: Thought): string {
  return `${thought.type}:${thought.id}`
}

/**
 * Truncate text with ellipsis if longer than maxLength
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 1) + '…'
}

/**
 * Extract filename from a file path (Unix or Windows)
 * Returns 'file' for invalid inputs
 */
export function extractFileName(path: unknown, maxLength: number = 25): string {
  if (typeof path !== 'string' || !path) return 'file'
  // Handle both Unix (/) and Windows (\) path separators
  // Split by both separators and take the last non-empty part
  const parts = path.split(/[/\\]/)
  const name = parts[parts.length - 1] || path
  return truncateText(name, maxLength)
}

/**
 * Extract first two words from a command string
 * Returns 'command' for invalid inputs
 */
export function extractCommand(cmd: unknown, maxLength: number = 25): string {
  if (typeof cmd !== 'string' || !cmd) return 'command'
  const firstPart = cmd.split(' ').slice(0, 2).join(' ')
  return truncateText(firstPart, maxLength)
}

/**
 * Extract and truncate a search term or pattern
 * Returns '...' for invalid inputs
 */
export function extractSearchTerm(term: unknown, maxLength: number = 20): string {
  if (typeof term !== 'string' || !term) return '...'
  return truncateText(term, maxLength)
}

/**
 * Extract domain from a URL, removing 'www.' prefix
 * Returns 'page' for invalid inputs
 */
export function extractUrl(url: unknown, maxLength: number = 20): string {
  if (typeof url !== 'string' || !url) return 'page'
  try {
    const domain = new URL(url).hostname.replace('www.', '')
    return truncateText(domain, maxLength)
  } catch {
    return truncateText(url, maxLength)
  }
}

/**
 * Build parallel groups from thoughts based on parallelGroupId
 * Groups tool calls that are executed simultaneously
 */
export function buildParallelGroups(thoughts: Thought[]): Map<string, ParallelGroup> {
  const groups = new Map<string, ParallelGroup>()

  thoughts.forEach(t => {
    if (t.parallelGroupId) {
      if (!groups.has(t.parallelGroupId)) {
        groups.set(t.parallelGroupId, {
          id: t.parallelGroupId,
          thoughts: [],
          startTime: t.timestamp,
          status: 'running'
        })
      }
      const group = groups.get(t.parallelGroupId)!
      group.thoughts.push(t)

      // Update group status based on tool results
      if (t.type === 'tool_result') {
        const toolUses = group.thoughts.filter(gt => gt.type === 'tool_use')
        const results = group.thoughts.filter(gt => gt.type === 'tool_result')

        if (results.length >= toolUses.length) {
          group.status = group.thoughts.some(gt => gt.isError)
            ? 'partial_error'
            : 'completed'
          group.endTime = t.timestamp
        }
      }
    }
  })

  return groups
}
