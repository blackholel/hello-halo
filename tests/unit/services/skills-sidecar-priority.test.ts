import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn()
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        globalPaths: []
      }
    }
  }))
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/resource-exposure.service', () => ({
  filterByResourceExposure: vi.fn((items: unknown[]) => items),
  resolveResourceExposure: vi.fn(() => 'public')
}))

import { getLockedUserConfigRootDir } from '../../../src/main/services/config-source-mode.service'
import { clearSkillsCache, listSkills } from '../../../src/main/services/skills.service'

describe('skills sidecar priority', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-skill-sidecar-'))

  afterEach(() => {
    clearSkillsCache()
  })

  it('prefers frontmatter locale over sidecar default locale', () => {
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(tempRoot)

    const skillDir = path.join(tempRoot, 'skills', 'demo-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Demo Skill',
      'name_zh-CN: 演示技能',
      'description: Demo Description',
      'description_zh-CN: 演示描述',
      '---',
      '# Body'
    ].join('\n'))

    const sidecarPath = path.join(tempRoot, 'i18n', 'resource-display.i18n.json')
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          'demo-skill': {
            title: { en: 'Sidecar English Title' },
            description: { en: 'Sidecar English Description' }
          }
        }
      }
    }, null, 2))

    const skills = listSkills(undefined, 'extensions', 'zh-CN')
    expect(skills).toHaveLength(1)
    expect(skills[0].displayName).toBe('演示技能')
    expect(skills[0].description).toBe('演示描述')
  })

  it('loads space sidecar from <workDir>/.claude/i18n', () => {
    const emptyAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-app-root-'))
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(emptyAppRoot)

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-space-sidecar-'))
    const skillDir = path.join(workDir, '.claude', 'skills', 'space-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Space Skill',
      'description: Space Description',
      '---',
      '# Body'
    ].join('\n'))

    const sidecarPath = path.join(workDir, '.claude', 'i18n', 'resource-display.i18n.json')
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          'space-skill': {
            title: { en: 'Space Skill', 'zh-CN': '空间技能' },
            description: { en: 'Space Description', 'zh-CN': '空间描述' }
          }
        }
      }
    }, null, 2))

    const skills = listSkills(workDir, 'extensions', 'zh-CN')
    expect(skills).toHaveLength(1)
    expect(skills[0].displayName).toBe('空间技能')
    expect(skills[0].description).toBe('空间描述')
  })
})
