/**
 * Provider Resolution
 *
 * Unified logic for selecting and configuring API providers.
 * Eliminates duplicate provider selection code in ensureSessionWarm() and sendMessage().
 */

import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../openai-compat-router'

/**
 * API configuration from config.service
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
}

/**
 * Infer OpenAI wire API type from URL or environment
 */
export function inferOpenAIWireApi(apiUrl: string): 'responses' | 'chat_completions' {
  const envApiType = process.env.HALO_OPENAI_API_TYPE || process.env.HALO_OPENAI_WIRE_API
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
 * - 'anthropic': Official Anthropic API - direct connection
 * - 'anthropic-compat' / 'custom' / 'zhipu' / 'minimax': Anthropic-compatible backends - direct connection
 * - 'openai': OpenAI-compatible backends - requires protocol conversion via local Router
 *
 * @param apiConfig - API configuration from config.service
 * @param defaultModel - Default model to use if not specified
 * @returns Resolved provider configuration
 */
export async function resolveProvider(
  apiConfig: ApiConfig,
  defaultModel = 'claude-opus-4-5-20251101'
): Promise<ResolvedProvider> {
  let anthropicBaseUrl = apiConfig.apiUrl
  let anthropicApiKey = apiConfig.apiKey
  let sdkModel = apiConfig.model || defaultModel

  const provider = apiConfig.provider

  if (
    provider === 'anthropic-compat' ||
    provider === 'custom' ||
    provider === 'zhipu' ||
    provider === 'minimax'
  ) {
    // Direct connection mode: Just point SDK to user's Anthropic-compatible backend
    // No Router needed - the backend speaks Anthropic protocol natively
  } else if (provider === 'openai') {
    // OpenAI compatibility mode: enable local Router for protocol conversion
    // - apiConfig.apiUrl/apiKey holds user's "real OpenAI-compatible backend" info
    // - ANTHROPIC_* injected to Claude Code points to local Router
    // - Pass a fake Claude model name to CC (CC may validate model must start with claude-*)
    //   Real model is in encodeBackendConfig, Router uses it for requests
    const router = await ensureOpenAICompatRouter({ debug: false })
    anthropicBaseUrl = router.baseUrl
    const apiType = inferOpenAIWireApi(apiConfig.apiUrl)
    anthropicApiKey = encodeBackendConfig({
      url: apiConfig.apiUrl,
      key: apiConfig.apiKey,
      model: apiConfig.model, // Real model passed to Router
      ...(apiType ? { apiType } : {})
    })
    // Pass a fake Claude model to CC for normal request handling
    sdkModel = 'claude-sonnet-4-20250514'
  }

  return {
    anthropicBaseUrl,
    anthropicApiKey,
    sdkModel
  }
}
