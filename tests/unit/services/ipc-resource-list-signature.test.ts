import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

const listSkillsMock = vi.fn(() => [])

vi.mock('../../../src/main/services/skills.service', () => ({
  listSkills: (...args: unknown[]) => listSkillsMock(...args),
  getSkillContent: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  copySkillToSpace: vi.fn(),
  copySkillToSpaceByRef: vi.fn(),
  clearSkillsCache: vi.fn(),
  invalidateSkillsCache: vi.fn()
}))

vi.mock('../../../src/main/services/agents.service', () => ({
  invalidateAgentsCache: vi.fn()
}))

vi.mock('../../../src/main/services/commands.service', () => ({
  invalidateCommandsCache: vi.fn()
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  clearPluginsCache: vi.fn()
}))

vi.mock('../../../src/main/services/resource-index.service', () => ({
  rebuildResourceIndex: vi.fn(() => ({ hash: 'h', generatedAt: '', reason: 'manual-refresh', counts: { skills: 0, agents: 0, commands: 0 } })),
  rebuildAllResourceIndexes: vi.fn()
}))

import { registerSkillsHandlers } from '../../../src/main/ipc/skills'

describe('ipc skills:list signature forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按 (workDir, view, locale) 调用 service，避免参数顺序串位', async () => {
    registerSkillsHandlers()

    const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const entry = calls.find((call) => call[0] === 'skills:list')
    expect(entry).toBeDefined()

    const handler = entry?.[1] as ((event: unknown, workDir?: string, locale?: string, view?: string) => Promise<unknown>)
    await handler({}, '/workspace/demo', 'zh-CN', 'extensions')

    expect(listSkillsMock).toHaveBeenCalledTimes(1)
    expect(listSkillsMock).toHaveBeenCalledWith('/workspace/demo', 'extensions', 'zh-CN')
  })
})
