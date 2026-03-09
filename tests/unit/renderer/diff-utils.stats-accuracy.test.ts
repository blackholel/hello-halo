import { describe, expect, it } from 'vitest'
import { calculateDiffStats, extractFileChanges } from '../../../src/renderer/components/diff/utils'

describe('diff utils stats accuracy', () => {
  it('counts full replacements as symmetric add/remove lines', () => {
    const stats = calculateDiffStats('1\n2\n3\n4\n', 'A\nB\nC\nD\n')
    expect(stats).toEqual({ added: 4, removed: 4 })
  })

  it('returns zero stats for empty to empty content', () => {
    const stats = calculateDiffStats('', '')
    expect(stats).toEqual({ added: 0, removed: 0 })
  })

  it('counts write content with trailing newline as one line', () => {
    const changes = extractFileChanges([
      {
        id: 'tool-write-1',
        type: 'tool_use',
        toolName: 'Write',
        toolInput: {
          file_path: 'README.md',
          content: 'hello\n'
        }
      } as any
    ])

    expect(changes.totalAdded).toBe(1)
    expect(changes.writes[0].stats).toEqual({ added: 1, removed: 0 })
  })
})
