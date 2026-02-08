/**
 * Commands Store - Commands state management
 *
 * Manages commands loaded from app-level (~/.halo/commands/),
 * space-level ({workDir}/.claude/commands/), and plugin sources.
 */

import { create } from 'zustand'
import { api } from '../api'

export interface CommandDefinition {
  name: string
  path: string
  source: 'app' | 'space' | 'plugin'
  description?: string
  pluginRoot?: string
  namespace?: string
}

interface CommandsState {
  commands: CommandDefinition[]
  loadedWorkDir: string | null
  isLoading: boolean
  error: string | null
  loadCommands: (workDir?: string, force?: boolean) => Promise<void>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  commands: [],
  loadedWorkDir: null,
  isLoading: false,
  error: null,

  loadCommands: async (workDir?: string, force?: boolean): Promise<void> => {
    const targetWorkDir = workDir ?? null
    const { loadedWorkDir, commands } = get()

    // Skip if already loaded for this workDir
    if (!force && loadedWorkDir === targetWorkDir && commands.length > 0) return

    set({ isLoading: true, error: null })

    try {
      const response = await api.listCommands(workDir)
      if (response.success) {
        set({
          commands: response.data as CommandDefinition[],
          loadedWorkDir: targetWorkDir,
          isLoading: false
        })
      } else {
        set({ error: response.error || 'Failed to load commands', isLoading: false })
      }
    } catch (error) {
      console.error('[CommandsStore] Failed to load commands:', error)
      set({ error: 'Failed to load commands', isLoading: false })
    }
  }
}))

/** Payload shape for the commands:changed IPC event */
interface CommandsChangedPayload {
  workDir?: string | null
}

function isCommandsChangedPayload(data: unknown): data is CommandsChangedPayload {
  if (data == null || typeof data !== 'object') return true // treat null/undefined as "reload all"
  const obj = data as Record<string, unknown>
  return !('workDir' in obj) || obj.workDir === null || typeof obj.workDir === 'string'
}

let commandsListenersInitialized = false

export function initCommandsStoreListeners(): void {
  if (commandsListenersInitialized) return
  commandsListenersInitialized = true

  api.onCommandsChanged((data) => {
    if (!isCommandsChangedPayload(data)) return

    const { loadedWorkDir, loadCommands } = useCommandsStore.getState()
    const changedWorkDir = (data as CommandsChangedPayload)?.workDir

    // Reload if: event targets all workDirs (null/undefined), or matches the currently loaded one
    if (changedWorkDir == null || changedWorkDir === loadedWorkDir) {
      loadCommands(loadedWorkDir ?? undefined, true)
    }
  })
}
