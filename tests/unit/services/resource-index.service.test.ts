import { beforeEach, describe, expect, it, vi } from 'vitest'

let displayIndexEntries = ['display-i18n:/home/test/.kite/i18n/resource-display.i18n.json:1700000000000:100']

vi.mock('../../../src/main/services/skills.service', () => ({
  listSkills: vi.fn((workDir?: string) => {
    if (workDir) {
      return [
        { source: 'space', namespace: undefined, name: 'space-skill', path: `${workDir}/.claude/skills/space-skill` }
      ]
    }
    return [
      { source: 'app', namespace: undefined, name: 'global-skill', path: '/home/test/.kite/skills/global-skill' }
    ]
  })
}))

vi.mock('../../../src/main/services/agents.service', () => ({
  listAgents: vi.fn((workDir?: string) => {
    if (workDir) {
      return [
        { source: 'space', namespace: undefined, name: 'space-agent', path: `${workDir}/.claude/agents/space-agent.md` }
      ]
    }
    return [
      { source: 'app', namespace: undefined, name: 'global-agent', path: '/home/test/.kite/agents/global-agent.md' }
    ]
  })
}))

vi.mock('../../../src/main/services/commands.service', () => ({
  listCommands: vi.fn((workDir?: string) => {
    if (workDir) {
      return [
        { source: 'space', namespace: undefined, name: 'space-command', path: `${workDir}/.claude/commands/space-command.md` }
      ]
    }
    return [
      { source: 'app', namespace: undefined, name: 'global-command', path: '/home/test/.kite/commands/global-command.md' }
    ]
  })
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => ['/workspace/project-a'])
}))

vi.mock('../../../src/main/services/resource-display-i18n.service', () => ({
  getResourceDisplayI18nIndexEntries: vi.fn((workDir?: string) => {
    if (workDir) {
      return [`display-i18n:${workDir}/.claude/i18n/resource-display.i18n.json:1700000000000:200`]
    }
    return displayIndexEntries
  })
}))

vi.mock('fs', () => ({
  statSync: vi.fn(() => ({ mtimeMs: 1700000000000 }))
}))

import {
  clearResourceIndexSnapshot,
  getResourceIndexHash,
  getResourceIndexSnapshot,
  rebuildAllResourceIndexes,
  rebuildResourceIndex
} from '../../../src/main/services/resource-index.service'

describe('resource-index.service', () => {
  beforeEach(() => {
    clearResourceIndexSnapshot()
    vi.clearAllMocks()
    displayIndexEntries = ['display-i18n:/home/test/.kite/i18n/resource-display.i18n.json:1700000000000:100']
  })

  it('rebuildResourceIndex 生成 hash 与统计计数', () => {
    const snapshot = rebuildResourceIndex(undefined, 'manual-refresh')
    expect(snapshot.hash).toHaveLength(64)
    expect(snapshot.reason).toBe('manual-refresh')
    expect(snapshot.counts).toEqual({
      skills: 1,
      agents: 1,
      commands: 1
    })
  })

  it('rebuildAllResourceIndexes 会构建全局与空间索引', () => {
    rebuildAllResourceIndexes('file-change')
    const globalHash = getResourceIndexHash()
    const spaceHash = getResourceIndexHash('/workspace/project-a')
    expect(globalHash).toHaveLength(64)
    expect(spaceHash).toHaveLength(64)
    expect(spaceHash).not.toBe(globalHash)
  })

  it('clearResourceIndexSnapshot 可按作用域清理缓存', () => {
    rebuildResourceIndex('/workspace/project-a', 'manual-refresh')
    const first = getResourceIndexSnapshot('/workspace/project-a')
    clearResourceIndexSnapshot('/workspace/project-a')
    const second = getResourceIndexSnapshot('/workspace/project-a')
    expect(second.hash).toBeTruthy()
    expect(second.generatedAt >= first.generatedAt).toBe(true)
  })

  it('sidecar 指纹变化会导致 hash 变化', () => {
    const before = rebuildResourceIndex(undefined, 'manual-refresh')
    displayIndexEntries = ['display-i18n:/home/test/.kite/i18n/resource-display.i18n.json:1700000000500:101']
    clearResourceIndexSnapshot()
    const after = rebuildResourceIndex(undefined, 'manual-refresh')
    expect(after.hash).not.toBe(before.hash)
  })
})
