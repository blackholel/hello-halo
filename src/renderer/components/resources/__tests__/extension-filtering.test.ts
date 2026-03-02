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
})
