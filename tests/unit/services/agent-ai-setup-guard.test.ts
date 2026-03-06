import { describe, expect, it } from 'vitest'
import { assertAiProfileConfigured } from '../../../src/main/services/agent/ai-setup-guard'

describe('assertAiProfileConfigured', () => {
  it('throws AI_PROFILE_NOT_CONFIGURED when profile key is missing', () => {
    try {
      assertAiProfileConfigured({
        ai: {
          profiles: [
            {
              id: 'p1',
              name: 'Default',
              vendor: 'anthropic',
              protocol: 'anthropic_official',
              apiUrl: 'https://api.anthropic.com',
              apiKey: '',
              defaultModel: 'claude-opus-4-5-20251101',
              modelCatalog: ['claude-opus-4-5-20251101'],
              enabled: true
            }
          ],
          defaultProfileId: 'p1'
        }
      })
      throw new Error('Expected assertAiProfileConfigured to throw')
    } catch (error) {
      const err = error as Error & { errorCode?: string }
      expect(err.errorCode).toBe('AI_PROFILE_NOT_CONFIGURED')
      expect(err.message).toBe('Please configure AI profile first')
    }
  })

  it('does not throw when profile is valid', () => {
    expect(() =>
      assertAiProfileConfigured({
        ai: {
          profiles: [
            {
              id: 'p1',
              name: 'OpenAI',
              vendor: 'openai',
              protocol: 'openai_compat',
              apiUrl: 'https://api.openai.com/v1/responses',
              apiKey: 'sk-test',
              defaultModel: 'gpt-4o-mini',
              modelCatalog: ['gpt-4o-mini'],
              enabled: true
            }
          ],
          defaultProfileId: 'p1'
        }
      })
    ).not.toThrow()
  })
})
