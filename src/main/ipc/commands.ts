/**
 * Commands IPC Handlers
 */

import { ipcMain } from 'electron'
import { listCommands } from '../services/commands.service'

export function registerCommandsHandlers(): void {
  ipcMain.handle('commands:list', async (_event, workDir?: string) => {
    try {
      return { success: true, data: listCommands(workDir) }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })
}
