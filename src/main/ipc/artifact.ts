/**
 * Artifact IPC Handlers - Handle artifact-related requests from renderer
 */

import { ipcMain, shell } from 'electron'
import {
  listArtifacts,
  listArtifactsTree,
  readArtifactContent,
  writeArtifactContent,
  createFolder,
  createFile,
  renameArtifact,
  deleteArtifact,
  moveArtifact,
  copyArtifact
} from '../services/artifact.service'

// Register all artifact handlers
export function registerArtifactHandlers(): void {
  // List artifacts in a space (flat list for card view)
  ipcMain.handle('artifact:list', async (_event, spaceId: string) => {
    try {
      console.log(`[IPC] artifact:list - spaceId: ${spaceId}`)
      const artifacts = listArtifacts(spaceId)
      return { success: true, data: artifacts }
    } catch (error) {
      console.error('[IPC] artifact:list error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // List artifacts as tree structure (for developer view)
  ipcMain.handle('artifact:list-tree', async (_event, spaceId: string) => {
    try {
      console.log(`[IPC] artifact:list-tree - spaceId: ${spaceId}`)
      const tree = listArtifactsTree(spaceId)
      return { success: true, data: tree }
    } catch (error) {
      console.error('[IPC] artifact:list-tree error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Open file or folder with system default application
  ipcMain.handle('artifact:open', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:open - path: ${filePath}`)
      // shell.openPath opens file with default app, or folder with file manager
      const error = await shell.openPath(filePath)
      if (error) {
        console.error('[IPC] artifact:open error:', error)
        return { success: false, error }
      }
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:open error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Show file in folder (highlight in file manager)
  ipcMain.handle('artifact:show-in-folder', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:show-in-folder - path: ${filePath}`)
      // shell.showItemInFolder opens the folder and selects the file
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:show-in-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Read file content for Content Canvas
  ipcMain.handle('artifact:read-content', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:read-content - path: ${filePath}`)
      const content = readArtifactContent(filePath)
      return { success: true, data: content }
    } catch (error) {
      console.error('[IPC] artifact:read-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Write file content for Content Canvas editing
  ipcMain.handle('artifact:write-content', async (_event, filePath: string, content: string) => {
    try {
      console.log(`[IPC] artifact:write-content - path: ${filePath}`)
      const result = await writeArtifactContent(filePath, content)
      return result
    } catch (error) {
      console.error('[IPC] artifact:write-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Create a new folder
  ipcMain.handle('artifact:create-folder', async (_event, folderPath: string) => {
    try {
      console.log(`[IPC] artifact:create-folder - path: ${folderPath}`)
      const result = await createFolder(folderPath)
      return result
    } catch (error) {
      console.error('[IPC] artifact:create-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Create a new file
  ipcMain.handle('artifact:create-file', async (_event, filePath: string, content?: string) => {
    try {
      console.log(`[IPC] artifact:create-file - path: ${filePath}`)
      const result = await createFile(filePath, content)
      return result
    } catch (error) {
      console.error('[IPC] artifact:create-file error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Rename a file or folder
  ipcMain.handle('artifact:rename', async (_event, oldPath: string, newName: string) => {
    try {
      console.log(`[IPC] artifact:rename - oldPath: ${oldPath}, newName: ${newName}`)
      const result = await renameArtifact(oldPath, newName)
      return result
    } catch (error) {
      console.error('[IPC] artifact:rename error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Delete a file or folder
  ipcMain.handle('artifact:delete', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:delete - path: ${filePath}`)
      const result = await deleteArtifact(filePath)
      return result
    } catch (error) {
      console.error('[IPC] artifact:delete error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Move a file or folder
  ipcMain.handle('artifact:move', async (_event, sourcePath: string, targetDir: string) => {
    try {
      console.log(`[IPC] artifact:move - source: ${sourcePath}, target: ${targetDir}`)
      const result = await moveArtifact(sourcePath, targetDir)
      return result
    } catch (error) {
      console.error('[IPC] artifact:move error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Copy a file or folder
  ipcMain.handle('artifact:copy', async (_event, sourcePath: string, targetDir: string) => {
    try {
      console.log(`[IPC] artifact:copy - source: ${sourcePath}, target: ${targetDir}`)
      const result = await copyArtifact(sourcePath, targetDir)
      return result
    } catch (error) {
      console.error('[IPC] artifact:copy error:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}

// Unregister all artifact handlers
export function unregisterArtifactHandlers(): void {
  ipcMain.removeHandler('artifact:list')
  ipcMain.removeHandler('artifact:list-tree')
  ipcMain.removeHandler('artifact:open')
  ipcMain.removeHandler('artifact:show-in-folder')
  ipcMain.removeHandler('artifact:read-content')
  ipcMain.removeHandler('artifact:write-content')
  ipcMain.removeHandler('artifact:create-folder')
  ipcMain.removeHandler('artifact:create-file')
  ipcMain.removeHandler('artifact:rename')
  ipcMain.removeHandler('artifact:delete')
  ipcMain.removeHandler('artifact:move')
  ipcMain.removeHandler('artifact:copy')

  console.log('[Artifact] IPC handlers cleaned up')
}
