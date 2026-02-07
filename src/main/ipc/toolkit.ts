/**
 * Toolkit IPC Handlers
 *
 * Handles IPC communication for space toolkit management.
 */

import { ipcMain } from 'electron'
import { getSpace } from '../services/space.service'
import {
  getSpaceToolkit,
  addToolkitResource,
  removeToolkitResource,
  clearSpaceToolkit,
  migrateToToolkit
} from '../services/toolkit.service'
import type { DirectiveRef } from '../services/agent/types'

function requireWorkDir(spaceId: string): string {
  const space = getSpace(spaceId)
  if (!space?.path) throw new Error(`Space not found: ${spaceId}`)
  return space.path
}

function wrapHandler<T>(fn: () => T): { success: boolean; data?: T; error?: string } {
  try {
    return { success: true, data: fn() }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function registerToolkitHandlers(): void {
  ipcMain.handle('toolkit:get', async (_event, spaceId: string) => {
    return wrapHandler(() => getSpaceToolkit(requireWorkDir(spaceId)))
  })

  ipcMain.handle('toolkit:add', async (_event, spaceId: string, directive: DirectiveRef) => {
    return wrapHandler(() => addToolkitResource(requireWorkDir(spaceId), directive))
  })

  ipcMain.handle('toolkit:remove', async (_event, spaceId: string, directive: DirectiveRef) => {
    return wrapHandler(() => removeToolkitResource(requireWorkDir(spaceId), directive))
  })

  ipcMain.handle('toolkit:clear', async (_event, spaceId: string) => {
    return wrapHandler(() => {
      clearSpaceToolkit(requireWorkDir(spaceId))
      return null
    })
  })

  ipcMain.handle('toolkit:migrate', async (
    _event,
    spaceId: string,
    enabledSkills: string[],
    enabledAgents: string[]
  ) => {
    return wrapHandler(() => migrateToToolkit(requireWorkDir(spaceId), enabledSkills, enabledAgents))
  })
}
