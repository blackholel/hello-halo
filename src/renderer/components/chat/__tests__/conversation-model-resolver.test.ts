import { describe, expect, it } from 'vitest'
import type { ConversationMeta } from '../../../types'
import type { AiConfig } from '../../../../shared/types/ai-profile'
import { resolveConversationModelInfo } from '../conversation-model'

const baseConversation: ConversationMeta = {
  id: 'c1',
  spaceId: 's1',
  title: 'demo',
  createdAt: '',
  updatedAt: '',
  messageCount: 0
}

const aiConfig: AiConfig = {
  defaultProfileId: 'p-default',
  profiles: [
    {
      id: 'p-default',
      name: 'Default',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'k',
      defaultModel: 'gpt-4o-mini',
      modelCatalog: ['gpt-4o-mini'],
      enabled: true
    },
    {
      id: 'p-alt',
      name: 'Alt',
      vendor: 'moonshot',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'k2',
      defaultModel: 'kimi-k2-thinking',
      modelCatalog: ['kimi-k2-thinking'],
      enabled: true
    }
  ]
}

describe('resolveConversationModelInfo', () => {
  it('uses modelOverride with highest priority', () => {
    const info = resolveConversationModelInfo({
      ...baseConversation,
      ai: { profileId: 'p-alt', modelOverride: 'kimi-k2-turbo-preview' }
    }, aiConfig, 'Default profile')

    expect(info.effectiveModel).toBe('kimi-k2-turbo-preview')
    expect(info.profileName).toBe('Alt')
    expect(info.vendor).toBe('moonshot')
  })

  it('falls back to default profile when conversation profile missing', () => {
    const info = resolveConversationModelInfo({
      ...baseConversation,
      ai: { profileId: 'missing-profile' }
    }, aiConfig, 'Default profile')

    expect(info.effectiveModel).toBe('gpt-4o-mini')
    expect(info.profileName).toBe('Default')
    expect(info.vendor).toBe('openai')
  })

  it('returns safe defaults when profile config is empty', () => {
    const info = resolveConversationModelInfo(baseConversation, null, 'Default profile')

    expect(info.effectiveModel).toBe('')
    expect(info.profileName).toBe('Default profile')
    expect(info.vendor).toBeUndefined()
  })
})
