/**
 * Thought Utils Unit Tests
 *
 * Tests for shared utility functions used in thought processing.
 * Covers text extraction, truncation, and parallel group building.
 */

import { describe, it, expect } from 'vitest'
import {
  truncateText,
  extractFileName,
  extractCommand,
  extractSearchTerm,
  extractUrl,
  buildParallelGroups,
  getThoughtKey,
  buildTimelineSegments,
  stripErrorTags,
  type TimelineSegment,
  type ThoughtsSegment,
  type SkillSegment,
  type SubAgentSegment
} from '../../../src/renderer/utils/thought-utils'
import type { Thought, ParallelGroup } from '../../../src/renderer/types'

describe('Thought Utils', () => {
  describe('truncateText', () => {
    it('should return text unchanged if shorter than maxLength', () => {
      expect(truncateText('hello', 10)).toBe('hello')
    })

    it('should return text unchanged if equal to maxLength', () => {
      expect(truncateText('hello', 5)).toBe('hello')
    })

    it('should truncate and add ellipsis if longer than maxLength', () => {
      expect(truncateText('hello world', 5)).toBe('hell…')
    })

    it('should handle empty string', () => {
      expect(truncateText('', 10)).toBe('')
    })

    it('should handle maxLength of 1', () => {
      expect(truncateText('hello', 1)).toBe('…')
    })
  })

  describe('extractFileName', () => {
    it('should extract filename from Unix path', () => {
      expect(extractFileName('/Users/test/project/file.ts')).toBe('file.ts')
    })

    it('should extract filename from Windows path', () => {
      expect(extractFileName('C:\\Users\\test\\file.ts')).toBe('file.ts')
    })

    it('should return "file" for null input', () => {
      expect(extractFileName(null)).toBe('file')
    })

    it('should return "file" for undefined input', () => {
      expect(extractFileName(undefined)).toBe('file')
    })

    it('should return "file" for non-string input', () => {
      expect(extractFileName(123)).toBe('file')
    })

    it('should return "file" for empty string', () => {
      expect(extractFileName('')).toBe('file')
    })

    it('should truncate long filenames', () => {
      const longName = '/path/to/very-long-filename-that-exceeds-limit.ts'
      const result = extractFileName(longName)
      expect(result.length).toBeLessThanOrEqual(25)
      expect(result.endsWith('…')).toBe(true)
    })

    it('should handle filename without path', () => {
      expect(extractFileName('simple.ts')).toBe('simple.ts')
    })
  })

  describe('extractCommand', () => {
    it('should extract first two words of command', () => {
      expect(extractCommand('npm install lodash --save')).toBe('npm install')
    })

    it('should return single word command', () => {
      expect(extractCommand('ls')).toBe('ls')
    })

    it('should return "command" for null input', () => {
      expect(extractCommand(null)).toBe('command')
    })

    it('should return "command" for undefined input', () => {
      expect(extractCommand(undefined)).toBe('command')
    })

    it('should return "command" for non-string input', () => {
      expect(extractCommand(123)).toBe('command')
    })

    it('should return "command" for empty string', () => {
      expect(extractCommand('')).toBe('command')
    })

    it('should truncate long commands', () => {
      const longCmd = 'verylongcommandname verylongargument'
      const result = extractCommand(longCmd)
      expect(result.length).toBeLessThanOrEqual(25)
    })
  })

  describe('extractSearchTerm', () => {
    it('should return search term unchanged if short', () => {
      expect(extractSearchTerm('pattern')).toBe('pattern')
    })

    it('should return "..." for null input', () => {
      expect(extractSearchTerm(null)).toBe('...')
    })

    it('should return "..." for undefined input', () => {
      expect(extractSearchTerm(undefined)).toBe('...')
    })

    it('should return "..." for non-string input', () => {
      expect(extractSearchTerm(123)).toBe('...')
    })

    it('should return "..." for empty string', () => {
      expect(extractSearchTerm('')).toBe('...')
    })

    it('should truncate long search terms', () => {
      const longTerm = 'this is a very long search pattern'
      const result = extractSearchTerm(longTerm)
      expect(result.length).toBeLessThanOrEqual(20)
      expect(result.endsWith('…')).toBe(true)
    })
  })

  describe('extractUrl', () => {
    it('should extract domain from URL', () => {
      expect(extractUrl('https://www.example.com/path')).toBe('example.com')
    })

    it('should remove www prefix', () => {
      expect(extractUrl('https://www.github.com')).toBe('github.com')
    })

    it('should handle URL without www', () => {
      expect(extractUrl('https://api.anthropic.com')).toBe('api.anthropic.com')
    })

    it('should return "page" for null input', () => {
      expect(extractUrl(null)).toBe('page')
    })

    it('should return "page" for undefined input', () => {
      expect(extractUrl(undefined)).toBe('page')
    })

    it('should return "page" for non-string input', () => {
      expect(extractUrl(123)).toBe('page')
    })

    it('should return "page" for empty string', () => {
      expect(extractUrl('')).toBe('page')
    })

    it('should truncate invalid URL and return truncated string', () => {
      const invalidUrl = 'not-a-valid-url-but-very-long-string'
      const result = extractUrl(invalidUrl)
      expect(result.length).toBeLessThanOrEqual(20)
    })

    it('should truncate long domain names', () => {
      const longDomain = 'https://very-long-subdomain.example-domain.com'
      const result = extractUrl(longDomain)
      expect(result.length).toBeLessThanOrEqual(20)
    })
  })

  describe('getThoughtKey', () => {
    it('should generate unique key combining type and id', () => {
      const thought = { id: 'abc123', type: 'tool_use' } as Thought
      expect(getThoughtKey(thought)).toBe('tool_use:abc123')
    })

    it('should generate different keys for tool_use and tool_result with same id', () => {
      const toolUse = { id: 'tooluse_xyz', type: 'tool_use' } as Thought
      const toolResult = { id: 'tooluse_xyz', type: 'tool_result' } as Thought

      const useKey = getThoughtKey(toolUse)
      const resultKey = getThoughtKey(toolResult)

      expect(useKey).not.toBe(resultKey)
      expect(useKey).toBe('tool_use:tooluse_xyz')
      expect(resultKey).toBe('tool_result:tooluse_xyz')
    })

    it('should generate same key for identical thoughts', () => {
      const thought1 = { id: 'same-id', type: 'tool_use' } as Thought
      const thought2 = { id: 'same-id', type: 'tool_use' } as Thought

      expect(getThoughtKey(thought1)).toBe(getThoughtKey(thought2))
    })
  })

  describe('buildParallelGroups', () => {
    const createThought = (overrides: Partial<Thought> = {}): Thought => ({
      id: `thought-${Math.random().toString(36).slice(2)}`,
      type: 'tool_use',
      content: 'test content',
      timestamp: new Date().toISOString(),
      ...overrides
    })

    it('should return empty map for empty thoughts array', () => {
      const result = buildParallelGroups([])
      expect(result.size).toBe(0)
    })

    it('should return empty map for thoughts without parallelGroupId', () => {
      const thoughts = [
        createThought({ id: '1' }),
        createThought({ id: '2' })
      ]
      const result = buildParallelGroups(thoughts)
      expect(result.size).toBe(0)
    })

    it('should group thoughts by parallelGroupId', () => {
      const groupId = 'group-1'
      const thoughts = [
        createThought({ id: '1', parallelGroupId: groupId }),
        createThought({ id: '2', parallelGroupId: groupId }),
        createThought({ id: '3' }) // No group
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.size).toBe(1)
      expect(result.has(groupId)).toBe(true)
      expect(result.get(groupId)!.thoughts.length).toBe(2)
    })

    it('should create multiple groups for different parallelGroupIds', () => {
      const thoughts = [
        createThought({ id: '1', parallelGroupId: 'group-1' }),
        createThought({ id: '2', parallelGroupId: 'group-1' }),
        createThought({ id: '3', parallelGroupId: 'group-2' }),
        createThought({ id: '4', parallelGroupId: 'group-2' })
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.size).toBe(2)
      expect(result.get('group-1')!.thoughts.length).toBe(2)
      expect(result.get('group-2')!.thoughts.length).toBe(2)
    })

    it('should set initial status to running', () => {
      const thoughts = [
        createThought({ id: '1', parallelGroupId: 'group-1', type: 'tool_use' })
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.get('group-1')!.status).toBe('running')
    })

    it('should update status to completed when all results received', () => {
      const timestamp = new Date().toISOString()
      const thoughts: Thought[] = [
        createThought({ id: '1', parallelGroupId: 'group-1', type: 'tool_use', timestamp }),
        createThought({ id: '2', parallelGroupId: 'group-1', type: 'tool_use', timestamp }),
        createThought({ id: '1', parallelGroupId: 'group-1', type: 'tool_result', timestamp }),
        createThought({ id: '2', parallelGroupId: 'group-1', type: 'tool_result', timestamp })
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.get('group-1')!.status).toBe('completed')
      expect(result.get('group-1')!.endTime).toBeDefined()
    })

    it('should update status to partial_error when any result has error', () => {
      const timestamp = new Date().toISOString()
      const thoughts: Thought[] = [
        createThought({ id: '1', parallelGroupId: 'group-1', type: 'tool_use', timestamp }),
        createThought({ id: '2', parallelGroupId: 'group-1', type: 'tool_use', timestamp }),
        createThought({ id: '1', parallelGroupId: 'group-1', type: 'tool_result', timestamp }),
        createThought({ id: '2', parallelGroupId: 'group-1', type: 'tool_result', timestamp, isError: true })
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.get('group-1')!.status).toBe('partial_error')
    })

    it('should use first thought timestamp as startTime', () => {
      const earlyTime = '2024-01-01T10:00:00.000Z'
      const lateTime = '2024-01-01T10:00:01.000Z'
      const thoughts = [
        createThought({ id: '1', parallelGroupId: 'group-1', timestamp: earlyTime }),
        createThought({ id: '2', parallelGroupId: 'group-1', timestamp: lateTime })
      ]
      const result = buildParallelGroups(thoughts)

      expect(result.get('group-1')!.startTime).toBe(earlyTime)
    })
  })

  describe('stripErrorTags', () => {
    it('should extract content from tool_use_error tags', () => {
      const input = '<tool_use_error>Skill not found: superpowers:brainstorm</tool_use_error>'
      expect(stripErrorTags(input)).toBe('Skill not found: superpowers:brainstorm')
    })

    it('should handle multiline content inside tags', () => {
      const input = '<tool_use_error>Error on line 1\nError on line 2\nDetails here</tool_use_error>'
      expect(stripErrorTags(input)).toBe('Error on line 1\nError on line 2\nDetails here')
    })

    it('should return original content if no tags present', () => {
      const input = 'Regular error message without XML tags'
      expect(stripErrorTags(input)).toBe('Regular error message without XML tags')
    })

    it('should handle empty string', () => {
      expect(stripErrorTags('')).toBe('')
    })

    it('should handle content with only whitespace inside tags', () => {
      const input = '<tool_use_error>   </tool_use_error>'
      expect(stripErrorTags(input)).toBe('')
    })

    it('should handle partial/malformed tags gracefully', () => {
      const input = '<tool_use_error>Unclosed tag'
      expect(stripErrorTags(input)).toBe('<tool_use_error>Unclosed tag')
    })

    it('should extract content when tags have surrounding text', () => {
      const input = 'Prefix <tool_use_error>Actual error</tool_use_error> Suffix'
      expect(stripErrorTags(input)).toBe('Actual error')
    })
  })

  describe('buildTimelineSegments', () => {
    const createThought = (overrides: Partial<Thought> = {}): Thought => ({
      id: `thought-${Math.random().toString(36).slice(2)}`,
      type: 'tool_use',
      content: 'test content',
      timestamp: new Date().toISOString(),
      ...overrides
    })

    it('should return empty array for empty thoughts', () => {
      const result = buildTimelineSegments([])
      expect(result).toEqual([])
    })

    it('should create single thoughts segment for regular thoughts', () => {
      const thoughts = [
        createThought({ id: '1', toolName: 'Read' }),
        createThought({ id: '2', toolName: 'Edit' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(1)
      expect(result[0].type).toBe('thoughts')
      expect((result[0] as ThoughtsSegment).thoughts.length).toBe(2)
    })

    it('should create SkillSegment for Skill tool calls', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'tdd-workflow', args: '--verbose' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'Skill completed successfully' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(1)
      expect(result[0].type).toBe('skill')
      const skillSegment = result[0] as SkillSegment
      expect(skillSegment.skillName).toBe('tdd-workflow')
      expect(skillSegment.skillArgs).toBe('--verbose')
      expect(skillSegment.isRunning).toBe(false)
      expect(skillSegment.result).toBe('Skill completed successfully')
    })

    it('should create SubAgentSegment for Task tool calls', () => {
      const thoughts: Thought[] = [
        createThought({
          id: 'task-1',
          toolName: 'Task',
          type: 'tool_use',
          toolInput: { description: 'Code review' },
          agentMeta: { description: 'Code review', subagentType: 'code-reviewer' }
        }),
        createThought({ id: 'child-1', toolName: 'Read', parentToolUseId: 'task-1' }),
        createThought({ id: 'task-1', type: 'tool_result', content: 'Review complete' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(1)
      expect(result[0].type).toBe('subagent')
      const subagentSegment = result[0] as SubAgentSegment
      expect(subagentSegment.description).toBe('Code review')
      expect(subagentSegment.subagentType).toBe('code-reviewer')
      expect(subagentSegment.thoughts.length).toBe(1)
      expect(subagentSegment.isRunning).toBe(false)
    })

    it('should preserve order: thoughts -> skill -> thoughts -> subagent', () => {
      const thoughts: Thought[] = [
        // First batch of thoughts
        createThought({ id: '1', toolName: 'Read' }),
        createThought({ id: '2', toolName: 'Grep' }),
        // Skill call
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'commit' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'Committed' }),
        // Second batch of thoughts
        createThought({ id: '3', toolName: 'Edit' }),
        // SubAgent call
        createThought({ id: 'task-1', toolName: 'Task', type: 'tool_use', toolInput: { description: 'Review' } }),
        createThought({ id: 'task-1', type: 'tool_result', content: 'Done' }),
        // Third batch of thoughts
        createThought({ id: '4', toolName: 'Bash' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(5)
      expect(result[0].type).toBe('thoughts')
      expect(result[1].type).toBe('skill')
      expect(result[2].type).toBe('thoughts')
      expect(result[3].type).toBe('subagent')
      expect(result[4].type).toBe('thoughts')

      expect((result[0] as ThoughtsSegment).thoughts.length).toBe(2)
      expect((result[2] as ThoughtsSegment).thoughts.length).toBe(1)
      expect((result[4] as ThoughtsSegment).thoughts.length).toBe(1)
    })

    it('should mark running skill when no result yet', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'test' } })
        // No tool_result yet
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(1)
      expect(result[0].type).toBe('skill')
      expect((result[0] as SkillSegment).isRunning).toBe(true)
    })

    it('should mark running subagent when no result yet', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'task-1', toolName: 'Task', type: 'tool_use', toolInput: { description: 'Test' } })
        // No tool_result yet
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(1)
      expect(result[0].type).toBe('subagent')
      expect((result[0] as SubAgentSegment).isRunning).toBe(true)
    })

    it('should mark hasError when skill result has error', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'test' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'Error occurred', isError: true })
      ]
      const result = buildTimelineSegments(thoughts)

      expect((result[0] as SkillSegment).hasError).toBe(true)
    })

    it('should mark hasError when subagent child has error', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'task-1', toolName: 'Task', type: 'tool_use', toolInput: { description: 'Test' } }),
        createThought({ id: 'child-1', toolName: 'Bash', parentToolUseId: 'task-1', isError: true }),
        createThought({ id: 'task-1', type: 'tool_result', content: 'Done' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect((result[0] as SubAgentSegment).hasError).toBe(true)
    })

    it('should filter out empty thoughts segments', () => {
      const thoughts: Thought[] = [
        // Skill immediately at start (no preceding thoughts)
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'test' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'Done' })
        // No thoughts after either
      ]
      const result = buildTimelineSegments(thoughts)

      // Should only have the skill segment, no empty thoughts segments
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('skill')
    })

    it('should handle consecutive skill calls', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'first' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'First done' }),
        createThought({ id: 'skill-2', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'second' } }),
        createThought({ id: 'skill-2', type: 'tool_result', content: 'Second done' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(2)
      expect(result[0].type).toBe('skill')
      expect(result[1].type).toBe('skill')
      expect((result[0] as SkillSegment).skillName).toBe('first')
      expect((result[1] as SkillSegment).skillName).toBe('second')
    })

    it('should handle skill and subagent interleaved', () => {
      const thoughts: Thought[] = [
        createThought({ id: 'skill-1', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'plan' } }),
        createThought({ id: 'skill-1', type: 'tool_result', content: 'Plan created' }),
        createThought({ id: 'task-1', toolName: 'Task', type: 'tool_use', toolInput: { description: 'Implement' } }),
        createThought({ id: 'task-1', type: 'tool_result', content: 'Implemented' }),
        createThought({ id: 'skill-2', toolName: 'Skill', type: 'tool_use', toolInput: { skill: 'commit' } }),
        createThought({ id: 'skill-2', type: 'tool_result', content: 'Committed' })
      ]
      const result = buildTimelineSegments(thoughts)

      expect(result.length).toBe(3)
      expect(result[0].type).toBe('skill')
      expect(result[1].type).toBe('subagent')
      expect(result[2].type).toBe('skill')
    })
  })
})
