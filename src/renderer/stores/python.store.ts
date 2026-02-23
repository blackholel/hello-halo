import { create } from 'zustand'

export interface PythonEnvironment {
  version: string
  type: 'embedded' | 'virtual'
  pythonPath: string
}

export interface PackageInfo {
  name: string
  version: string
}

export interface PythonInstallProgress {
  phase: 'downloading' | 'installing' | 'done' | 'error'
  package: string
  progress: number
  message: string
  error?: string
}

interface PythonState {
  isAvailable: boolean
  isDetecting: boolean
  globalEnvironment: PythonEnvironment | null
  globalPackages: PackageInfo[]
  isLoadingGlobalPackages: boolean
  detectionError: string | null
  isInstallingPackage: boolean
  installProgress: PythonInstallProgress | null
  detectPython: () => Promise<void>
  loadGlobalPackages: () => Promise<void>
  installPackage: (packageName: string) => Promise<boolean>
  uninstallPackage: (packageName: string) => Promise<boolean>
}

const PYTHON_REMOVED_MESSAGE = 'Python runtime support has been removed from this build'

export const usePythonStore = create<PythonState>((set) => ({
  isAvailable: false,
  isDetecting: false,
  globalEnvironment: null,
  globalPackages: [],
  isLoadingGlobalPackages: false,
  detectionError: PYTHON_REMOVED_MESSAGE,
  isInstallingPackage: false,
  installProgress: null,

  detectPython: async () => {
    set({
      isAvailable: false,
      isDetecting: false,
      globalEnvironment: null,
      detectionError: PYTHON_REMOVED_MESSAGE
    })
  },

  loadGlobalPackages: async () => {
    set({
      globalPackages: [],
      isLoadingGlobalPackages: false
    })
  },

  installPackage: async (packageName: string) => {
    set({
      isInstallingPackage: true,
      installProgress: {
        phase: 'error',
        package: packageName,
        progress: 0,
        message: PYTHON_REMOVED_MESSAGE,
        error: PYTHON_REMOVED_MESSAGE
      }
    })
    set({ isInstallingPackage: false })
    return false
  },

  uninstallPackage: async () => false
}))
