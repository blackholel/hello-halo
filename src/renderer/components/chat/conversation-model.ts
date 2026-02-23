import type { AiConfig, ProviderProtocol, ProviderVendor } from '../../../shared/types/ai-profile'
import type { ConversationMeta } from '../../types'

export interface ConversationModelInfo {
  effectiveModel: string
  profileName: string
  vendor?: ProviderVendor
  protocol?: ProviderProtocol
}

export function resolveConversationModelInfo(
  conversation: ConversationMeta,
  aiConfig: AiConfig | null | undefined,
  defaultProfileLabel: string
): ConversationModelInfo {
  const profiles = aiConfig?.profiles || []
  const defaultProfileId = aiConfig?.defaultProfileId || profiles[0]?.id
  const profileId = conversation.ai?.profileId || defaultProfileId
  const profile = profiles.find(item => item.id === profileId) || profiles[0]
  const modelOverride = conversation.ai?.modelOverride?.trim() || ''

  return {
    effectiveModel: modelOverride || profile?.defaultModel || '',
    profileName: profile?.name || defaultProfileLabel,
    vendor: profile?.vendor,
    protocol: profile?.protocol
  }
}
