import { describe, expect, it } from 'vitest'
import { inferSceneTags, resolveSceneTags } from '../resource-scene-tags.service'
import type { SceneDefinition } from '../../../shared/scene-taxonomy'

describe('resource-scene-tags.service', () => {
  it('prefers explicit frontmatter scene tags', () => {
    const tags = resolveSceneTags({
      name: 'demo',
      description: 'about coding',
      frontmatter: {
        sceneTags: ['writing', 'coding', 'writing']
      }
    })

    expect(tags).toEqual(['writing', 'coding'])
  })

  it('infers tags from description/category/triggers when explicit missing', () => {
    const tags = inferSceneTags({
      name: 'api-helper',
      description: 'browser automation for api requests and data report',
      category: 'web automation',
      triggers: ['scrape', 'http', 'report']
    })

    expect(tags.length).toBeGreaterThan(0)
    expect(tags[0]).toBe('web')
  })

  it('caps inferred tags to at most 3', () => {
    const tags = inferSceneTags({
      name: 'all-in-one',
      description: 'coding writing design data web office tools',
      content: 'code docs ui charts browser excel'
    })

    expect(tags.length).toBeLessThanOrEqual(3)
  })

  it('does not match short keywords by unrelated substrings', () => {
    const tags = inferSceneTags({
      name: 'archive-helper',
      description: 'Rapid build utility for backups'
    })

    expect(tags).toEqual([])
  })

  it('falls back to office when nothing matches', () => {
    const tags = resolveSceneTags({
      name: 'mystery-resource',
      description: 'zzz qqq yyy'
    })

    expect(tags).toEqual(['office'])
  })

  it('prioritizes resource override over frontmatter and inference', () => {
    const tags = resolveSceneTags({
      name: 'demo',
      frontmatter: { sceneTags: ['writing'] },
      resourceKey: 'skill:app:-:-:demo',
      resourceOverrides: {
        'skill:app:-:-:demo': ['coding']
      },
      definitions: [
        {
          key: 'coding',
          label: { en: 'Coding', zhCN: '编程开发', zhTW: '程式開發' },
          colorToken: 'blue',
          order: 10,
          enabled: true,
          builtin: true
        },
        {
          key: 'writing',
          label: { en: 'Writing', zhCN: '写作', zhTW: '寫作' },
          colorToken: 'green',
          order: 20,
          enabled: true,
          builtin: true
        },
        {
          key: 'office',
          label: { en: 'Office', zhCN: '办公套件', zhTW: '辦公套件' },
          colorToken: 'slate',
          order: 60,
          enabled: true,
          builtin: true
        }
      ]
    })

    expect(tags).toEqual(['coding'])
  })

  it('inference only considers enabled definitions', () => {
    const definitions: SceneDefinition[] = [
      {
        key: 'coding',
        label: { en: 'Coding', zhCN: '编程开发', zhTW: '程式開發' },
        colorToken: 'blue',
        order: 10,
        enabled: false,
        builtin: true
      },
      {
        key: 'writing',
        label: { en: 'Writing', zhCN: '写作', zhTW: '寫作' },
        colorToken: 'green',
        order: 20,
        enabled: true,
        builtin: true
      },
      {
        key: 'office',
        label: { en: 'Office', zhCN: '办公套件', zhTW: '辦公套件' },
        colorToken: 'slate',
        order: 60,
        enabled: true,
        builtin: true
      }
    ]
    const tags = inferSceneTags({
      name: 'code-helper',
      description: 'coding assistant',
      definitions
    })
    expect(tags).not.toContain('coding')
  })
})
