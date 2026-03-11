import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/skills.service', () => ({
  getSkillContent: vi.fn(),
  getSkillDefinition: vi.fn(),
}))

import { getSkillContent, getSkillDefinition } from '../../../src/main/services/skills.service'
import { shouldAutoEnableAiBrowserForSopSkill } from '../../../src/main/services/agent/message-flow.service'

describe('shouldAutoEnableAiBrowserForSopSkill', () => {
  it('enables AI browser when /skill has sop_mode=manual_browser', () => {
    vi.mocked(getSkillDefinition).mockImplementation((name: string) => {
      if (name === 'checkout-flow') {
        return {
          name: 'checkout-flow',
          path: '/tmp/workspace/.claude/skills/checkout-flow',
          source: 'space',
          exposure: 'public',
        } as any
      }
      return null
    })
    vi.mocked(getSkillContent).mockImplementation((name: string) => {
      if (name === 'checkout-flow' || name === 'space:checkout-flow') {
        return {
          name,
          content: '',
          frontmatter: {
            sop_mode: 'manual_browser',
          },
        }
      }
      return null
    })

    const result = shouldAutoEnableAiBrowserForSopSkill({
      message: '/checkout-flow',
      workDir: '/tmp/workspace',
      allowedSources: ['space'],
      locale: 'zh-CN',
    })

    expect(result.enabled).toBe(true)
    expect(result.matchedSkills).toEqual(['checkout-flow'])
    expect(result.checkedSkills).toEqual(['checkout-flow'])
  })

  it('does not enable for regular skills without sop_mode', () => {
    vi.mocked(getSkillDefinition).mockReturnValue({
      name: 'normal-skill',
      path: '/tmp/workspace/.claude/skills/normal-skill',
      source: 'space',
      exposure: 'public',
    } as any)
    vi.mocked(getSkillContent).mockReturnValue({
      name: 'normal-skill',
      content: '',
      frontmatter: {
        description: 'normal skill',
      },
    } as any)

    const result = shouldAutoEnableAiBrowserForSopSkill({
      message: '/normal-skill',
      workDir: '/tmp/workspace',
    })

    expect(result.enabled).toBe(false)
    expect(result.matchedSkills).toEqual([])
    expect(result.checkedSkills).toEqual(['normal-skill'])
  })

  it('ignores slash in URLs and non-directive text', () => {
    vi.mocked(getSkillDefinition).mockReturnValue(null)
    vi.mocked(getSkillContent).mockReturnValue(null)

    const result = shouldAutoEnableAiBrowserForSopSkill({
      message: 'visit https://example.com/path and continue',
      workDir: '/tmp/workspace',
    })

    expect(result.enabled).toBe(false)
    expect(result.checkedSkills).toEqual([])
  })
})
