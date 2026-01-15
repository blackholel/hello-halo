/**
 * Python Store - State management for Python environment
 */

import { create } from 'zustand'

// ============================================
// Types (imported from shared)
// ============================================

import type {
  PythonEnvironment,
  PackageInfo,
  ExecutionResult
} from '../../shared/types/python.types'

// Re-export types for consumers of this store
export type { PythonEnvironment, PackageInfo, ExecutionResult }

export interface SpacePythonState {
  hasVenv: boolean
  environment: PythonEnvironment | null
  packages: PackageInfo[]
  isLoadingPackages: boolean
}

// ============================================
// Constants
// ============================================

const DEFAULT_SPACE_STATE: SpacePythonState = {
  hasVenv: false,
  environment: null,
  packages: [],
  isLoadingPackages: false
}

// ============================================
// Helper Functions
// ============================================

type StoreGet = () => PythonState
type StoreSet = (partial: Partial<PythonState>) => void

/**
 * Helper function to update a space's state in the spaceStates Map
 */
function updateSpaceState(
  get: StoreGet,
  set: StoreSet,
  spaceId: string,
  updates: Partial<SpacePythonState>
): void {
  const { spaceStates } = get()
  const newStates = new Map(spaceStates)
  const currentState = newStates.get(spaceId) || DEFAULT_SPACE_STATE
  newStates.set(spaceId, { ...currentState, ...updates })
  set({ spaceStates: newStates })
}

interface PythonState {
  // Global state
  isAvailable: boolean
  isDetecting: boolean
  globalEnvironment: PythonEnvironment | null
  globalPackages: PackageInfo[]
  isLoadingGlobalPackages: boolean
  detectionError: string | null

  // Space states
  spaceStates: Map<string, SpacePythonState>

  // Execution state
  isExecuting: boolean
  executionOutput: string

  // Package installation state
  isInstallingPackage: boolean
  installProgress: {
    phase: 'downloading' | 'installing' | 'done' | 'error'
    package: string
    progress: number
    message: string
    error?: string
  } | null

  // Venv creation state
  isCreatingVenv: boolean
  venvProgress: {
    phase: 'creating' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  } | null

  // Actions
  detectPython: () => Promise<void>
  loadGlobalPackages: () => Promise<void>
  loadSpacePackages: (spaceId: string) => Promise<void>
  executeCode: (code: string, spaceId?: string) => Promise<ExecutionResult>
  installPackage: (packageName: string, spaceId?: string, version?: string) => Promise<boolean>
  uninstallPackage: (packageName: string, spaceId?: string) => Promise<boolean>
  createVenv: (spaceId: string) => Promise<boolean>
  deleteVenv: (spaceId: string) => Promise<boolean>
  checkSpaceVenv: (spaceId: string) => Promise<boolean>
  getSpaceEnvironment: (spaceId: string) => Promise<PythonEnvironment | null>
  clearExecutionOutput: () => void
}

// ============================================
// Store
// ============================================

