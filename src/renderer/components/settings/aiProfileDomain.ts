import type { ApiProfile, ProviderProtocol, ProviderVendor } from '../../types'
import { DEFAULT_MODEL } from '../../types'

export interface AiProfileTemplate {
  key: string
  label: string
  vendor: ProviderVendor
  protocol: ProviderProtocol
  apiUrl: string
  defaultModel: string
  modelCatalog: string[]
  docUrl: string
}

export const AI_PROFILE_TEMPLATES: AiProfileTemplate[] = [
  {
    key: 'minimax',
    label: 'MiniMax',
    vendor: 'minimax',
    protocol: 'anthropic_compat',
    apiUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.5',
    modelCatalog: ['MiniMax-M2.5'],
    docUrl: 'https://platform.minimaxi.com/docs/coding-plan/claude-code'
  },
  {
    key: 'moonshot',
    label: 'Kimi / Moonshot',
    vendor: 'moonshot',
    protocol: 'anthropic_compat',
    apiUrl: 'https://api.moonshot.cn/anthropic',
    defaultModel: 'kimi-k2-thinking',
    modelCatalog: ['kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
    docUrl: 'https://platform.moonshot.cn/docs/guide/agent-support'
  },
  {
    key: 'glm',
    label: 'GLM',
    vendor: 'zhipu',
    protocol: 'anthropic_compat',
    apiUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultModel: 'glm-4.7',
    modelCatalog: ['glm-4.7'],
    docUrl: 'https://open.bigmodel.cn/dev/api'
  },
  {
    key: 'openai',
    label: 'OpenAI',
    vendor: 'openai',
    protocol: 'openai_compat',
    apiUrl: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-4o-mini',
    modelCatalog: ['gpt-4o-mini', 'gpt-4.1-mini'],
    docUrl: 'https://platform.openai.com/docs/api-reference/responses'
  },
  {
    key: 'anthropic_official',
    label: 'Anthropic 官方',
    vendor: 'anthropic',
    protocol: 'anthropic_official',
    apiUrl: 'https://api.anthropic.com',
    defaultModel: DEFAULT_MODEL,
    modelCatalog: [DEFAULT_MODEL],
    docUrl: 'https://docs.anthropic.com'
  },
  {
    key: 'anthropic_compat',
    label: 'Anthropic 兼容',
    vendor: 'anthropic',
    protocol: 'anthropic_compat',
    apiUrl: 'https://provider.example.com/anthropic',
    defaultModel: DEFAULT_MODEL,
    modelCatalog: [DEFAULT_MODEL],
    docUrl: 'https://docs.anthropic.com'
  }
]

export const VENDOR_LABELS: Record<ProviderVendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  zhipu: 'GLM',
  minimax: 'MiniMax',
  moonshot: 'Kimi / Moonshot',
  custom: 'Custom'
}

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic_official: 'Anthropic Official',
  anthropic_compat: 'Anthropic Compatible',
  openai_compat: 'OpenAI Compatible'
}

export const API_KEY_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'sk-ant-xxxxxxxxxxxxx',
  anthropic_compat: 'sk-ant-xxxxxxxxxxxxx',
  openai_compat: 'sk-xxxxxxxxxxxxx'
}

export const API_URL_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'https://api.anthropic.com',
  anthropic_compat: 'https://provider.example.com/anthropic',
  openai_compat: 'https://provider.example.com/v1/chat/completions or /v1/responses'
}

export function isValidOpenAICompatEndpoint(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') || normalized.endsWith('/responses')
}

export function normalizeModelCatalog(defaultModel: string, rawCatalog: string[] | string): string[] {
  const normalizedDefaultModel = defaultModel.trim() || DEFAULT_MODEL
  const rawItems = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog
      .split(',')
      .map(item => item.trim())

  const deduped: string[] = []
  for (const item of rawItems) {
    const normalizedItem = item.trim()
    if (!normalizedItem || deduped.includes(normalizedItem)) {
      continue
    }
    deduped.push(normalizedItem)
  }

  if (!deduped.includes(normalizedDefaultModel)) {
    deduped.unshift(normalizedDefaultModel)
  }

  return deduped
}

export function normalizeProfileForSave(profile: ApiProfile): ApiProfile {
  const defaultModel = profile.defaultModel.trim() || DEFAULT_MODEL
  return {
    ...profile,
    name: profile.name.trim() || 'Profile',
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    defaultModel,
    modelCatalog: normalizeModelCatalog(defaultModel, profile.modelCatalog),
    docUrl: profile.docUrl?.trim() || undefined
  }
}
