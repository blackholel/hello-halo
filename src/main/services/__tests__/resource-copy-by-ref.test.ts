import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => join(homedir(), '.kite'))
}))

vi.mock('../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

import { copySkillToSpaceByRef, clearSkillsCache } from '../skills.service'
import { copyAgentToSpaceByRef, clearAgentsCache } from '../agents.service'
import { copyCommandToSpaceByRef, clearCommandsCache } from '../commands.service'

function ensureDir(pathValue: string): void {
  mkdirSync(pathValue, { recursive: true })
}

describe('resource copy by ref', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    cleanupDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.length = 0
    clearSkillsCache()
    clearAgentsCache()
    clearCommandsCache()
  })

  function setupWorkspace(name: string): string {
    const root = join(homedir(), `workspace-${name}-${Date.now()}`)
    cleanupDirs.push(root)
    ensureDir(root)
    ensureDir(join(root, '.claude'))
    return root
  }

  function setupAppResources(): void {
    const appRoot = join(homedir(), '.kite')
    cleanupDirs.push(appRoot)

    const skillDir = join(appRoot, 'skills', 'review')
    ensureDir(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), '# review from app\n', 'utf-8')

    const agentsDir = join(appRoot, 'agents')
    ensureDir(agentsDir)
    writeFileSync(join(agentsDir, 'reviewer.md'), '# reviewer from app\n', 'utf-8')

    const commandsDir = join(appRoot, 'commands')
    ensureDir(commandsDir)
    writeFileSync(join(commandsDir, 'lint.md'), '# lint from app\n', 'utf-8')
  }

  it('returns copied/conflict/overwrite/not_found for skills', () => {
    setupAppResources()
    const workDir = setupWorkspace('skill')

    const copied = copySkillToSpaceByRef({ type: 'skill', name: 'review', source: 'app' }, workDir)
    expect(copied.status).toBe('copied')
    expect(copied.data?.source).toBe('space')
    expect(copied.data?.path).toBe(join(workDir, '.claude', 'skills', 'review'))

    const targetPath = join(workDir, '.claude', 'skills', 'review', 'SKILL.md')
    writeFileSync(targetPath, '# existing space content\n', 'utf-8')
    const conflict = copySkillToSpaceByRef({ type: 'skill', name: 'review', source: 'app' }, workDir)
    expect(conflict.status).toBe('conflict')

    const overwrite = copySkillToSpaceByRef(
      { type: 'skill', name: 'review', source: 'app' },
      workDir,
      { overwrite: true }
    )
    expect(overwrite.status).toBe('copied')
    expect(readFileSync(targetPath, 'utf-8')).toContain('review from app')

    const notFound = copySkillToSpaceByRef({ type: 'skill', name: 'missing-skill', source: 'app' }, workDir)
    expect(notFound.status).toBe('not_found')
  })

  it('copies agents and commands by ref to space paths', () => {
    setupAppResources()
    const workDir = setupWorkspace('agent-command')

    const copiedAgent = copyAgentToSpaceByRef({ type: 'agent', name: 'reviewer', source: 'app' }, workDir)
    const copiedCommand = copyCommandToSpaceByRef({ type: 'command', name: 'lint', source: 'app' }, workDir)

    expect(copiedAgent.status).toBe('copied')
    expect(copiedAgent.data?.source).toBe('space')
    expect(copiedAgent.data?.path).toBe(join(workDir, '.claude', 'agents', 'reviewer.md'))

    expect(copiedCommand.status).toBe('copied')
    expect(copiedCommand.data?.source).toBe('space')
    expect(copiedCommand.data?.path).toBe(join(workDir, '.claude', 'commands', 'lint.md'))
  })
})