export const usePythonStore = create<PythonState>((set, get) => ({
  // Initial state
  isAvailable: false,
  isDetecting: false,
  globalEnvironment: null,
  globalPackages: [],
  isLoadingGlobalPackages: false,
  detectionError: null,
  spaceStates: new Map(),
  isExecuting: false,
  executionOutput: '',
  isInstallingPackage: false,
  installProgress: null,
  isCreatingVenv: false,
  venvProgress: null,

  // Actions
  detectPython: async () => {
    set({ isDetecting: true, detectionError: null })
    try {
      const result = await window.halo.pythonDetect()
      if (result.success && result.data) {
        set({
          isAvailable: result.data.found,
          globalEnvironment: result.data.environment,
          detectionError: result.data.error || null,
          isDetecting: false
        })
      } else {
        set({
          isAvailable: false,
          globalEnvironment: null,
          detectionError: result.error || 'Detection failed',
          isDetecting: false
        })
      }
    } catch (error) {
      set({
        isAvailable: false,
        globalEnvironment: null,
        detectionError: (error as Error).message,
        isDetecting: false
      })
    }
  },

  loadGlobalPackages: async () => {
    set({ isLoadingGlobalPackages: true })
    try {
      const result = await window.halo.pythonListPackages()
      if (result.success && result.data?.packages) {
        set({
          globalPackages: result.data.packages,
          isLoadingGlobalPackages: false
        })
      } else {
        set({ isLoadingGlobalPackages: false })
      }
    } catch (error) {
      console.error('[PythonStore] Failed to load global packages:', error)
      set({ isLoadingGlobalPackages: false })
    }
  },

  loadSpacePackages: async (spaceId: string) => {
    // Update loading state
    updateSpaceState(get, set, spaceId, { isLoadingPackages: true })

    try {
      const result = await window.halo.pythonListPackages(spaceId)
      updateSpaceState(get, set, spaceId, {
        packages: result.success && result.data?.packages ? result.data.packages : [],
        isLoadingPackages: false
      })
    } catch (error) {
      console.error('[PythonStore] Failed to load space packages:', error)
      updateSpaceState(get, set, spaceId, { isLoadingPackages: false })
    }
  },

  executeCode: async (code: string, spaceId?: string): Promise<ExecutionResult> => {
    set({ isExecuting: true, executionOutput: '' })

    try {
      const result = await window.halo.pythonExecute({
        code,
        spaceId
      })

      if (result.success && result.data) {
        set({
          isExecuting: false,
          executionOutput: result.data.stdout + (result.data.stderr ? '\n' + result.data.stderr : '')
        })
        return result.data
      } else {
        const errorResult: ExecutionResult = {
          success: false,
          stdout: '',
          stderr: result.error || 'Execution failed',
          exitCode: null,
          duration: 0,
          error: result.error
        }
        set({ isExecuting: false, executionOutput: errorResult.stderr })
        return errorResult
      }
    } catch (error) {
      const errorResult: ExecutionResult = {
        success: false,
        stdout: '',
        stderr: (error as Error).message,
        exitCode: null,
        duration: 0,
        error: (error as Error).message
      }
      set({ isExecuting: false, executionOutput: errorResult.stderr })
      return errorResult
    }
  },

  installPackage: async (packageName: string, spaceId?: string, version?: string): Promise<boolean> => {
    set({ isInstallingPackage: true, installProgress: null })

    try {
      const result = await window.halo.pythonInstallPackage(
        packageName,
        { spaceId, version },
        (progress) => {
          set({ installProgress: progress })
        }
      )

      set({ isInstallingPackage: false })

      if (result.success) {
        // Reload packages after installation
        if (spaceId) {
          get().loadSpacePackages(spaceId)
        } else {
          get().loadGlobalPackages()
        }
        return true
      }
      return false
    } catch (error) {
      console.error('[PythonStore] Failed to install package:', error)
      set({
        isInstallingPackage: false,
        installProgress: {
          phase: 'error',
          package: packageName,
          progress: 0,
          message: 'Installation failed',
          error: (error as Error).message
        }
      })
      return false
    }
  },

  uninstallPackage: async (packageName: string, spaceId?: string): Promise<boolean> => {
    try {
      const result = await window.halo.pythonUninstallPackage(packageName, { spaceId })

      if (result.success) {
        // Reload packages after uninstallation
        if (spaceId) {
          get().loadSpacePackages(spaceId)
        } else {
          get().loadGlobalPackages()
        }
        return true
      }
      return false
    } catch (error) {
      console.error('[PythonStore] Failed to uninstall package:', error)
      return false
    }
  },

  createVenv: async (spaceId: string): Promise<boolean> => {
    set({ isCreatingVenv: true, venvProgress: null })

    try {
      const result = await window.halo.pythonCreateVenv(spaceId, (progress) => {
        set({ venvProgress: progress })
      })

      set({ isCreatingVenv: false })

      if (result.success) {
        // Update space state
        updateSpaceState(get, set, spaceId, { hasVenv: true })

        // Load the new environment info
        get().getSpaceEnvironment(spaceId)
        return true
      }
      return false
    } catch (error) {
      console.error('[PythonStore] Failed to create venv:', error)
      set({
        isCreatingVenv: false,
        venvProgress: {
          phase: 'error',
          progress: 0,
          message: 'Failed to create virtual environment',
          error: (error as Error).message
        }
      })
      return false
    }
  },

  deleteVenv: async (spaceId: string): Promise<boolean> => {
    try {
      const result = await window.halo.pythonDeleteVenv(spaceId)

      if (result.success) {
        // Update space state
        updateSpaceState(get, set, spaceId, {
          hasVenv: false,
          environment: null,
          packages: []
        })
        return true
      }
      return false
    } catch (error) {
      console.error('[PythonStore] Failed to delete venv:', error)
      return false
    }
  },

  checkSpaceVenv: async (spaceId: string): Promise<boolean> => {
    try {
      const result = await window.halo.pythonHasVenv(spaceId)
      const hasVenv = result.success && result.data === true

      // Update space state
      updateSpaceState(get, set, spaceId, { hasVenv })

      return hasVenv
    } catch (error) {
      console.error('[PythonStore] Failed to check space venv:', error)
      return false
    }
  },

  getSpaceEnvironment: async (spaceId: string): Promise<PythonEnvironment | null> => {
    try {
      const result = await window.halo.pythonGetEnvironment(spaceId)
      const environment = result.success ? result.data : null

      // Update space state
      updateSpaceState(get, set, spaceId, {
        environment,
        hasVenv: environment?.type === 'venv'
      })

      return environment
    } catch (error) {
      console.error('[PythonStore] Failed to get space environment:', error)
      return null
    }
  },

  clearExecutionOutput: () => {
    set({ executionOutput: '' })
  }
}))
