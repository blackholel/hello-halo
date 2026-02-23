import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../../../shared/types/ai-profile'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn()
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn()
}))

import { getConfig } from '../../config.service'
import { getConversation } from '../../conversation.service'
import { resolveEffectiveConversationAi } from '../ai-config-resolver'

function createProfile(partial: Partial<ApiProfile>): ApiProfile {
  return {
    id: partial.id || 'p-default',
    name: partial.name || 'Default',
    vendor: partial.vendor || 'anthropic',
    protocol: partial.protocol || 'anthropic_official',
    apiUrl: partial.apiUrl || 'https://api.example.com',
    apiKey: partial.apiKey || 'key',
    defaultModel: partial.defaultModel || 'model-default',
    modelCatalog: partial.modelCatalog || ['model-default'],
    docUrl: partial.docUrl,
    enabled: partial.enabled ?? true
  }
}

describe('ai-config-resolver', () => {
  const defaultProfile = createProfile({
    id: 'p-default',
    defaultModel: 'default-model',
    vendor: 'anthropic',
    protocol: 'anthropic_official'
  })
  const altProfile = createProfile({
    id: 'p-alt',
    defaultModel: 'alt-model',
    vendor: 'minimax',
    protocol: 'anthropic_compat'
  })

  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      api: {
        provider: 'anthropic',
        apiKey: 'legacy-key',
        apiUrl: 'https://api.anthropic.com',
        model: 'legacy-model'
      },
      ai: {
        profiles: [defaultProfile, altProfile],
        defaultProfileId: 'p-default'
      }
    } as any)
  })

  it('优先使用 request.modelOverride', () => {
    vi.mocked(getConversation).mockReturnValue({
      ai: { profileId: 'p-alt', modelOverride: 'conv-model' }
    } as any)

    const resolved = resolveEffectiveConversationAi('space-1', 'conv-1', 'request-model')
    expect(resolved.profileId).toBe('p-alt')
    expect(resolved.effectiveModel).toBe('request-model')
    expect(resolved.isMiniMax).toBe(true)
    expect(resolved.disableToolsForCompat).toBe(false)
    expect(resolved.compatProviderName).toBeNull()
  })

  it('无 request override 时使用 conversation.modelOverride', () => {
    vi.mocked(getConversation).mockReturnValue({
      ai: { profileId: 'p-alt', modelOverride: 'conv-model' }
    } as any)

    const resolved = resolveEffectiveConversationAi('space-1', 'conv-1')
    expect(resolved.profileId).toBe('p-alt')
    expect(resolved.effectiveModel).toBe('conv-model')
  })

  it('conversation profile 不存在时回退 defaultProfileId', () => {
    vi.mocked(getConversation).mockReturnValue({
      ai: { profileId: 'p-missing' }
    } as any)

    const resolved = resolveEffectiveConversationAi('space-1', 'conv-1')
    expect(resolved.profileId).toBe('p-default')
    expect(resolved.effectiveModel).toBe('default-model')
    expect(resolved.providerSignature.length).toBeGreaterThan(0)
  })

  it('GLM anthropic_compat 不会被强制禁用功能', () => {
    vi.mocked(getConversation).mockReturnValue({
      ai: { profileId: 'p-glm' }
    } as any)
    vi.mocked(getConfig).mockReturnValue({
      api: {
        provider: 'anthropic',
        apiKey: 'legacy-key',
        apiUrl: 'https://api.anthropic.com',
        model: 'legacy-model'
      },
      ai: {
        profiles: [
          defaultProfile,
          createProfile({
            id: 'p-glm',
            vendor: 'zhipu',
            protocol: 'anthropic_compat',
            defaultModel: 'glm-5'
          })
        ],
        defaultProfileId: 'p-default'
      }
    } as any)

    const resolved = resolveEffectiveConversationAi('space-1', 'conv-1')
    expect(resolved.profileId).toBe('p-glm')
    expect(resolved.isMiniMax).toBe(false)
    expect(resolved.isGlmAnthropicCompat).toBe(true)
    expect(resolved.disableToolsForCompat).toBe(false)
    expect(resolved.disableThinkingForCompat).toBe(false)
    expect(resolved.disableAiBrowserForCompat).toBe(false)
    expect(resolved.disableImageForCompat).toBe(false)
    expect(resolved.compatProviderName).toBeNull()
  })

  it('Moonshot(Kimi) anthropic_compat profile 基本解析不降级', () => {
    vi.mocked(getConversation).mockReturnValue({
      ai: { profileId: 'p-moonshot' }
    } as any)
    vi.mocked(getConfig).mockReturnValue({
      api: {
        provider: 'anthropic',
        apiKey: 'legacy-key',
        apiUrl: 'https://api.anthropic.com',
        model: 'legacy-model'
      },
      ai: {
        profiles: [
          defaultProfile,
          createProfile({
            id: 'p-moonshot',
            name: 'Moonshot (Kimi)',
            vendor: 'moonshot',
            protocol: 'anthropic_compat',
            apiUrl: 'https://api.moonshot.cn/anthropic',
            defaultModel: 'kimi-k2-0905-preview',
            modelCatalog: ['kimi-k2-0905-preview']
          })
        ],
        defaultProfileId: 'p-default'
      }
    } as any)

    const resolved = resolveEffectiveConversationAi('space-1', 'conv-1')
    expect(resolved.profileId).toBe('p-moonshot')
    expect(resolved.profile.name).toBe('Moonshot (Kimi)')
    expect(resolved.profile.protocol).toBe('anthropic_compat')
    expect(resolved.effectiveModel).toBe('kimi-k2-0905-preview')
    expect(resolved.isMiniMax).toBe(false)
    expect(resolved.isGlmAnthropicCompat).toBe(false)
    expect(resolved.disableToolsForCompat).toBe(false)
    expect(resolved.disableThinkingForCompat).toBe(false)
    expect(resolved.disableAiBrowserForCompat).toBe(false)
    expect(resolved.disableImageForCompat).toBe(false)
    expect(resolved.compatProviderName).toBeNull()
  })
})
