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
  buildParallelGroups
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
})
