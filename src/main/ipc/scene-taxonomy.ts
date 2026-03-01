import { BrowserWindow, ipcMain } from 'electron'
import {
  clearSkillsCache
} from '../services/skills.service'
import {
  clearAgentsCache
} from '../services/agents.service'
import {
  clearCommandsCache
} from '../services/commands.service'
import {
  exportSceneTaxonomy,
  getSceneTaxonomy,
  importSceneTaxonomy,
  onSceneTaxonomyMutated,
  removeResourceSceneOverride,
  removeSceneDefinition,
  setResourceSceneOverride,
  upsertSceneDefinition
} from '../services/scene-taxonomy.service'
import type { SceneDefinition, SceneTagKey, SceneTaxonomyConfig } from '../../shared/scene-taxonomy'
import type { ResourceChangedPayload } from '../../shared/resource-access'

let unsubscribeMutationListener: (() => void) | null = null

function createSuccess<T>(data: T) {
  return { success: true, data }
}

function createError(error: unknown) {
  return { success: false, error: (error as Error).message }
}

function bindMutationSideEffects(mainWindow: BrowserWindow | null): void {
  if (unsubscribeMutationListener) return
  unsubscribeMutationListener = onSceneTaxonomyMutated(() => {
    clearSkillsCache()
    clearAgentsCache()
    clearCommandsCache()

    if (mainWindow && !mainWindow.isDestroyed()) {
      const payload: ResourceChangedPayload = {
        workDir: null,
        reason: 'manual-refresh',
        ts: new Date().toISOString(),
        resources: ['skills', 'agents', 'commands']
      }
      mainWindow.webContents.send('skills:changed', payload)
      mainWindow.webContents.send('agents:changed', payload)
      mainWindow.webContents.send('commands:changed', payload)
    }
  })
}

export function registerSceneTaxonomyHandlers(mainWindow: BrowserWindow | null): void {
  bindMutationSideEffects(mainWindow)

  ipcMain.handle('scene-taxonomy:get', async () => {
    try {
      return createSuccess(getSceneTaxonomy())
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle('scene-taxonomy:upsert-definition', async (_event, definition: SceneDefinition) => {
    try {
      return createSuccess(upsertSceneDefinition(definition))
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle('scene-taxonomy:remove-definition', async (_event, key: string) => {
    try {
      return createSuccess(removeSceneDefinition(key))
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle('scene-taxonomy:set-override', async (_event, resourceKey: string, tags: SceneTagKey[]) => {
    try {
      return createSuccess(setResourceSceneOverride(resourceKey, tags))
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle('scene-taxonomy:remove-override', async (_event, resourceKey: string) => {
    try {
      return createSuccess(removeResourceSceneOverride(resourceKey))
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle('scene-taxonomy:export', async () => {
    try {
      return createSuccess(exportSceneTaxonomy())
    } catch (error: unknown) {
      return createError(error)
    }
  })

  ipcMain.handle(
    'scene-taxonomy:import',
    async (_event, payload: SceneTaxonomyConfig, mode: 'merge' | 'replace') => {
      try {
        return createSuccess(importSceneTaxonomy(payload, mode))
      } catch (error: unknown) {
        return createError(error)
      }
    }
  )
}
