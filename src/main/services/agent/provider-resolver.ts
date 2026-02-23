/**
 * Provider Resolution
 *
 * Unified logic for selecting and configuring API providers.
 * Eliminates duplicate provider selection code in ensureSessionWarm() and sendMessage().
 */

import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../openai-compat-router'
import type { ApiProfile, ProviderProtocol } from '../../../shared/types/ai-profile'

/**
 * Legacy API configuration from config.service (backward compatibility).
 */
export interface ApiConfig {
  provider?: string
  apiUrl: string
  apiKey: string
  model?: string
}

/**
 * Resolved provider configuration ready for SDK
 */
export interface ResolvedProvider {
  anthropicBaseUrl: string
  anthropicApiKey: string
  sdkModel: string
  effectiveModel: string
  protocol: ProviderProtocol
  vendor?: ApiProfile['vendor']
  useAnthropicCompatModelMapping: boolean
}

type ResolveProviderInput = ApiProfile | ApiConfig

const DEFAULT_MODEL = 'claude-opus-4-5-20251101'
const OPENAI_COMPAT_SDK_MODEL = 'claude-sonnet-4-20250514'
const ANTHROPIC_COMPAT_ENV_DEFAULT_TIMEOUT_MS = '3000000'
const ANTHROPIC_COMPAT_ENV_DEFAULT_VENDORS = new Set([
  'minimax',
  'moonshot',
  'zhipu',
  'topic',
  'custom'
])

function normalizeModel(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isApiProfile(input: ResolveProviderInput): input is ApiProfile {
  const maybeProfile = input as Partial<ApiProfile>
  return typeof maybeProfile.id === 'string' && typeof maybeProfile.protocol === 'string'
}

function toProtocol(provider: string | undefined): ProviderProtocol {
  if (provider === 'openai') return 'openai_compat'
  if (provider === 'anthropic') return 'anthropic_official'
  return 'anthropic_compat'
}

export function shouldEnableAnthropicCompatEnvDefaults(
  protocol: ProviderProtocol,
  vendor?: ApiProfile['vendor'] | string,
  useAnthropicCompatModelMapping = false
): boolean {
  if (useAnthropicCompatModelMapping) return true
  if (protocol !== 'anthropic_compat') return false
  if (!vendor) return false

  const normalizedVendor = vendor.trim().toLowerCase()
  if (normalizedVendor === 'anthropic') return false

  return ANTHROPIC_COMPAT_ENV_DEFAULT_VENDORS.has(normalizedVendor)
}

export function buildAnthropicCompatEnvDefaults(effectiveModel: string): Record<string, string> {
  return {
    API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || ANTHROPIC_COMPAT_ENV_DEFAULT_TIMEOUT_MS,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ANTHROPIC_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: effectiveModel
  }
}

function resolveInput(
  input: ResolveProviderInput,
  modelHint: string
): {
  protocol: ProviderProtocol
  vendor?: ApiProfile['vendor']
  apiUrl: string
  apiKey: string
  effectiveModel: string
} {
  if (isApiProfile(input)) {
    return {
      protocol: input.protocol,
      vendor: input.vendor,
      apiUrl: input.apiUrl,
      apiKey: input.apiKey,
      effectiveModel: normalizeModel(modelHint) || normalizeModel(input.defaultModel) || DEFAULT_MODEL
    }
  }

  return {
    protocol: toProtocol(input.provider),
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    effectiveModel: normalizeModel(input.model) || normalizeModel(modelHint) || DEFAULT_MODEL
  }
}

/**
 * Infer OpenAI wire API type from URL or environment
 */
export function inferOpenAIWireApi(apiUrl: string): 'responses' | 'chat_completions' {
  const envApiType = process.env.KITE_OPENAI_API_TYPE || process.env.KITE_OPENAI_WIRE_API
  if (envApiType) {
    const v = envApiType.toLowerCase()
    if (v.includes('response')) return 'responses'
    if (v.includes('chat')) return 'chat_completions'
  }
  if (apiUrl && apiUrl.includes('/responses')) return 'responses'
  // Default to responses (OpenAI new API format)
  return 'responses'
}

/**
 * Resolve provider configuration for SDK
 *
 * Provider modes:
 * - anthropic_official: Official Anthropic API - direct connection
 * - anthropic_compat: Anthropic-compatible backends - direct connection
 * - openai_compat: OpenAI-compatible backends - requires protocol conversion via local Router
 *
 * Backward compatibility:
 * - ApiProfile input: second parameter is `modelOverride`
 * - Legacy ApiConfig input: second parameter is `defaultModel`
 * @returns Resolved provider configuration
 */
export async function resolveProvider(
  profile: ApiProfile,
  modelOverride?: string
): Promise<ResolvedProvider>
export async function resolveProvider(
  apiConfig: ApiConfig,
  defaultModel?: string
): Promise<ResolvedProvider>
export async function resolveProvider(
  input: ResolveProviderInput,
  modelOverrideOrDefaultModel = DEFAULT_MODEL
): Promise<ResolvedProvider> {
  const resolved = resolveInput(input, modelOverrideOrDefaultModel)
  // Default: direct model passthrough for anthropic_compat vendors.
  // Opt-in mapping mode is kept for specific gateways that require Claude alias models.
  const forceCompatModelMapping = process.env.KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING === '1'
  const useAnthropicCompatModelMapping =
    forceCompatModelMapping &&
    resolved.protocol === 'anthropic_compat' &&
    !!resolved.vendor &&
    resolved.vendor !== 'anthropic'
  let anthropicBaseUrl = resolved.apiUrl
  let anthropicApiKey = resolved.apiKey
  let sdkModel = useAnthropicCompatModelMapping ? OPENAI_COMPAT_SDK_MODEL : resolved.effectiveModel

  if (resolved.protocol === 'openai_compat') {
    // OpenAI compatibility mode: enable local Router for protocol conversion
    // - resolved.apiUrl/apiKey holds user's "real OpenAI-compatible backend" info
    // - ANTHROPIC_* injected to Claude Code points to local Router
    // - Pass a fake Claude model name to CC (CC may validate model must start with claude-*)
    //   Real model is in encodeBackendConfig, Router uses it for requests
    const router = await ensureOpenAICompatRouter({ debug: false })
    anthropicBaseUrl = router.baseUrl
    const apiType = inferOpenAIWireApi(resolved.apiUrl)
    anthropicApiKey = encodeBackendConfig({
      url: resolved.apiUrl,
      key: resolved.apiKey,
      model: resolved.effectiveModel, // Real model passed to Router
      ...(apiType ? { apiType } : {})
    })
    // Pass a fake Claude model to CC for normal request handling
    sdkModel = OPENAI_COMPAT_SDK_MODEL
  }

  return {
    anthropicBaseUrl,
    anthropicApiKey,
    sdkModel,
    effectiveModel: resolved.effectiveModel,
    protocol: resolved.protocol,
    vendor: resolved.vendor,
    useAnthropicCompatModelMapping
  }
}
