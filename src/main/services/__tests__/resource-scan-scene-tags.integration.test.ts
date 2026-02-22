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
      'description: Skill from frontmatter',
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
      'description: Agent from frontmatter',
      'scene_tags:',
      '  - writing',
      '---',
      '# Heading should not win'
    ].join('\n'), 'utf-8')

    ensureDir(join(APP_ROOT, 'commands'))
    writeFileSync(join(APP_ROOT, 'commands', 'report.md'), [
      '---',
      'description: Command from frontmatter',
      'sceneTags:',
      '  - data',
      '---',
      '# Heading should not win'
    ].join('\n'), 'utf-8')

    const skill = listSkills().find((item) => item.name === 'review')
    const agent = listAgents().find((item) => item.name === 'planner')
    const command = listCommands().find((item) => item.name === 'report')

    expect(skill).toBeDefined()
    expect(skill?.description).toBe('Skill from frontmatter')
    expect(skill?.sceneTags).toEqual(['coding', 'writing'])

    expect(agent).toBeDefined()
    expect(agent?.description).toBe('Agent from frontmatter')
    expect(agent?.sceneTags).toEqual(['writing'])

    expect(command).toBeDefined()
    expect(command?.description).toBe('Command from frontmatter')
    expect(command?.sceneTags).toEqual(['data'])
  })
})
