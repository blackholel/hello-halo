import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let mockSpacePath = ''

vi.mock('../../../src/main/services/space.service', () => ({
  getSpace: vi.fn(() => {
    if (!mockSpacePath) return null
    return { id: 'space-stats', path: mockSpacePath }
  })
}))

import {
  beginChangeSet,
  clearPendingChangeSet,
  finalizeChangeSet,
  listChangeSets,
  trackChangeFile
} from '../../../src/main/services/change-set.service'

describe('change-set stats accuracy', () => {
  let tempRoot = ''
  let workDir = ''

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'kite-change-set-stats-'))
    workDir = join(tempRoot, 'workspace')
    mkdirSync(workDir, { recursive: true })
    mockSpacePath = tempRoot
  })

  afterEach(() => {
    clearPendingChangeSet('conv-stats-1')
    clearPendingChangeSet('conv-stats-2')
    mockSpacePath = ''
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('counts full-line replacements as added + removed without heuristic compression', () => {
    const filePath = join(workDir, 'note.md')
    writeFileSync(filePath, '1\n2\n3\n4\n', 'utf-8')

    beginChangeSet('space-stats', 'conv-stats-1', workDir)
    trackChangeFile('conv-stats-1', 'note.md')
    writeFileSync(filePath, 'A\nB\nC\nD\n', 'utf-8')

    const changeSet = finalizeChangeSet('space-stats', 'conv-stats-1')
    expect(changeSet).not.toBeNull()
    expect(changeSet?.summary.totalAdded).toBe(4)
    expect(changeSet?.summary.totalRemoved).toBe(4)
    expect(changeSet?.files[0].stats).toEqual({ added: 4, removed: 4 })
  })

  it('treats empty file creation as zero changed lines', () => {
    const filePath = join(workDir, 'empty.txt')

    beginChangeSet('space-stats', 'conv-stats-2', workDir)
    trackChangeFile('conv-stats-2', 'empty.txt')
    writeFileSync(filePath, '', 'utf-8')

    const changeSet = finalizeChangeSet('space-stats', 'conv-stats-2')
    expect(changeSet).not.toBeNull()
    expect(changeSet?.files[0].type).toBe('create')
    expect(changeSet?.files[0].stats).toEqual({ added: 0, removed: 0 })
    expect(changeSet?.summary.totalAdded).toBe(0)
    expect(changeSet?.summary.totalRemoved).toBe(0)
  })

  it('skips directory paths so rollback snapshots stay file-only', () => {
    const dirPath = join(workDir, 'dist')
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, 'artifact.js'), 'console.log("x")\n', 'utf-8')

    beginChangeSet('space-stats', 'conv-stats-2', workDir)
    trackChangeFile('conv-stats-2', 'dist')
    rmSync(dirPath, { recursive: true, force: true })

    const changeSet = finalizeChangeSet('space-stats', 'conv-stats-2')
    expect(changeSet).toBeNull()
  })

  it('normalizes stale persisted stats with precise recalculation when listing', () => {
    const filePath = join(workDir, 'doc.md')
    writeFileSync(filePath, 'before\n', 'utf-8')

    const changeSetFile = join(tempRoot, '.kite', 'change-sets', 'conv-stats-legacy.json')
    mkdirSync(join(tempRoot, '.kite', 'change-sets'), { recursive: true })
    writeFileSync(changeSetFile, JSON.stringify([
      {
        id: 'cs-legacy',
        spaceId: 'space-stats',
        conversationId: 'conv-stats-legacy',
        createdAt: new Date().toISOString(),
        status: 'applied',
        summary: { totalFiles: 1, totalAdded: 10, totalRemoved: 2 },
        files: [
          {
            id: 'cf-legacy',
            path: filePath,
            relativePath: 'doc.md',
            fileName: 'doc.md',
            type: 'edit',
            status: 'accepted',
            beforeExists: true,
            afterExists: true,
            beforeContent: 'old line\n',
            afterContent: 'new line\n',
            stats: { added: 10, removed: 2 }
          }
        ]
      }
    ], null, 2), 'utf-8')

    const listed = listChangeSets('space-stats', 'conv-stats-legacy')
    expect(listed).toHaveLength(1)
    expect(listed[0].files[0].stats).toEqual({ added: 1, removed: 1 })
    expect(listed[0].summary).toEqual({ totalFiles: 1, totalAdded: 1, totalRemoved: 1 })
  })
})
