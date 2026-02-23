/**
 * Shared AI profile types and compatibility helpers.
 *
 * New model: config.ai (profiles + defaultProfileId)
 * Legacy compatibility: config.api (single provider/model)
 */

export const LEGACY_API_PROVIDERS = [
  'anthropic',
  'anthropic-compat',
  'openai',
  'zhipu',
  'minimax',
  'custom'
] as const

export type LegacyApiProvider = (typeof LEGACY_API_PROVIDERS)[number]

export interface LegacyApiConfig {
  provider: LegacyApiProvider
  apiKey: string
  apiUrl: string
  model: string
}

export type ProviderVendor =
  | 'anthropic'
  | 'openai'
  | 'zhipu'
  | 'minimax'
  | 'moonshot'
  | 'custom'
export type ProviderProtocol = 'anthropic_official' | 'anthropic_compat' | 'openai_compat'

export interface ApiProfile {
  id: string
  name: string
  vendor: ProviderVendor
  protocol: ProviderProtocol
  apiUrl: string
  apiKey: string
  defaultModel: string
  modelCatalog: string[]
  docUrl?: string
  enabled: boolean
}

export interface ConversationAiConfig {
  profileId: string
  modelOverride?: string
}

export interface AiConfig {
  profiles: ApiProfile[]
  defaultProfileId: string
}

export const LEGACY_DEFAULT_PROFILE_ID = 'legacy-default'
export const LEGACY_DEFAULT_PROFILE_NAME = 'Default'
export const DEFAULT_LEGACY_MODEL = 'claude-opus-4-5-20251101'

export const DEFAULT_LEGACY_API_CONFIG: LegacyApiConfig = {
  provider: 'anthropic',
  apiKey: '',
  apiUrl: 'https://api.anthropic.com',
  model: DEFAULT_LEGACY_MODEL
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isLegacyApiProvider(value: unknown): value is LegacyApiProvider {
  return typeof value === 'string' && (LEGACY_API_PROVIDERS as readonly string[]).includes(value)
}

function isVendor(value: unknown): value is ProviderVendor {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'zhipu' ||
    value === 'minimax' ||
    value === 'moonshot' ||
    value === 'custom'
  )
}

function isProtocol(value: unknown): value is ProviderProtocol {
  return value === 'anthropic_official' || value === 'anthropic_compat' || value === 'openai_compat'
}

export function legacyProviderToVendor(provider: LegacyApiProvider): ProviderVendor {
  if (provider === 'openai') return 'openai'
  if (provider === 'zhipu') return 'zhipu'
  if (provider === 'minimax') return 'minimax'
  if (provider === 'custom') return 'custom'
  return 'anthropic'
}

export function legacyProviderToProtocol(provider: LegacyApiProvider): ProviderProtocol {
  if (provider === 'anthropic') return 'anthropic_official'
  if (provider === 'openai') return 'openai_compat'
  return 'anthropic_compat'
}

export function vendorProtocolToLegacyProvider(
  vendor: ProviderVendor,
  protocol: ProviderProtocol
): LegacyApiProvider {
  if (protocol === 'openai_compat') return 'openai'
  if (vendor === 'zhipu') return 'zhipu'
  if (vendor === 'minimax') return 'minimax'
  if (vendor === 'custom') return 'custom'
  if (vendor === 'anthropic' && protocol === 'anthropic_official') return 'anthropic'
  return 'anthropic-compat'
}

export function ensureLegacyApiConfig(
  api: Partial<LegacyApiConfig> | null | undefined,
  fallback: LegacyApiConfig = DEFAULT_LEGACY_API_CONFIG
): LegacyApiConfig {
  const safeFallback: LegacyApiConfig = {
    provider: isLegacyApiProvider(fallback.provider)
      ? fallback.provider
      : DEFAULT_LEGACY_API_CONFIG.provider,
    apiKey: asString(fallback.apiKey, DEFAULT_LEGACY_API_CONFIG.apiKey),
    apiUrl: asString(fallback.apiUrl, DEFAULT_LEGACY_API_CONFIG.apiUrl),
    model: asString(fallback.model, DEFAULT_LEGACY_API_CONFIG.model)
  }

  if (!api) return safeFallback

  return {
    provider: isLegacyApiProvider(api.provider) ? api.provider : safeFallback.provider,
    apiKey: asString(api.apiKey, safeFallback.apiKey),
    apiUrl: asString(api.apiUrl, safeFallback.apiUrl),
    model: asString(api.model, safeFallback.model)
  }
}

export function createProfileFromLegacyApi(
  api: LegacyApiConfig,
  options: { id?: string; name?: string; enabled?: boolean } = {}
): ApiProfile {
  const safeApi = ensureLegacyApiConfig(api)
  const profileId = isNonEmptyString(options.id) ? options.id.trim() : LEGACY_DEFAULT_PROFILE_ID
  const profileName = isNonEmptyString(options.name) ? options.name.trim() : LEGACY_DEFAULT_PROFILE_NAME
  const defaultModel = safeApi.model || DEFAULT_LEGACY_MODEL

  return {
    id: profileId,
    name: profileName,
    vendor: legacyProviderToVendor(safeApi.provider),
    protocol: legacyProviderToProtocol(safeApi.provider),
    apiUrl: safeApi.apiUrl,
    apiKey: safeApi.apiKey,
    defaultModel,
    modelCatalog: defaultModel ? [defaultModel] : [],
    enabled: options.enabled ?? true
  }
}

export function profileToLegacyApi(profile: ApiProfile): LegacyApiConfig {
  return ensureLegacyApiConfig({
    provider: vendorProtocolToLegacyProvider(profile.vendor, profile.protocol),
    apiKey: profile.apiKey,
    apiUrl: profile.apiUrl,
    model: profile.defaultModel
  })
}

