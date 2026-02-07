/**
 * Preset IPC Handlers
 *
 * Handles IPC communication for toolkit preset management.
 */

import { ipcMain } from 'electron'
import { listPresets, getPreset, savePreset } from '../services/preset.service'
import type { SpaceToolkit } from '../services/space-config.service'

export function registerPresetHandlers(): void {
  ipcMain.handle('preset:list', async () => {
    try {
      return { success: true, data: listPresets() }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('preset:get', async (_event, presetId: string) => {
    try {
      const preset = getPreset(presetId)
      if (!preset) return { success: false, error: `Preset not found: ${presetId}` }
      return { success: true, data: preset }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('preset:save', async (
    _event,
    name: string,
    description: string,
    toolkit: SpaceToolkit
  ) => {
    try {
      return { success: true, data: savePreset(name, description, toolkit) }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })
}
