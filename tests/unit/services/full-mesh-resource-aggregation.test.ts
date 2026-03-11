import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testState = vi.hoisted(() => ({
  appRoot: '',
  spacePaths: [] as string[]
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      resourceRuntimePolicy: 'app-single-source',
      plugins: {
        enabled: true,
        globalPaths: []
      },
      agents: {
        paths: []
      }
    }
  }))
}))

vi.mock('../../../src/main/services/space-config.service', () => ({
  getSpaceConfig: vi.fn(() => ({
    claudeCode: {
      resourceRuntimePolicy: 'full-mesh'
    }
  }))
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => testState.appRoot)
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => testState.spacePaths)
}))

import {
  clearSkillsCache,
  copySkillToSpaceByRef,
  getSkillDefinition,
  listSkills
} from '../../../src/main/services/skills.service'
import {
  clearCommandsCache,
  copyCommandToSpaceByRef,
  getCommand,
  listCommands
} from '../../../src/main/services/commands.service'
import {
  clearAgentsCache,
  copyAgentToSpaceByRef,
  getAgent,
  listAgents
} from '../../../src/main/services/agents.service'
import { _testResetResourceRuntimePolicyWarnings } from '../../../src/main/services/resource-runtime-policy.service'

function writeSkill(rootDir: string, name: string, content?: string): void {
  const skillDir = join(rootDir, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content || `# ${name}\n`, 'utf-8')
}

function writeCommand(rootDir: string, name: string, content?: string): void {
  mkdirSync(join(rootDir, 'commands'), { recursive: true })
  writeFileSync(join(rootDir, 'commands', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeAgent(rootDir: string, name: string, content?: string): void {
  mkdirSync(join(rootDir, 'agents'), { recursive: true })
  writeFileSync(join(rootDir, 'agents', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceSkill(spaceDir: string, name: string, content?: string): void {
  const skillDir = join(spaceDir, '.claude', 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceCommand(spaceDir: string, name: string, content?: string): void {
  mkdirSync(join(spaceDir, '.claude', 'commands'), { recursive: true })
  writeFileSync(join(spaceDir, '.claude', 'commands', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceAgent(spaceDir: string, name: string, content?: string): void {
  mkdirSync(join(spaceDir, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(spaceDir, '.claude', 'agents', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

describe('full-mesh runtime fallback to app-single-source', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'full-mesh-runtime-fallback-'))
  const appRoot = join(tempRoot, 'app-root')
  const spaceA = join(tempRoot, 'space-a')
  const spaceB = join(tempRoot, 'space-b')
  const spaceC = join(tempRoot, 'space-c')

  beforeAll(() => {
    testState.appRoot = appRoot
    testState.spacePaths = [spaceC, spaceB, spaceA]

    writeSkill(appRoot, 'shared')
    writeSkill(appRoot, 'lex')
    writeCommand(appRoot, 'shared')
    writeCommand(appRoot, 'lex')
    writeAgent(appRoot, 'shared')
    writeAgent(appRoot, 'lex')

    writeSpaceSkill(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceSkill(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceSkill(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceSkill(spaceC, 'lex', '# lex-from-space-c\n')

    writeSpaceCommand(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceCommand(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceCommand(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceCommand(spaceC, 'lex', '# lex-from-space-c\n')

    writeSpaceAgent(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceAgent(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceAgent(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceAgent(spaceC, 'lex', '# lex-from-space-c\n')
  })

  beforeEach(() => {
    clearSkillsCache()
    clearCommandsCache()
    clearAgentsCache()
    _testResetResourceRuntimePolicyWarnings()
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('skills 仅命中 current space 与 global，不再跨 space 聚合', () => {
    const shared = getSkillDefinition('shared', spaceB)
    const lex = getSkillDefinition('lex', spaceB)
    const all = listSkills(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'skills', 'shared'))
    expect(lex?.path).toContain(join('app-root', 'skills', 'lex'))
    expect(all.some((skill) => skill.path.includes(join('space-a', '.claude', 'skills', 'lex')))).toBe(false)
  })

  it('commands 仅命中 current space 与 global，不再跨 space 聚合', () => {
    const shared = getCommand('shared', spaceB)
    const lex = getCommand('lex', spaceB)
    const all = listCommands(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'commands', 'shared.md'))
    expect(lex?.path).toContain(join('app-root', 'commands', 'lex.md'))
    expect(all.some((command) => command.path.includes(join('space-a', '.claude', 'commands', 'lex.md')))).toBe(false)
  })

  it('agents 仅命中 current space 与 global，不再跨 space 聚合', () => {
    const shared = getAgent('shared', spaceB)
    const lex = getAgent('lex', spaceB)
    const all = listAgents(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'agents', 'shared.md'))
    expect(lex?.path).toContain(join('app-root', 'agents', 'lex.md'))
    expect(all.some((agent) => agent.path.includes(join('space-a', '.claude', 'agents', 'lex.md')))).toBe(false)
  })

  it('copySkillToSpaceByRef 在 fallback 后优先命中当前空间同名 skill', () => {
    const result = copySkillToSpaceByRef({ type: 'skill', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'skills', 'shared'))
  })

  it('copyCommandToSpaceByRef 在 fallback 后优先命中当前空间同名 command', () => {
    const result = copyCommandToSpaceByRef({ type: 'command', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'commands', 'shared.md'))
  })

  it('copyAgentToSpaceByRef 在 fallback 后优先命中当前空间同名 agent', () => {
    const result = copyAgentToSpaceByRef({ type: 'agent', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'agents', 'shared.md'))
  })

  it('同一进程里 full-mesh 降级 warning 每个服务只打印一次', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      listSkills(spaceB, 'taxonomy-admin')
      listSkills(spaceB, 'taxonomy-admin')
      listAgents(spaceB, 'taxonomy-admin')
      listAgents(spaceB, 'taxonomy-admin')
      listCommands(spaceB, 'taxonomy-admin')
      listCommands(spaceB, 'taxonomy-admin')

      const fallbackWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('"full-mesh" is deprecated and ignored')
      )

      expect(fallbackWarns.length).toBe(3)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
