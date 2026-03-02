import { describe, expect, it } from 'vitest'
import { getResourceDisplayName } from '../../../src/renderer/utils/resource-display-name'

describe('getResourceDisplayName', () => {
  it('prefers displayName and keeps namespace prefix', () => {
    const result = getResourceDisplayName({
      name: 'planner',
      displayName: '规划助手',
      namespace: 'superpowers'
    })
    expect(result).toBe('superpowers:规划助手')
  })

  it('falls back to name when displayName missing', () => {
    const result = getResourceDisplayName({ name: 'planner' })
    expect(result).toBe('planner')
  })
})
