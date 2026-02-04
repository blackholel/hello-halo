/**
 * Change Set Controller
 */

import { acceptChangeSet, listChangeSets, rollbackChangeSet } from '../services/change-set.service'

export function listChangeSetsForConversation(spaceId: string, conversationId: string) {
  try {
    const data = listChangeSets(spaceId, conversationId)
    return { success: true, data }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

export function acceptChangeSetForConversation(params: {
  spaceId: string
  conversationId: string
  changeSetId: string
  filePath?: string
}) {
  try {
    const data = acceptChangeSet(params.spaceId, params.conversationId, params.changeSetId, params.filePath)
    return { success: true, data }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}

export function rollbackChangeSetForConversation(params: {
  spaceId: string
  conversationId: string
  changeSetId: string
  filePath?: string
  force?: boolean
}) {
  try {
    const data = rollbackChangeSet(params.spaceId, params.conversationId, params.changeSetId, {
      filePath: params.filePath,
      force: params.force
    })
    return { success: true, data }
  } catch (error: unknown) {
    const err = error as Error
    return { success: false, error: err.message }
  }
}
