import { describe, expect, it } from 'vitest'
import {
  extractDescriptionFromContent,
  getLocalizedFrontmatterString,
  parseFrontmatter,
  stripFrontmatter
} from '../resource-metadata.service'

describe('resource-metadata.service', () => {
  it('parses frontmatter arrays and strings', () => {
    const content = [
      '---',
      'description: hello',
      'triggers:',
      '  - alpha',
      '  - beta',
      'sceneTags: coding, web',
      '---',
      '# Body'
    ].join('\n')

    const frontmatter = parseFrontmatter(content)
    expect(frontmatter).toEqual({
      description: 'hello',
      triggers: ['alpha', 'beta'],
      sceneTags: 'coding, web'
    })
  })

  it('strips frontmatter block correctly', () => {
    const content = [
      '---',
      'description: x',
      '---',
      '# Real title',
      'body'
    ].join('\n')

    expect(stripFrontmatter(content)).toBe('# Real title\nbody')
  })

  it('uses frontmatter.description before title and first line', () => {
    const content = [
      '---',
      'description: from frontmatter',
      '---',
      '# Title line',
      'normal text'
    ].join('\n')

    expect(extractDescriptionFromContent(content)).toBe('from frontmatter')
  })

  it('uses heading when frontmatter description is missing', () => {
    const content = [
      '---',
      'sceneTags:',
      '  - coding',
      '---',
      '# Heading wins',
      'plain text'
    ].join('\n')

    expect(extractDescriptionFromContent(content)).toBe('Heading wins')
  })

  it('falls back to first non-empty body line', () => {
    const content = ['plain text line', 'next line'].join('\n')
    expect(extractDescriptionFromContent(content)).toBe('plain text line')
  })

  it('resolves localized frontmatter values by locale key', () => {
    const content = [
      '---',
      'name: Review Assistant',
      'title_zh-CN: 审查助手',
      'description: Review code quality',
      'description_zh-CN: 审查代码质量',
      '---',
      '# Body'
    ].join('\n')

    const frontmatter = parseFrontmatter(content)
    expect(getLocalizedFrontmatterString(frontmatter, ['name', 'title'], 'zh-CN')).toBe('审查助手')
    expect(getLocalizedFrontmatterString(frontmatter, ['description'], 'zh-CN')).toBe('审查代码质量')
    expect(getLocalizedFrontmatterString(frontmatter, ['name', 'title'], 'zh_CN')).toBe('审查助手')
    expect(getLocalizedFrontmatterString(frontmatter, ['description'], 'zh_CN')).toBe('审查代码质量')
  })

  it('falls back from locale variant to language and base key', () => {
    const content = [
      '---',
      'description: Default text',
      'description_zh: 中文通用描述',
      '---',
      '# Body'
    ].join('\n')

    const frontmatter = parseFrontmatter(content)
    expect(getLocalizedFrontmatterString(frontmatter, ['description'], 'zh-TW')).toBe('中文通用描述')
    expect(getLocalizedFrontmatterString(frontmatter, ['description'], 'fr-FR')).toBe('Default text')
  })
})
