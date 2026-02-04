/**
 * Change Set IPC Handlers
 */

import { ipcMain } from 'electron'
import {
  acceptChangeSet,
  listChangeSets,
  rollbackChangeSet
} from '../services/change-set.service'

export function registerChangeSetHandlers(): void {
  ipcMain.handle('change-set:list', async (_event, spaceId: string, conversationId: string) => {
    try {
      const data = listChangeSets(spaceId, conversationId)
      console.log('[ChangeSet][IPC] list', { spaceId, conversationId, count: data.length })
      return { success: true, data }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'change-set:accept',
    async (
      _event,
      params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string }
    ) => {
      try {
        const data = acceptChangeSet(
          params.spaceId,
          params.conversationId,
          params.changeSetId,
          params.filePath
        )
        return { success: true, data }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'change-set:rollback',
    async (
      _event,
      params: {
        spaceId: string
        conversationId: string
        changeSetId: string
        filePath?: string
        force?: boolean
      }
    ) => {
      try {
        const result = rollbackChangeSet(params.spaceId, params.conversationId, params.changeSetId, {
          filePath: params.filePath,
          force: params.force
        })
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )
}
