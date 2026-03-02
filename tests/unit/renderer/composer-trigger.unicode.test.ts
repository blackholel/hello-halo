import { describe, expect, it } from 'vitest'
import { getTriggerContext } from '../../../src/renderer/utils/composer-trigger'

describe('composer-trigger unicode support', () => {
  it('keeps existing namespace token characters for slash triggers', () => {
    const input = '/ns:cmd.v1-a_b'
    const ctx = getTriggerContext(input, input.length)
    expect(ctx?.type).toBe('slash')
    expect(ctx?.query).toBe('ns:cmd.v1-a_b')
  })

  it('supports Chinese slash token characters', () => {
    const input = '/发布检查'
    const ctx = getTriggerContext(input, input.length)
    expect(ctx?.type).toBe('slash')
    expect(ctx?.query).toBe('发布检查')
  })

  it('supports Chinese mention token characters while keeping separators', () => {
    const input = '@代理-助手_v1'
    const ctx = getTriggerContext(input, input.length)
    expect(ctx?.type).toBe('mention')
    expect(ctx?.query).toBe('代理-助手_v1')
  })
})
