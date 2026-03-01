import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const APP_ROOT = join(tmpdir(), 'kite-scene-tags-integration')

vi.mock('../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'claude'),
  getLockedUserConfigRootDir: vi.fn(() => APP_ROOT)
}))

vi.mock('../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

import { clearSkillsCache, listSkills } from '../skills.service'
import { clearAgentsCache, listAgents } from '../agents.service'
import { clearCommandsCache, listCommands } from '../commands.service'
import { getSceneTaxonomy } from '../scene-taxonomy.service'

function ensureDir(pathValue: string): void {
  mkdirSync(pathValue, { recursive: true })
}

afterEach(() => {
  clearSkillsCache()
  clearAgentsCache()
  clearCommandsCache()
  if (existsSync(APP_ROOT)) {
    rmSync(APP_ROOT, { recursive: true, force: true })
  }
})

describe('resource scan scene tags integration', () => {
  it('keeps frontmatter description and sceneTags effective for skills/agents/commands', () => {
    const taxonomy = getSceneTaxonomy()
    expect(taxonomy.config.definitions.map((item) => item.key)).toContain('coding')

    ensureDir(join(APP_ROOT, 'skills', 'review'))
    writeFileSync(join(APP_ROOT, 'skills', 'review', 'SKILL.md'), [
      '---',
      'name_zh-CN: 代码审查',
      'description: Skill from frontmatter',
      'description_zh-CN: 技能中文描述',
      'triggers:',
      '  - code-review',
      'sceneTags:',
      '  - coding',
      '  - writing',
      '---',
      '# Fallback title'
    ].join('\n'), 'utf-8')

    ensureDir(join(APP_ROOT, 'agents'))
    writeFileSync(join(APP_ROOT, 'agents', 'planner.md'), [
      '---',
      'title_zh-CN: 规划助手',
      'description: Agent from frontmatter',
      'description_zh-CN: 代理中文描述',
      'scene_tags:',
      '  - writing',
      '---',
      '# Heading should not win'
    ].join('\n'), 'utf-8')

    ensureDir(join(APP_ROOT, 'commands'))
    writeFileSync(join(APP_ROOT, 'commands', 'report.md'), [
      '---',
      'name_zh-CN: 报告',
      'description: Command from frontmatter',
      'description_zh-CN: 命令中文描述',
      'sceneTags:',
      '  - data',
      '---',
      '# Heading should not win'
    ].join('\n'), 'utf-8')

    const skill = listSkills(undefined, 'taxonomy-admin').find((item) => item.name === 'review')
    const agent = listAgents(undefined, 'taxonomy-admin').find((item) => item.name === 'planner')
    const command = listCommands(undefined, 'taxonomy-admin').find((item) => item.name === 'report')
    const zhSkill = listSkills(undefined, 'taxonomy-admin', 'zh-CN').find((item) => item.name === 'review')
    const zhAgent = listAgents(undefined, 'taxonomy-admin', 'zh-CN').find((item) => item.name === 'planner')
    const zhCommand = listCommands(undefined, 'taxonomy-admin', 'zh-CN').find((item) => item.name === 'report')

    expect(skill).toBeDefined()
    expect(skill?.description).toBe('Skill from frontmatter')
    expect(skill?.sceneTags).toEqual(['coding', 'writing'])
    expect(skill?.displayName).toBeUndefined()

    expect(agent).toBeDefined()
    expect(agent?.description).toBe('Agent from frontmatter')
    expect(agent?.sceneTags).toEqual(['writing'])
    expect(agent?.displayName).toBeUndefined()

    expect(command).toBeDefined()
    expect(command?.description).toBe('Command from frontmatter')
    expect(command?.sceneTags).toEqual(['data'])
    expect(command?.displayName).toBeUndefined()

    expect(zhSkill?.displayName).toBe('代码审查')
    expect(zhSkill?.description).toBe('技能中文描述')
    expect(zhSkill?.sceneTags).toEqual(['coding', 'writing'])

    expect(zhAgent?.displayName).toBe('规划助手')
    expect(zhAgent?.description).toBe('代理中文描述')
    expect(zhAgent?.sceneTags).toEqual(['writing'])

    expect(zhCommand?.displayName).toBe('报告')
    expect(zhCommand?.description).toBe('命令中文描述')
    expect(zhCommand?.sceneTags).toEqual(['data'])
  })
})