function normalizeModelCatalog(modelCatalog: unknown, defaultModel: string): string[] {
  if (!Array.isArray(modelCatalog)) {
    return defaultModel ? [defaultModel] : []
  }

  const normalized = modelCatalog
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)

  if (defaultModel && !normalized.includes(defaultModel)) {
    normalized.unshift(defaultModel)
  }

  return normalized
}

function normalizeProfile(
  rawProfile: Partial<ApiProfile>,
  fallbackApi: LegacyApiConfig,
  index: number
): ApiProfile {
  const fallback = createProfileFromLegacyApi(fallbackApi, {
    id: `${LEGACY_DEFAULT_PROFILE_ID}-${index}`,
    name: `${LEGACY_DEFAULT_PROFILE_NAME} ${index + 1}`
  })

  const defaultModel =
    isNonEmptyString(rawProfile.defaultModel) ? rawProfile.defaultModel.trim() : fallback.defaultModel

  return {
    id: isNonEmptyString(rawProfile.id) ? rawProfile.id.trim() : fallback.id,
    name: isNonEmptyString(rawProfile.name) ? rawProfile.name.trim() : fallback.name,
    vendor: isVendor(rawProfile.vendor) ? rawProfile.vendor : fallback.vendor,
    protocol: isProtocol(rawProfile.protocol) ? rawProfile.protocol : fallback.protocol,
    apiUrl: asString(rawProfile.apiUrl, fallback.apiUrl),
    apiKey: asString(rawProfile.apiKey, fallback.apiKey),
    defaultModel,
    modelCatalog: normalizeModelCatalog(rawProfile.modelCatalog, defaultModel),
    docUrl: isNonEmptyString(rawProfile.docUrl) ? rawProfile.docUrl.trim() : undefined,
    enabled: typeof rawProfile.enabled === 'boolean' ? rawProfile.enabled : true
  }
}

export function createAiConfigFromLegacyApi(
  api: LegacyApiConfig,
  options: { profileId?: string; profileName?: string } = {}
): AiConfig {
  const profile = createProfileFromLegacyApi(api, {
    id: options.profileId,
    name: options.profileName
  })

  return {
    profiles: [profile],
    defaultProfileId: profile.id
  }
}

export function selectDefaultProfileId(ai: Partial<AiConfig> | null | undefined): string | null {
  if (!ai || !Array.isArray(ai.profiles) || ai.profiles.length === 0) {
    return null
  }

  if (isNonEmptyString(ai.defaultProfileId)) {
    const found = ai.profiles.find(profile => profile && profile.id === ai.defaultProfileId)
    if (found) return found.id
  }

  return ai.profiles[0]?.id || null
}

export function ensureAiConfig(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): AiConfig {
  const safeFallbackApi = ensureLegacyApiConfig(fallbackApi, DEFAULT_LEGACY_API_CONFIG)

  if (!ai || !Array.isArray(ai.profiles) || ai.profiles.length === 0) {
    return createAiConfigFromLegacyApi(safeFallbackApi)
  }

  const profiles = ai.profiles.map((profile, index) =>
    normalizeProfile((profile ?? {}) as Partial<ApiProfile>, safeFallbackApi, index)
  )

  if (profiles.length === 0) {
    return createAiConfigFromLegacyApi(safeFallbackApi)
  }

  const defaultProfileId =
    isNonEmptyString(ai.defaultProfileId) && profiles.some(profile => profile.id === ai.defaultProfileId)
      ? ai.defaultProfileId
      : profiles[0].id

  return {
    profiles,
    defaultProfileId
  }
}

export function selectDefaultApiProfile(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): ApiProfile | null {
  const normalizedAi = ensureAiConfig(ai, fallbackApi)
  const profileId = selectDefaultProfileId(normalizedAi)
  if (!profileId) return null
  return normalizedAi.profiles.find(profile => profile.id === profileId) || null
}

export function mirrorAiToLegacyApi(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): LegacyApiConfig {
  const profile = selectDefaultApiProfile(ai, fallbackApi)
  if (!profile) return ensureLegacyApiConfig(fallbackApi, DEFAULT_LEGACY_API_CONFIG)
  return profileToLegacyApi(profile)
}

export function mirrorLegacyApiToAi(
  api: Partial<LegacyApiConfig> | null | undefined,
  currentAi: Partial<AiConfig> | null | undefined
): AiConfig {
  const fallbackFromAi = mirrorAiToLegacyApi(currentAi, DEFAULT_LEGACY_API_CONFIG)
  const normalizedApi = ensureLegacyApiConfig(api, fallbackFromAi)
  const normalizedAi = ensureAiConfig(currentAi, normalizedApi)
  const defaultProfileId = selectDefaultProfileId(normalizedAi) || LEGACY_DEFAULT_PROFILE_ID
  const existingProfile = normalizedAi.profiles.find(profile => profile.id === defaultProfileId)
  const profileName = existingProfile?.name || LEGACY_DEFAULT_PROFILE_NAME
  const mirroredProfile = createProfileFromLegacyApi(normalizedApi, {
    id: defaultProfileId,
    name: profileName,
    enabled: existingProfile?.enabled ?? true
  })

  return {
    ...normalizedAi,
    defaultProfileId,
    profiles: normalizedAi.profiles.map(profile =>
      profile.id === defaultProfileId ? { ...mirroredProfile, docUrl: profile.docUrl } : profile
    )
  }
}

export function isAiConfig(value: unknown): value is AiConfig {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<AiConfig>
  return Array.isArray(maybe.profiles) && typeof maybe.defaultProfileId === 'string'
}
