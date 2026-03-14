import { describe, expect, it } from 'vitest'
import type { ApiProfile } from '../../../types'
import {
  AI_PROFILE_TEMPLATES,
  isValidAnthropicCompatEndpoint,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  normalizeModelCatalogForDefaultModelChange,
  normalizeProfileForSave
} from '../aiProfileDomain'

describe('ai profile domain', () => {
  it('isValidOpenAICompatEndpoint should accept /responses and /chat/completions', () => {
    expect(isValidOpenAICompatEndpoint('https://api.openai.com/v1/responses')).toBe(true)
    expect(isValidOpenAICompatEndpoint('https://provider.com/v1/chat/completions/')).toBe(true)
    expect(isValidOpenAICompatEndpoint('https://provider.com/v1')).toBe(false)
  })

  it('isValidAnthropicCompatEndpoint should reject OpenAI style endpoints', () => {
    expect(isValidAnthropicCompatEndpoint('https://provider.com/anthropic')).toBe(true)
    expect(isValidAnthropicCompatEndpoint('https://provider.com/v1/responses')).toBe(false)
    expect(isValidAnthropicCompatEndpoint('https://provider.com/v1/chat/completions/')).toBe(false)
  })

  it('normalizeModelCatalog should keep default model and remove duplicates', () => {
    const catalog = normalizeModelCatalog('gpt-4o-mini', [' gpt-4o-mini ', 'gpt-4.1-mini', 'gpt-4.1-mini'])
    expect(catalog).toEqual(['gpt-4o-mini', 'gpt-4.1-mini'])
  })

  it('normalizeModelCatalogForDefaultModelChange should not accumulate intermediate default model values', () => {
    const originalCatalog = ['gpt-5.4', 'gpt-4.1', 'gpt-4o-mini']
    const afterChange = normalizeModelCatalogForDefaultModelChange('gpt-5.3-codex', 'gpt-5.4', originalCatalog)
    expect(afterChange).toEqual(['gpt-5.3-codex', 'gpt-4.1', 'gpt-4o-mini'])
  })

  it('normalizeProfileForSave should trim fields and normalize catalog', () => {
    const raw: ApiProfile = {
      id: 'p1',
      name: '  Demo  ',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: ' https://api.openai.com/v1/responses ',
      apiKey: ' sk-123 ',
      defaultModel: ' gpt-4o-mini ',
      modelCatalog: ['gpt-4.1-mini'],
      docUrl: ' https://docs.example.com ',
      enabled: true
    }

    expect(normalizeProfileForSave(raw)).toEqual({
      ...raw,
      name: 'Demo',
      apiUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'sk-123',
      defaultModel: 'gpt-4o-mini',
      modelCatalog: ['gpt-4o-mini', 'gpt-4.1-mini'],
      docUrl: 'https://docs.example.com'
    })
  })

  it('OpenAI template should support responses endpoint and common model variants', () => {
    const openaiTemplate = AI_PROFILE_TEMPLATES.find(item => item.key === 'openai')
    expect(openaiTemplate).toBeDefined()
    expect(openaiTemplate?.apiUrl).toContain('/responses')
    expect(openaiTemplate?.modelCatalog).toEqual(
      expect.arrayContaining(['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-codex', 'gpt-5.3-codex'])
    )
    expect(AI_PROFILE_TEMPLATES.some(item => item.key === 'tabcode')).toBe(false)
  })
})
