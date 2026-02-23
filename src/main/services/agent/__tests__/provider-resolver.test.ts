import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../openai-compat-router', () => ({
  ensureOpenAICompatRouter: vi.fn(),
  encodeBackendConfig: vi.fn()
}))

import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../../openai-compat-router'
import * as providerResolver from '../provider-resolver'

describe('provider-resolver', () => {
  const { resolveProvider, inferOpenAIWireApi, shouldEnableAnthropicCompatEnvDefaults } = providerResolver

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(ensureOpenAICompatRouter).mockResolvedValue({
      baseUrl: 'http://127.0.0.1:39200'
    } as any)
    vi.mocked(encodeBackendConfig).mockReturnValue('encoded-backend-config')
  })

  it('openai_compat 走本地 router 且使用 model override', async () => {
    const resolved = await resolveProvider({
      id: 'openai-profile',
      name: 'OpenAI',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'openai-key',
      defaultModel: 'gpt-4.1',
      modelCatalog: ['gpt-4.1'],
      enabled: true
    }, 'gpt-4o-mini')

    expect(resolved.anthropicBaseUrl).toBe('http://127.0.0.1:39200')
    expect(resolved.anthropicApiKey).toBe('encoded-backend-config')
    expect(resolved.sdkModel).toBe('claude-sonnet-4-20250514')
    expect(resolved.effectiveModel).toBe('gpt-4o-mini')
    expect(resolved.protocol).toBe('openai_compat')
    expect(resolved.useAnthropicCompatModelMapping).toBe(false)
    expect(ensureOpenAICompatRouter).toHaveBeenCalledTimes(1)
    expect(encodeBackendConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/responses',
        key: 'openai-key',
        model: 'gpt-4o-mini',
        apiType: 'responses'
      })
    )
  })

  it('anthropic_compat 第三方厂商默认直连 effective model', async () => {
    const resolved = await resolveProvider({
      id: 'glm-profile',
      name: 'GLM',
      vendor: 'zhipu',
      protocol: 'anthropic_compat',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'glm-key',
      defaultModel: 'glm-4.5',
      modelCatalog: ['glm-4.5'],
      enabled: true
    }, 'glm-4.5-thinking')

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      anthropicApiKey: 'glm-key',
      sdkModel: 'glm-4.5-thinking',
      effectiveModel: 'glm-4.5-thinking',
      protocol: 'anthropic_compat',
      vendor: 'zhipu',
      useAnthropicCompatModelMapping: false
    })
  })

  it('moonshot anthropic_compat 直传 model 到 sdkModel', async () => {
    const resolved = await resolveProvider({
      id: 'moonshot-profile',
      name: 'Moonshot (Kimi)',
      vendor: 'moonshot',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'moonshot-key',
      defaultModel: 'kimi-k2-turbo',
      modelCatalog: ['kimi-k2-turbo'],
      enabled: true
    }, 'kimi-k2-0905-preview')

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://api.moonshot.cn/anthropic',
      anthropicApiKey: 'moonshot-key',
      sdkModel: 'kimi-k2-0905-preview',
      effectiveModel: 'kimi-k2-0905-preview',
      protocol: 'anthropic_compat',
      vendor: 'moonshot',
      useAnthropicCompatModelMapping: false
    })
  })

  it('设置 KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING=1 时启用映射模式', async () => {
    vi.stubEnv('KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING', '1')

    const resolved = await resolveProvider({
      id: 'glm-profile',
      name: 'GLM',
      vendor: 'zhipu',
      protocol: 'anthropic_compat',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'glm-key',
      defaultModel: 'glm-4.5',
      modelCatalog: ['glm-4.5'],
      enabled: true
    }, 'glm-4.5-thinking')

    expect(resolved.sdkModel).toBe('claude-sonnet-4-20250514')
    expect(resolved.useAnthropicCompatModelMapping).toBe(true)
  })

  it('兼容 legacy ApiConfig 输入', async () => {
    const resolved = await resolveProvider({
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com',
      apiKey: 'legacy-key',
      model: 'claude-3-7-sonnet'
    })

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://api.anthropic.com',
      anthropicApiKey: 'legacy-key',
      sdkModel: 'claude-3-7-sonnet',
      effectiveModel: 'claude-3-7-sonnet',
      protocol: 'anthropic_official',
      vendor: undefined,
      useAnthropicCompatModelMapping: false
    })
  })

  it('inferOpenAIWireApi 优先读取 env 判定 wire api', () => {
    vi.stubEnv('KITE_OPENAI_API_TYPE', 'chat_completions')
    expect(inferOpenAIWireApi('https://api.openai.com/v1/responses')).toBe('chat_completions')

    vi.unstubAllEnvs()
    vi.stubEnv('KITE_OPENAI_WIRE_API', 'responses')
    expect(inferOpenAIWireApi('https://api.openai.com/v1/chat/completions')).toBe('responses')
  })

  it('compat env 判定：moonshot/minimax/zhipu 启用，anthropic 官方禁用', () => {
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'moonshot', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'minimax', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'zhipu', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_official', 'anthropic', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'anthropic', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('openai_compat', 'moonshot', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', undefined, false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'custom', true)).toBe(true)
  })
})
