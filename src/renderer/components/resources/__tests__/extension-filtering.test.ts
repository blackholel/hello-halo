import { describe, expect, it } from 'vitest'
import {
  applySceneFilter,
  computeSceneCounts,
  normalizeExtensionItems
} from '../extension-filtering'

describe('extension-filtering', () => {
  it('hides commands when in remote mode', () => {
    const items = normalizeExtensionItems({
      skills: [
        { name: 'skill-a', path: '/tmp/skill-a', source: 'app', sceneTags: ['coding'] }
      ],
      agents: [
        { name: 'agent-a', path: '/tmp/agent-a', source: 'global', sceneTags: ['writing'] }
      ],
      commands: [
        { name: 'command-a', path: '/tmp/command-a', source: 'app', sceneTags: ['web'] }
      ],
      isRemote: true
    })

    expect(items.map((item) => item.type)).toEqual(['skill', 'agent'])
  })

  it('falls back to office scene and supports scene counting/filtering', () => {
    const items = normalizeExtensionItems({
      skills: [
        { name: 'skill-a', path: '/tmp/skill-a', source: 'app' }
      ],
      agents: [],
      commands: [],
      isRemote: false
    })

    expect(items[0]?.sceneTags).toEqual(['office'])
    expect(computeSceneCounts(items).office).toBe(1)
    expect(applySceneFilter(items, 'office')).toHaveLength(1)
    expect(applySceneFilter(items, 'coding')).toHaveLength(0)
  })
})
