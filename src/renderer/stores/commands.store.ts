/**
 * Commands Store - Commands state management
 *
 * Manages commands loaded from app-level (~/.kite/commands/),
 * space-level ({workDir}/.claude/commands/), and plugin sources.
 */

import { create } from 'zustand'
import { api } from '../api'
import i18n from '../i18n'
import { useSpaceStore } from './space.store'
import { useToolkitStore } from './toolkit.store'
import { buildDirective } from '../utils/directive-helpers'
import type { SceneTag } from '../../shared/extension-taxonomy'

export interface CommandDefinition {
  name: string
  path: string
  source: 'app' | 'space' | 'plugin'
  description?: string
  sceneTags?: SceneTag[]
  pluginRoot?: string
  namespace?: string
}

interface CommandsState {
  commands: CommandDefinition[]
  loadedWorkDir: string | null
  isLoading: boolean
  isLoadingContent: boolean
  error: string | null
  loadCommands: (workDir?: string, force?: boolean) => Promise<void>
  getCommandContent: (name: string, workDir?: string) => Promise<string | null>
  createCommand: (workDir: string, name: string, content: string) => Promise<CommandDefinition | null>
  updateCommand: (commandPath: string, content: string) => Promise<boolean>
  deleteCommand: (commandPath: string) => Promise<boolean>
  copyToSpace: (
    command: CommandDefinition,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<{ status: 'copied' | 'conflict' | 'not_found'; data?: CommandDefinition }>
  clearCache: () => Promise<void>
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  commands: [],
  loadedWorkDir: null,
  isLoading: false,
  isLoadingContent: false,
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
  },

  getCommandContent: async (name, workDir) => {
    try {
      set({ isLoadingContent: true, error: null })
      const response = await api.getCommandContent(name, workDir)
      if (response.success && response.data) {
        return response.data as string
      }
      set({ error: response.error || 'Failed to load command content' })
      return null
    } catch (error) {
      console.error('[CommandsStore] Failed to load command content:', error)
      set({ error: 'Failed to load command content' })
      return null
    } finally {
      set({ isLoadingContent: false })
    }
  },

  createCommand: async (workDir, name, content) => {
    try {
      const response = await api.createCommand(workDir, name, content)
      if (response.success && response.data) {
        const newCommand = response.data as CommandDefinition
        const targetWorkDir = workDir ?? null
        set((state) => {
          const nextCommands = state.loadedWorkDir === targetWorkDir
            ? [...state.commands, newCommand]
            : state.commands

          return { commands: nextCommands }
        })

        const currentSpace = useSpaceStore.getState().currentSpace
        if (currentSpace) {
          const toolkitStore = useToolkitStore.getState()
          if (toolkitStore.getToolkit(currentSpace.id)) {
            void toolkitStore.addResource(currentSpace.id, buildDirective('command', newCommand))
          }
        }

        return newCommand
      }
      set({ error: response.error || 'Failed to create command' })
      return null
    } catch (error) {
      console.error('[CommandsStore] Failed to create command:', error)
      set({ error: 'Failed to create command' })
      return null
    }
  },

  updateCommand: async (commandPath, content) => {
    try {
      const response = await api.updateCommand(commandPath, content)
      if (response.success) {
        return true
      }
      set({ error: response.error || 'Failed to update command' })
      return false
    } catch (error) {
      console.error('[CommandsStore] Failed to update command:', error)
      set({ error: 'Failed to update command' })
      return false
    }
  },

  deleteCommand: async (commandPath) => {
    try {
      const response = await api.deleteCommand(commandPath)
      if (response.success) {
        set((state) => ({
          commands: state.commands.filter(command => command.path !== commandPath)
        }))
        return true
      }
      set({ error: response.error || 'Failed to delete command' })
      return false
    } catch (error) {
      console.error('[CommandsStore] Failed to delete command:', error)
      set({ error: 'Failed to delete command' })
      return false
    }
  },

  copyToSpace: async (command, workDir, options) => {
    try {
      const response = await api.copyCommandToSpaceByRef({
        type: 'command',
        name: command.name,
        namespace: command.namespace,
        source: command.source,
        path: command.path
      }, workDir, options)
      if (response.success && response.data) {
        const copyResult = response.data as { status: 'copied' | 'conflict' | 'not_found'; data?: CommandDefinition }
        if (copyResult.status !== 'copied' || !copyResult.data) {
          return copyResult
        }
        const copiedCommand = copyResult.data
        const targetWorkDir = workDir ?? null
        set((state) => ({
          commands: state.loadedWorkDir === targetWorkDir
            ? state.commands.map(item => item.path === command.path ? copiedCommand : item)
            : state.commands
        }))
        return { status: 'copied', data: copiedCommand }
      }
      set({ error: response.error || 'Failed to copy command to space' })
      return { status: 'not_found' }
    } catch (error) {
      console.error('[CommandsStore] Failed to copy command to space:', error)
      set({ error: 'Failed to copy command to space' })
      return { status: 'not_found' }
    }
  },

  clearCache: async () => {
    try {
      await api.clearCommandsCache()
      set({ loadedWorkDir: null, commands: [] })
    } catch (error) {
      console.error('[CommandsStore] Failed to clear commands cache:', error)
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

  i18n.on('languageChanged', () => {
    const { loadedWorkDir, loadCommands } = useCommandsStore.getState()
    void loadCommands(loadedWorkDir ?? undefined, true)
  })
}
