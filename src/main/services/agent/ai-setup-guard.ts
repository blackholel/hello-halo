import { getAiSetupState, type AiSetupConfigInput } from '../../../shared/types/ai-profile'

export function createAiProfileNotConfiguredError(
  message = 'Please configure AI profile first'
): Error & { errorCode: string } {
  const error = new Error(message) as Error & { errorCode: string }
  error.errorCode = 'AI_PROFILE_NOT_CONFIGURED'
  return error
}

export function assertAiProfileConfigured(config: AiSetupConfigInput | null | undefined): void {
  const aiSetupState = getAiSetupState(config)
  if (!aiSetupState.configured) {
    throw createAiProfileNotConfiguredError()
  }
}
