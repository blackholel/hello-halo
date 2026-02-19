/**
 * Commands IPC Handlers
 */

import { ipcMain } from 'electron'
import {
  getCommandContent,
  listCommands,
  createCommand,
  updateCommand,
  deleteCommand,
  copyCommandToSpace,
  copyCommandToSpaceByRef,
  clearCommandsCache
} from '../services/commands.service'
import type { ResourceRef } from '../services/resource-ref.service'

export function registerCommandsHandlers(): void {
  ipcMain.handle('commands:list', async (_event, workDir?: string) => {
    try {
      return { success: true, data: listCommands(workDir) }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('commands:get-content', async (_event, name: string, workDir?: string) => {
    try {
      const content = getCommandContent(name, workDir)
      if (!content) {
        return { success: false, error: `Command not found: ${name}` }
      }
      return { success: true, data: content }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('commands:create', async (_event, workDir: string, name: string, content: string) => {
    try {
      return { success: true, data: createCommand(workDir, name, content) }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('commands:update', async (_event, commandPath: string, content: string) => {
    try {
      const ok = updateCommand(commandPath, content)
      if (!ok) {
        return { success: false, error: 'Failed to update command' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('commands:delete', async (_event, commandPath: string) => {
    try {
      const ok = deleteCommand(commandPath)
      if (!ok) {
        return { success: false, error: 'Failed to delete command' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('commands:copy-to-space', async (_event, commandName: string, workDir: string) => {
    try {
      const command = copyCommandToSpace(commandName, workDir)
      if (!command) {
        return { success: false, error: `Failed to copy command: ${commandName}` }
      }
      return { success: true, data: command }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'commands:copy-to-space-by-ref',
    async (_event, ref: ResourceRef, workDir: string, options?: { overwrite?: boolean }) => {
      try {
        return { success: true, data: copyCommandToSpaceByRef(ref, workDir, options) }
      } catch (error: unknown) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('commands:clear-cache', async () => {
    try {
      clearCommandsCache()
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })
}
