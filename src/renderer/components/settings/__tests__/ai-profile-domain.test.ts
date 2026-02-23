import { describe, expect, it } from 'vitest'
import type { ApiProfile } from '../../../types'
import {
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  normalizeProfileForSave
} from '../aiProfileDomain'

describe('ai profile domain', () => {
  it('isValidOpenAICompatEndpoint should accept /responses and /chat/completions', () => {
    expect(isValidOpenAICompatEndpoint('https://api.openai.com/v1/responses')).toBe(true)
    expect(isValidOpenAICompatEndpoint('https://provider.com/v1/chat/completions/')).toBe(true)
    expect(isValidOpenAICompatEndpoint('https://provider.com/v1')).toBe(false)
  })

  it('normalizeModelCatalog should keep default model and remove duplicates', () => {
    const catalog = normalizeModelCatalog('gpt-4o-mini', [' gpt-4o-mini ', 'gpt-4.1-mini', 'gpt-4.1-mini'])
    expect(catalog).toEqual(['gpt-4o-mini', 'gpt-4.1-mini'])
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
})
