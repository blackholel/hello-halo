/**
 * Commands IPC Handlers
 */

import { ipcMain } from 'electron'
import { getCommandContent, listCommands } from '../services/commands.service'

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
}
