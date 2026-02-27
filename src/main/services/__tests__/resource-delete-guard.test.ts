import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let mockSpacePaths: string[] = []
const mockUserRoot = join(homedir(), `kite-delete-guard-${Date.now()}`)

vi.mock('../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => mockUserRoot)
}))

vi.mock('../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../space.service', () => ({
  getAllSpacePaths: vi.fn(() => mockSpacePaths)
}))

import { clearSkillsCache, deleteSkill } from '../skills.service'
import { clearAgentsCache, deleteAgent } from '../agents.service'

function ensureDir(pathValue: string): void {
  mkdirSync(pathValue, { recursive: true })
}

describe('resource delete guard', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    cleanupDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.length = 0
    mockSpacePaths = []
    clearSkillsCache()
    clearAgentsCache()
  })

  function setupWorkspace(name: string): string {
    const root = join(homedir(), `workspace-delete-guard-${name}-${Date.now()}`)
    cleanupDirs.push(root)
    ensureDir(root)
    return root
  }

  function setupAppRoot(): void {
    cleanupDirs.push(mockUserRoot)
    ensureDir(mockUserRoot)
  }

  it('deleteSkill 仅允许删除空间目录，拒绝删除 app 目录', () => {
    setupAppRoot()
    const workDir = setupWorkspace('skill-reject')
    mockSpacePaths = [workDir]

    const appSkillDir = join(mockUserRoot, 'skills', 'shared-review')
    ensureDir(appSkillDir)
    writeFileSync(join(appSkillDir, 'SKILL.md'), '# app skill\n', 'utf-8')

    const deleted = deleteSkill(appSkillDir)
    expect(deleted).toBe(false)
    expect(existsSync(join(appSkillDir, 'SKILL.md'))).toBe(true)
  })

  it('deleteSkill 可删除空间目录中的 skill', () => {
    const workDir = setupWorkspace('skill-allow')
    mockSpacePaths = [workDir]

    const spaceSkillDir = join(workDir, '.claude', 'skills', 'space-review')
    ensureDir(spaceSkillDir)
    writeFileSync(join(spaceSkillDir, 'SKILL.md'), '# space skill\n', 'utf-8')

    const deleted = deleteSkill(spaceSkillDir)
    expect(deleted).toBe(true)
    expect(existsSync(spaceSkillDir)).toBe(false)
  })

  it('deleteAgent 仅允许删除空间目录，拒绝删除 app 目录', () => {
    setupAppRoot()
    const workDir = setupWorkspace('agent-reject')
    mockSpacePaths = [workDir]

    const appAgentPath = join(mockUserRoot, 'agents', 'reviewer.md')
    ensureDir(join(mockUserRoot, 'agents'))
    writeFileSync(appAgentPath, '# app agent\n', 'utf-8')

    const deleted = deleteAgent(appAgentPath)
    expect(deleted).toBe(false)
    expect(existsSync(appAgentPath)).toBe(true)
  })

  it('deleteAgent 可删除空间目录中的 agent', () => {
    const workDir = setupWorkspace('agent-allow')
    mockSpacePaths = [workDir]

    const spaceAgentPath = join(workDir, '.claude', 'agents', 'reviewer.md')
    ensureDir(join(workDir, '.claude', 'agents'))
    writeFileSync(spaceAgentPath, '# space agent\n', 'utf-8')

    const deleted = deleteAgent(spaceAgentPath)
    expect(deleted).toBe(true)
    expect(existsSync(spaceAgentPath)).toBe(false)
  })
})
