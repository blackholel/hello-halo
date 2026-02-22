import { describe, expect, it } from 'vitest'
import {
  extractDescriptionFromContent,
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
})
