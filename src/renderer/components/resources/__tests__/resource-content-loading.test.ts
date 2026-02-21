import { describe, expect, it } from 'vitest'
import { shouldLoadResourceContent } from '../resource-content-loading'

describe('resource content loading', () => {
  it('同一次打开内加载失败后不自动重试', () => {
    expect(shouldLoadResourceContent({
      isOpen: true,
      hasContent: false,
      hasError: true,
      hasAttemptedInCurrentOpen: true
    })).toBe(false)
  })

  it('首次打开且无内容时触发加载', () => {
    expect(shouldLoadResourceContent({
      isOpen: true,
      hasContent: false,
      hasError: false,
      hasAttemptedInCurrentOpen: false
    })).toBe(true)
  })

  it('已有成功内容时不重复加载', () => {
    expect(shouldLoadResourceContent({
      isOpen: true,
      hasContent: true,
      hasError: false,
      hasAttemptedInCurrentOpen: true
    })).toBe(false)
  })
})
