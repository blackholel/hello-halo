import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENE_DEFINITIONS,
  isValidSceneTagKey,
  normalizeSceneTagKeys
} from '../../../shared/scene-taxonomy'

describe('scene-taxonomy shared contracts', () => {
  it('validates kebab-case scene tag keys', () => {
    expect(isValidSceneTagKey('marketing-ops')).toBe(true)
    expect(isValidSceneTagKey('marketing')).toBe(true)
    expect(isValidSceneTagKey('Marketing')).toBe(false)
    expect(isValidSceneTagKey('marketing_ops')).toBe(false)
    expect(isValidSceneTagKey('')).toBe(false)
  })

  it('normalizes tag keys with dedupe, limit and fallback', () => {
    const known = new Set(DEFAULT_SCENE_DEFINITIONS.map((item) => item.key))
    expect(
      normalizeSceneTagKeys(['coding', 'coding', 'web', 'data', 'writing'], known)
    ).toEqual(['coding', 'web', 'data'])

    expect(normalizeSceneTagKeys(['unknown'], known)).toEqual(['office'])
  })
})
