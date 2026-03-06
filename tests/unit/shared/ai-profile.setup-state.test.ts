import { describe, expect, it } from 'vitest'
import { getAiSetupState } from '../../../src/shared/types/ai-profile'

describe('getAiSetupState', () => {
  it('returns missing_profile when ai.profiles is explicitly empty', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [],
        defaultProfileId: ''
      },
      api: {
        provider: 'anthropic',
        apiKey: '',
        apiUrl: 'https://api.anthropic.com',
        model: 'claude-opus-4-5-20251101'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'missing_profile' })
  })

  it('returns missing_api_key when default profile has no key', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Default',
            vendor: 'anthropic',
            protocol: 'anthropic_official',
            apiUrl: 'https://api.anthropic.com',
            apiKey: '   ',
            defaultModel: 'claude-opus-4-5-20251101',
            modelCatalog: ['claude-opus-4-5-20251101'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'missing_api_key' })
  })

  it('returns disabled_profile when default profile is disabled', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Default',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.openai.com/v1/responses',
            apiKey: 'sk-test',
            defaultModel: 'gpt-4o-mini',
            modelCatalog: ['gpt-4o-mini'],
            enabled: false
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'disabled_profile' })
  })

  it('returns invalid_url for openai_compat profile with invalid endpoint', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'OpenAI',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            defaultModel: 'gpt-4o-mini',
            modelCatalog: ['gpt-4o-mini'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'invalid_url' })
  })

  it('returns configured=true when profile is valid', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Anthropic',
            vendor: 'anthropic',
            protocol: 'anthropic_official',
            apiUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-test',
            defaultModel: 'claude-sonnet-4-5-20250929',
            modelCatalog: ['claude-sonnet-4-5-20250929'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: true, reason: null })
  })
})
