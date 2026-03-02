import { describe, expect, it } from 'vitest'
import {
  applyTypeAndSearchFilter,
  normalizeExtensionItems
} from '../extension-filtering'

describe('extension-filtering', () => {
  it('hides commands when in remote mode', () => {
    const items = normalizeExtensionItems({
      skills: [
        { name: 'skill-a', path: '/tmp/skill-a', source: 'app' }
      ],
      agents: [
        { name: 'agent-a', path: '/tmp/agent-a', source: 'global' }
      ],
      commands: [
        { name: 'command-a', path: '/tmp/command-a', source: 'app' }
      ],
      isRemote: true
    })

    expect(items.map((item) => item.type)).toEqual(['skill', 'agent'])
  })

  it('supports filter by type and search keyword', () => {
    const items = normalizeExtensionItems({
      skills: [
        {
          name: 'review',
          displayName: '代码审查',
          description: '技能描述',
          path: '/tmp/review',
          source: 'app'
        }
      ],
      agents: [
        { name: 'agent-a', path: '/tmp/agent-a', source: 'global', description: 'helper' }
      ],
      commands: [],
      isRemote: false
    })

    expect(applyTypeAndSearchFilter(items, 'skills', '')).toHaveLength(1)
    expect(applyTypeAndSearchFilter(items, 'agents', '')).toHaveLength(1)
    expect(applyTypeAndSearchFilter(items, 'all', '代码审查')).toHaveLength(1)
    expect(applyTypeAndSearchFilter(items, 'all', 'missing')).toHaveLength(0)
  })

  it('command card title hides namespace prefix but keeps slash', () => {
    const items = normalizeExtensionItems({
      skills: [],
      agents: [],
      commands: [
        {
          name: 'code-review',
          displayName: '代码评审',
          namespace: 'everything-claude-code',
          description: '执行代码评审。',
          path: '/tmp/code-review',
          source: 'plugin'
        }
      ],
      isRemote: false
    })

    expect(items).toHaveLength(1)
    expect(items[0].displayName).toBe('/代码评审')
    expect(items[0].searchable.includes('everything-claude-code:code-review')).toBe(true)
  })
})
