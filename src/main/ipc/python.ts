/**
 * Python IPC Handlers
 *
 * Provides IPC communication between renderer and main process for Python operations.
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  detectPython,
  executePythonCode,
  installPackage,
  uninstallPackage,
  listPackages,
  createSpaceVenv,
  deleteSpaceVenv,
  hasSpaceVenv,
  getSpaceEnvironment,
  PipInstallProgress,
  VenvCreateProgress
} from '../services/python.service'
import { cleanupAllProcesses } from '../services/python.async-utils'

/**
 * Standard IPC response type
 */
type IpcResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Check if a value is already an IPC response (has success field)
 */
function isIpcResponse(value: unknown): value is IpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as Record<string, unknown>).success === 'boolean'
  )
}

/**
 * Creates a wrapped IPC handler that automatically handles try-catch and response formatting.
 *
 * - If the handler returns a value with a `success` field, it's returned as-is
 * - Otherwise, the result is wrapped as `{ success: true, data: result }`
 * - Errors are caught and returned as `{ success: false, error: message }`
 */
function createHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | Promise<TResult>
): (...args: TArgs) => Promise<IpcResponse<TResult>> {
  return async (...args: TArgs): Promise<IpcResponse<TResult>> => {
    try {
      const result = await handler(...args)
      if (isIpcResponse(result)) {
        return result as IpcResponse<TResult>
      }
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }
}

let mainWindow: BrowserWindow | null = null

export function registerPythonHandlers(window: BrowserWindow | null): void {
  mainWindow = window

  // Detect Python environment
  ipcMain.handle('python:detect', createHandler(() => detectPython()))

  // Execute Python code (has streaming callbacks, kept separate for clarity)
  ipcMain.handle(
    'python:execute',
    createHandler(
      (
        _event: Electron.IpcMainInvokeEvent,
        request: {
          code: string
          spaceId?: string
          cwd?: string
          timeout?: number
        }
      ) =>
        executePythonCode(request.code, {
          spaceId: request.spaceId,
          cwd: request.cwd,
          timeout: request.timeout,
          onStdout: (data) => {
            mainWindow?.webContents.send('python:stdout', {
              spaceId: request.spaceId,
              data
            })
          },
          onStderr: (data) => {
            mainWindow?.webContents.send('python:stderr', {
              spaceId: request.spaceId,
              data
            })
          }
        })
    )
  )

  // Install pip package (has progress callback)
  ipcMain.handle(
    'python:install-package',
    createHandler(
      (
        _event: Electron.IpcMainInvokeEvent,
        request: {
          packageName: string
          spaceId?: string
          version?: string
          progressChannel?: string
        }
      ) =>
        installPackage(request.packageName, {
          spaceId: request.spaceId,
          version: request.version,
          onProgress: (progress: PipInstallProgress) => {
            if (request.progressChannel) {
              mainWindow?.webContents.send(request.progressChannel, progress)
            }
          }
        })
    )
  )

  // Uninstall pip package
  ipcMain.handle(
    'python:uninstall-package',
    createHandler(
      (
        _event: Electron.IpcMainInvokeEvent,
        request: {
          packageName: string
          spaceId?: string
        }
      ) =>
        uninstallPackage(request.packageName, {
          spaceId: request.spaceId
        })
    )
  )

  // List installed packages
  ipcMain.handle(
    'python:list-packages',
    createHandler((_event: Electron.IpcMainInvokeEvent, spaceId?: string) => listPackages(spaceId))
  )

  // Create space virtual environment (has progress callback)
  ipcMain.handle(
    'python:create-venv',
    createHandler(
      (
        _event: Electron.IpcMainInvokeEvent,
        request: {
          spaceId: string
          progressChannel?: string
        }
      ) =>
        createSpaceVenv(request.spaceId, (progress: VenvCreateProgress) => {
          if (request.progressChannel) {
            mainWindow?.webContents.send(request.progressChannel, progress)
          }
        })
    )
  )

  // Delete space virtual environment
  ipcMain.handle(
    'python:delete-venv',
    createHandler((_event: Electron.IpcMainInvokeEvent, spaceId: string) => deleteSpaceVenv(spaceId))
  )

  // Check if space has venv
  ipcMain.handle(
    'python:has-venv',
    createHandler((_event: Electron.IpcMainInvokeEvent, spaceId: string) => hasSpaceVenv(spaceId))
  )

  // Get space environment info
  ipcMain.handle(
    'python:get-environment',
    createHandler(async (_event: Electron.IpcMainInvokeEvent, spaceId?: string) =>
      spaceId ? getSpaceEnvironment(spaceId) : (await detectPython()).environment
    )
  )

  console.log('[Python] IPC handlers registered')
}

/**
 * Cleanup Python handlers (called on app shutdown)
 */
export function cleanupPythonHandlers(): void {
  mainWindow = null

  // 清理所有活跃的 Python 进程
  cleanupAllProcesses()

  // 移除所有 IPC handlers
  ipcMain.removeHandler('python:detect')
  ipcMain.removeHandler('python:execute')
  ipcMain.removeHandler('python:install-package')
  ipcMain.removeHandler('python:uninstall-package')
  ipcMain.removeHandler('python:list-packages')
  ipcMain.removeHandler('python:create-venv')
  ipcMain.removeHandler('python:delete-venv')
  ipcMain.removeHandler('python:has-venv')
  ipcMain.removeHandler('python:get-environment')

  console.log('[Python] IPC handlers and processes cleaned up')
}
