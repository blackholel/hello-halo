import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => {
      if (options?.name) {
        return key.replace('{name}', options.name)
      }
      return key
    }
  })
}))

vi.mock('../../skills/SkillSuggestionCard', async () => {
  const actual = await vi.importActual<typeof import('../../skills/SkillSuggestionCard')>(
    '../../skills/SkillSuggestionCard'
  )

  return {
    ...actual,
    ResourceSuggestionCard: ({ suggestion }: { suggestion: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'resource-suggestion-card' }, suggestion.name)
  }
})

import { MarkdownRenderer } from '../MarkdownRenderer'

describe('MarkdownRenderer suggestion rendering', () => {
  it('保留混合消息正文，并在代码块 suggestion 时渲染建议卡片', () => {
    const content = [
      '先看下这个方案说明：',
      '',
      '```json',
      '{',
      '  "type": "skill_suggestion",',
      '  "name": "release-check",',
      '  "description": "发布前检查",',
      '  "content": "run checks"',
      '}',
      '```'
    ].join('\n')

    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content,
        workDir: '/tmp/workdir'
      })
    )

    expect(html).toContain('先看下这个方案说明：')
    expect(html).toContain('data-testid="resource-suggestion-card"')
    expect(html).toContain('release-check')
  })

  it('纯 suggestion payload 仍然直接渲染建议卡片', () => {
    const content = JSON.stringify(
      {
        type: 'skill_suggestion',
        name: 'quality-gate',
        description: '质量门禁',
        content: 'run tests'
      },
      null,
      2
    )

    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content,
        workDir: '/tmp/workdir'
      })
    )

    expect(html).toContain('data-testid="resource-suggestion-card"')
    expect(html).toContain('quality-gate')
  })
})
