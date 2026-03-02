import { describe, expect, it } from 'vitest'
import {
  composeInputMessage,
  parseComposerMessageForDisplay,
  removeTriggerTokenText
} from '../../../src/renderer/utils/composer-resource-chip'

describe('composer-resource-chip utils', () => {
  it('composeInputMessage: 仅资源标签时返回英文 token 串', () => {
    const message = composeInputMessage('', [
      { id: 'a', type: 'skill', displayName: '前端设计', token: '/web-design-guidelines' },
      { id: 'b', type: 'command', displayName: '代码评审', token: '/everything-claude-code:code-review' }
    ])
    expect(message).toBe('/web-design-guidelines /everything-claude-code:code-review')
  })

  it('composeInputMessage: 标签 + 文本混合拼接', () => {
    const message = composeInputMessage('帮我审一下这个 PR', [
      { id: 'a', type: 'command', displayName: '代码评审', token: '/everything-claude-code:code-review' }
    ])
    expect(message).toBe('/everything-claude-code:code-review 帮我审一下这个 PR')
  })

  it('removeTriggerTokenText: 移除触发 token 后保持文本连贯', () => {
    const text = '请用 /web-design-guidelines 帮我看看'
    const context = {
      type: 'slash' as const,
      start: 3,
      end: 25,
      query: 'web-design-guidelines'
    }
    const result = removeTriggerTokenText(text, context)
    expect(result.value).toBe('请用 帮我看看')
    expect(result.caret).toBe(3)
  })

  it('parseComposerMessageForDisplay: 解析前缀 token 为展示 chip，正文保留', () => {
    const parsed = parseComposerMessageForDisplay(
      '/frontend-design /everything-claude-code:tdd 家里人法儿',
      {
        skills: new Map([['frontend-design', '前端设计']]),
        commands: new Map([['everything-claude-code:tdd', '测试驱动开发']]),
        agents: new Map()
      }
    )

    expect(parsed.chips.map(chip => `${chip.type}:${chip.displayName}`)).toEqual([
      'skill:前端设计',
      'command:测试驱动开发'
    ])
    expect(parsed.text).toBe('家里人法儿')
  })

  it('parseComposerMessageForDisplay: 遇到未知 token 不强行替换，避免误渲染', () => {
    const parsed = parseComposerMessageForDisplay(
      '/unknown-token 帮我看看',
      {
        skills: new Map(),
        commands: new Map(),
        agents: new Map()
      }
    )

    expect(parsed.chips).toHaveLength(0)
    expect(parsed.text).toBe('/unknown-token 帮我看看')
  })
})
