import { describe, expect, it } from 'vitest'
import {
  applySceneFilter,
  computeSceneCounts,
  normalizeExtensionItems
} from '../extension-filtering'
import { DEFAULT_SCENE_DEFINITIONS } from '../../../../shared/scene-taxonomy'

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
      isRemote: true,
      sceneDefinitions: DEFAULT_SCENE_DEFINITIONS
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
      isRemote: false,
      sceneDefinitions: DEFAULT_SCENE_DEFINITIONS
    })

    expect(items[0]?.sceneTags).toEqual(['office'])
    expect(computeSceneCounts(items, DEFAULT_SCENE_DEFINITIONS.map((item) => item.key)).office).toBe(1)
    expect(applySceneFilter(items, 'office')).toHaveLength(1)
    expect(applySceneFilter(items, 'coding')).toHaveLength(0)
  })

  it('prefers localized displayName for extension cards and search', () => {
    const items = normalizeExtensionItems({
      skills: [
        {
          name: 'review',
          displayName: '代码审查',
          description: '技能描述',
          path: '/tmp/review',
          source: 'app',
          sceneTags: ['coding']
        }
      ],
      agents: [],
      commands: [],
      isRemote: false,
      sceneDefinitions: DEFAULT_SCENE_DEFINITIONS
    })

    expect(items[0]?.displayName).toBe('代码审查')
    expect(items[0]?.searchable.includes('代码审查'.toLowerCase())).toBe(true)
  })
})
