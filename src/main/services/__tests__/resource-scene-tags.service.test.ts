import { describe, expect, it } from 'vitest'
import { inferSceneTags, resolveSceneTags } from '../resource-scene-tags.service'

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
})
