import type { Space } from '../types'

interface SharedNavigationParams {
  targetSpaceId: string
  currentSpaceId: string | null
  spaces: Space[]
  kiteSpace: Space | null
  setSpaceStoreCurrentSpace: (space: Space | null) => void
  setChatCurrentSpace: (spaceId: string) => void
  loadConversations: (spaceId: string) => Promise<void>
  shouldContinue?: () => boolean
}

interface ConversationNavigationParams extends SharedNavigationParams {
  targetConversationId: string
  selectConversation: (conversationId: string) => Promise<void>
}

interface NavigationResult {
  success: boolean
  error?: string
}

function resolveTargetSpace(
  targetSpaceId: string,
  spaces: Space[],
  kiteSpace: Space | null
): Space | null {
  if (kiteSpace?.id === targetSpaceId) return kiteSpace
  return spaces.find(space => space.id === targetSpaceId) || null
}

function canContinue(shouldContinue?: () => boolean): boolean {
  return shouldContinue ? shouldContinue() : true
}

export async function navigateToSpaceContext(params: SharedNavigationParams): Promise<NavigationResult> {
  const {
    targetSpaceId,
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations,
    shouldContinue
  } = params

  if (!canContinue(shouldContinue)) {
    return { success: false, error: 'cancelled' }
  }

  if (targetSpaceId !== currentSpaceId) {
    const targetSpace = resolveTargetSpace(targetSpaceId, spaces, kiteSpace)
    if (!targetSpace) {
      return { success: false, error: `Space not found: ${targetSpaceId}` }
    }

    setSpaceStoreCurrentSpace(targetSpace)
    setChatCurrentSpace(targetSpaceId)
  }

  if (!canContinue(shouldContinue)) {
    return { success: false, error: 'cancelled' }
  }

  await loadConversations(targetSpaceId)

  if (!canContinue(shouldContinue)) {
    return { success: false, error: 'cancelled' }
  }

  return { success: true }
}

export async function navigateToConversationContext(
  params: ConversationNavigationParams
): Promise<NavigationResult> {
  const {
    targetConversationId,
    selectConversation
  } = params

  const spaceResult = await navigateToSpaceContext(params)
  if (!spaceResult.success) {
    return spaceResult
  }

  await selectConversation(targetConversationId)

  return canContinue(params.shouldContinue)
    ? { success: true }
    : { success: false, error: 'cancelled' }
}
