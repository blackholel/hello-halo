/**
 * AI Config Resolver
 *
 * Resolve effective AI profile/model for one conversation.
 */

import { createHash } from 'crypto'
import { getConfig } from '../config.service'
import { getConversation } from '../conversation.service'
import {
  DEFAULT_LEGACY_MODEL,
  ensureAiConfig,
  type ApiProfile,
  type ConversationAiConfig
} from '../../../shared/types/ai-profile'

export interface EffectiveConversationAi {
  profile: ApiProfile
  profileId: string
  effectiveModel: string
  providerSignature: string
  isMiniMax: boolean
  isGlmAnthropicCompat: boolean
  disableToolsForCompat: boolean
  disableThinkingForCompat: boolean
  disableAiBrowserForCompat: boolean
  disableImageForCompat: boolean
  compatProviderName: string | null
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function readConversationAi(
  spaceId: string,
  conversationId: string
): Partial<ConversationAiConfig> | null {
  const conversation = getConversation(spaceId, conversationId) as
    | ({ ai?: Partial<ConversationAiConfig> | null } & Record<string, unknown>)
    | null

  if (!conversation || typeof conversation !== 'object') return null
  const rawAi = conversation.ai
  if (!rawAi || typeof rawAi !== 'object') return null
  return rawAi
}

function pickProfileById(profiles: ApiProfile[], profileId: string | undefined): ApiProfile | undefined {
  if (!profileId) return undefined
  return profiles.find(profile => profile.id === profileId)
}

export function buildProviderSignature(profile: ApiProfile): string {
  const raw = JSON.stringify({
    id: profile.id,
    vendor: profile.vendor,
    protocol: profile.protocol,
    apiUrl: profile.apiUrl,
    apiKey: profile.apiKey
  })
  return createHash('sha256').update(raw).digest('hex')
}

export function resolveEffectiveConversationAi(
  spaceId: string,
  conversationId: string,
  requestModelOverride?: string
): EffectiveConversationAi {
  const config = getConfig()
  const normalizedAiConfig = ensureAiConfig(config.ai, config.api)
  const conversationAi = readConversationAi(spaceId, conversationId)

  const requestedProfileId = toNonEmptyString(conversationAi?.profileId)
  const defaultProfileId = toNonEmptyString(normalizedAiConfig.defaultProfileId)
  const fallbackDefaultProfile = pickProfileById(normalizedAiConfig.profiles, defaultProfileId)
  const firstProfile = normalizedAiConfig.profiles[0]

  // If conversation profile is missing, always fallback to defaultProfileId first.
  const profile =
    pickProfileById(normalizedAiConfig.profiles, requestedProfileId) || fallbackDefaultProfile || firstProfile

  if (!profile) {
    throw new Error('No available AI profile found in configuration')
  }

  const effectiveModel =
    toNonEmptyString(requestModelOverride) ||
    toNonEmptyString(conversationAi?.modelOverride) ||
    toNonEmptyString(profile.defaultModel) ||
    DEFAULT_LEGACY_MODEL

  const isMiniMax = profile.vendor === 'minimax'
  const isGlmAnthropicCompat = profile.vendor === 'zhipu' && profile.protocol === 'anthropic_compat'

  return {
    profile,
    profileId: profile.id,
    effectiveModel,
    providerSignature: buildProviderSignature(profile),
    isMiniMax,
    isGlmAnthropicCompat,
    // Anthropic-compatible vendors should keep full feature path by default.
    // Compatibility-specific behavior is handled in provider/env mapping, not by disabling tools/features.
    disableToolsForCompat: false,
    disableThinkingForCompat: false,
    disableAiBrowserForCompat: false,
    disableImageForCompat: false,
    compatProviderName: null
  }
}
