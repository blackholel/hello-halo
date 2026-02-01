/**
 * Thought Utils - Shared utility functions for thought processing
 *
 * These functions are used by ThoughtProcess, SubAgentCard, SkillCard, and chat.store
 * to extract and format information from thoughts.
 */

import type { Thought, ParallelGroup } from '../types'

// ============================================
// Timeline Segment Types
// ============================================

export type TimelineSegmentType = 'thoughts' | 'skill' | 'subagent'

export interface ThoughtsSegment {
  id: string
  type: 'thoughts'
  startIndex: number
  thoughts: Thought[]
}

export interface SkillSegment {
  id: string
  type: 'skill'
  startIndex: number
  skillId: string
  skillName: string
  skillArgs?: string
  isRunning: boolean
  hasError: boolean
  result?: string
}

export interface SubAgentSegment {
  id: string
  type: 'subagent'
  startIndex: number
  agentId: string
  description: string
  subagentType?: string
  thoughts: Thought[]
  isRunning: boolean
  hasError: boolean
}

export type TimelineSegment = ThoughtsSegment | SkillSegment | SubAgentSegment

// ============================================
// SkillCard Utility Functions
// ============================================

/**
 * Get CSS classes for SkillCard status color based on running/error state
 * Used for border and background styling
 */
export function getSkillStatusColor(isRunning: boolean, hasError: boolean): string {
  if (isRunning) return 'border-blue-500/50 bg-blue-500/5'
  if (hasError) return 'border-destructive/50 bg-destructive/5'
  return 'border-green-500/50 bg-green-500/5'
}

/**
 * Get CSS class for SkillCard left border color based on running/error state
 */
export function getSkillLeftBorderColor(isRunning: boolean, hasError: boolean): string {
  if (isRunning) return 'bg-blue-500'
  if (hasError) return 'bg-destructive'
  return 'bg-green-500'
}

/**
 * Get summary text for collapsed SkillCard state
 * @param isRunning - Whether the skill is currently running
 * @param hasError - Whether the skill encountered an error
 * @param result - The skill result content (if available)
 * @param t - Translation function
 */
export function getSkillSummaryText(
  isRunning: boolean,
  hasError: boolean,
  result: string | undefined,
  t: (key: string) => string
): string {
  if (isRunning) {
    return t('Running skill...')
  }
  if (hasError) {
    if (result) {
      const cleanResult = stripErrorTags(result)
      const firstLine = cleanResult.split('\n')[0] || ''
      return firstLine ? truncateText(firstLine, 60) : t('Skill failed')
    }
    return t('Skill failed')
  }
  if (result) {
    const cleanResult = stripErrorTags(result)
    const firstLine = cleanResult.split('\n')[0] || ''
    return firstLine ? truncateText(firstLine, 60) : t('Skill completed')
  }
  return t('Skill completed')
}

/**
 * Generate a unique key for thought deduplication
 * Combines type and id to allow tool_use and tool_result with same id
 */
export function getThoughtKey(thought: Thought): string {
  return `${thought.type}:${thought.id}`
}

/**
 * Strip XML error tags from tool output
 * SDK wraps errors in <tool_use_error>...</tool_use_error> tags
 */
export function stripErrorTags(content: string): string {
  if (!content) return ''

  // Extract content from <tool_use_error> tags
  const match = content.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/)
  if (match) {
    return match[1].trim()
  }

  return content
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

/**
 * Build timeline segments from thoughts array
 * Segments are ordered by their appearance in the original thoughts array
 * This preserves the actual execution order of Skill and SubAgent calls
 *
 * Algorithm:
 * 1. Iterate through thoughts in order
 * 2. Accumulate main agent thoughts into ThoughtsSegment
 * 3. When encountering Skill tool_use, create SkillSegment
 * 4. When encountering Task tool_use, create SubAgentSegment
 * 5. Child thoughts (parentToolUseId) are associated with their parent SubAgent
 */
export function buildTimelineSegments(thoughts: Thought[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let currentThoughts: Thought[] = []
  let segmentIndex = 0

  // Map to track sub-agent child thoughts
  const subAgentChildMap = new Map<string, Thought[]>()

  // Pre-build Maps for O(1) lookup instead of O(n) Array.find
  const resultMap = new Map<string, Thought>()
  const useMap = new Map<string, Thought>()

  // First pass: collect child thoughts and build lookup maps
  for (const t of thoughts) {
    if (t.parentToolUseId) {
      const children = subAgentChildMap.get(t.parentToolUseId) || []
      children.push(t)
      subAgentChildMap.set(t.parentToolUseId, children)
    }
    if (t.type === 'tool_result') {
      resultMap.set(t.id, t)
    }
    if (t.type === 'tool_use') {
      useMap.set(t.id, t)
    }
  }

  // Helper to flush accumulated thoughts into a segment
  const flushThoughts = () => {
    if (currentThoughts.length > 0) {
      segments.push({
        id: `thoughts-${segmentIndex}`,
        type: 'thoughts',
        startIndex: segmentIndex,
        thoughts: currentThoughts
      })
      segmentIndex++
      currentThoughts = []
    }
  }

  // Second pass: build segments in order
  thoughts.forEach((thought, index) => {
    // Skip child thoughts (they belong to sub-agents)
    if (thought.parentToolUseId) {
      return
    }

    // Handle Skill tool calls
    if (thought.toolName === 'Skill' && thought.type === 'tool_use') {
      flushThoughts()

      // Find the corresponding result (O(1) lookup)
      const resultThought = resultMap.get(thought.id)

      const skillInput = thought.toolInput || {}
      segments.push({
        id: `skill-${thought.id}`,
        type: 'skill',
        startIndex: segmentIndex,
        skillId: thought.id,
        skillName: (skillInput.skill as string) || 'unknown',
        skillArgs: skillInput.args as string | undefined,
        isRunning: !resultThought,
        hasError: resultThought?.isError || false,
        // Use toolOutput for actual result content, fallback to content
        result: resultThought?.toolOutput || resultThought?.content
      })
      segmentIndex++
      return
    }

    // Handle Task (sub-agent) tool calls
    if (thought.toolName === 'Task' && thought.type === 'tool_use') {
      flushThoughts()

      // Find the corresponding result (O(1) lookup)
      const resultThought = resultMap.get(thought.id)

      // Get child thoughts for this sub-agent
      const childThoughts = subAgentChildMap.get(thought.id) || []
      const hasError = childThoughts.some(t => t.isError) || resultThought?.isError

      const taskInput = thought.toolInput || {}
      segments.push({
        id: `subagent-${thought.id}`,
        type: 'subagent',
        startIndex: segmentIndex,
        agentId: thought.id,
        description: thought.agentMeta?.description || (taskInput.description as string) || 'Sub-agent',
        subagentType: thought.agentMeta?.subagentType || (taskInput.subagent_type as string),
        thoughts: childThoughts,
        isRunning: !resultThought,
        hasError: hasError || false
      })
      segmentIndex++
      return
    }

    // Skip tool_result for Skill and Task (already handled above)
    if (thought.type === 'tool_result') {
      // O(1) lookup instead of Array.find
      const useThought = useMap.get(thought.id)
      if (useThought?.toolName === 'Skill' || useThought?.toolName === 'Task') {
        return
      }
    }

    // Accumulate regular thoughts
    currentThoughts.push(thought)
  })

  // Flush any remaining thoughts
  flushThoughts()

  return segments
}
