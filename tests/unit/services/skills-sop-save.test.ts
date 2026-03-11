import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => os.tmpdir()),
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        globalPaths: [],
      },
    },
  })),
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => []),
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => []),
}))

vi.mock('../../../src/main/services/resource-exposure.service', () => ({
  filterByResourceExposure: vi.fn((items: unknown[]) => items),
  resolveResourceExposure: vi.fn(() => 'public'),
}))

import { getAllSpacePaths } from '../../../src/main/services/space.service'
import { saveSopSkill } from '../../../src/main/services/skills.service'

function readSkillFile(workDir: string, skillName: string): string {
  return fs.readFileSync(path.join(workDir, '.claude', 'skills', skillName, 'SKILL.md'), 'utf-8')
}

describe('saveSopSkill', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('creates a new SOP skill with machine-readable marker block', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-sop-create-'))
    tempDirs.push(workDir)
    vi.mocked(getAllSpacePaths).mockReturnValue([workDir])

    const result = saveSopSkill({
      workDir,
      skillName: 'checkout-flow',
      sopSpec: {
        version: '1.0',
        name: 'checkout-flow',
        steps: [
          {
            id: 'step-1',
            action: 'navigate',
            target: { urlPattern: 'https://example.com' },
            value: 'https://example.com',
            retries: 3,
          },
        ],
      },
    })

    const content = readSkillFile(workDir, 'checkout-flow')
    expect(result.created).toBe(true)
    expect(result.revision).toBe(1)
    expect(content).toContain('sop_mode: manual_browser')
    expect(content).toContain('sop_revision: 1')
    expect(content).toContain('exposure: public')
    expect(content).toContain('## SOP_SPEC_JSON_BEGIN')
    expect(content).toContain('## SOP_SPEC_JSON_END')
    expect(content).toContain('Prefer existing authenticated pages')
  })

  it('updates existing marker block and increments sop_revision', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-sop-update-'))
    tempDirs.push(workDir)
    vi.mocked(getAllSpacePaths).mockReturnValue([workDir])

    saveSopSkill({
      workDir,
      skillName: 'checkout-flow',
      sopSpec: {
        version: '1.0',
        name: 'checkout-flow',
        steps: [
          {
            id: 'step-1',
            action: 'navigate',
            target: { urlPattern: 'https://old.example.com' },
            value: 'https://old.example.com',
            retries: 3,
          },
        ],
      },
    })

    const result = saveSopSkill({
      workDir,
      skillName: 'checkout-flow',
      sopSpec: {
        version: '1.0',
        name: 'checkout-flow',
        steps: [
          {
            id: 'step-1',
            action: 'navigate',
            target: { urlPattern: 'https://new.example.com' },
            value: 'https://new.example.com',
            retries: 3,
          },
        ],
      },
    })

    const content = readSkillFile(workDir, 'checkout-flow')
    expect(result.created).toBe(false)
    expect(result.revision).toBe(2)
    expect(content).toContain('sop_revision: 2')
    expect(content).toContain('exposure: public')
    expect(content).toContain('https://new.example.com')
    expect((content.match(/## SOP_SPEC_JSON_BEGIN/g) || []).length).toBe(1)
  })

  it('falls back to full template rebuild when existing skill has no marker block', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-sop-fallback-'))
    tempDirs.push(workDir)
    vi.mocked(getAllSpacePaths).mockReturnValue([workDir])

    const skillDir = path.join(workDir, '.claude', 'skills', 'legacy-flow')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: legacy-flow',
      'description: legacy',
      'sop_mode: manual_browser',
      'sop_revision: 9',
      '---',
      '# legacy',
      '',
      'old body without marker',
      '',
    ].join('\n'))

    const result = saveSopSkill({
      workDir,
      skillName: 'legacy-flow',
      sopSpec: {
        version: '1.0',
        name: 'legacy-flow',
        steps: [
          {
            id: 'step-1',
            action: 'click',
            target: { role: 'button', name: 'Submit' },
            retries: 3,
          },
        ],
      },
    })

    const content = readSkillFile(workDir, 'legacy-flow')
    expect(result.created).toBe(false)
    expect(result.revision).toBe(10)
    expect(content).toContain('sop_revision: 10')
    expect(content).toContain('exposure: public')
    expect(content).toContain('## SOP_SPEC_JSON_BEGIN')
  })
})
