/**
 * Memory IPC Handlers - 管理记忆文件的 IPC 接口
 */

import { ipcMain } from 'electron'
import { resolve, normalize } from 'path'
import { homedir } from 'os'
import {
  getUserClaudeMdPath,
  getProjectClaudeMdPath,
  getProjectClaudeDirMdPath,
  getHaloGlobalMemoryPath,
  getSpaceMemoryPath,
  readMemoryFile,
  writeMemoryFile,
  listMemoryFiles
} from '../services/memory.service'
import { getAllSpacePaths } from '../services/space.service'

// ============================================
// 安全验证
// ============================================

const MAX_CONTENT_SIZE = 10 * 1024 // 10KB

/**
 * 验证 workDir 是否是有效的工作目录
 * 防止路径遍历攻击
 */
function validateWorkDir(workDir: unknown): string {
  // 类型检查
  if (typeof workDir !== 'string' || workDir.trim() === '') {
    throw new Error('workDir must be a non-empty string')
  }

  // 禁止路径遍历
  if (workDir.includes('..')) {
    throw new Error('Invalid workDir: path traversal detected')
  }

  // 规范化路径
  const normalizedPath = normalize(resolve(workDir))

  // 检查是否是已注册的 space 路径
  const spacePaths = getAllSpacePaths()
  const isRegisteredSpace = spacePaths.some(spacePath => {
    const normalizedSpacePath = normalize(resolve(spacePath))
    return normalizedPath === normalizedSpacePath ||
           normalizedPath.startsWith(normalizedSpacePath + '/')
  })

  // 也允许用户主目录下的路径（用于临时空间等）
  const homeDir = normalize(resolve(homedir()))
  const isUnderHome = normalizedPath.startsWith(homeDir + '/')

  if (!isRegisteredSpace && !isUnderHome) {
    throw new Error('Invalid workDir: not a registered space or under home directory')
  }

  return normalizedPath
}

/**
 * 验证写入内容
 */
function validateContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new Error('content must be a string')
  }

  if (content.length > MAX_CONTENT_SIZE) {
    throw new Error(`content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes`)
  }

  return content
}

/**
 * 格式化错误响应
 */
function errorResponse(channel: string, error: unknown): { success: false; error: string } {
  console.error(`[IPC] ${channel} failed:`, error)
  return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
}

export function registerMemoryHandlers(): void {
  // 读取用户级 CLAUDE.md
  ipcMain.handle('memory:read-user-claude', async () => {
    try {
      const path = getUserClaudeMdPath()
      return { success: true, path, content: readMemoryFile(path) }
    } catch (error) {
      return errorResponse('memory:read-user-claude', error)
    }
  })

  // 读取项目级 CLAUDE.md
  ipcMain.handle('memory:read-project-claude', async (_event, workDir: unknown) => {
    try {
      const validatedWorkDir = validateWorkDir(workDir)
      const rootPath = getProjectClaudeMdPath(validatedWorkDir)
      const dotClaudePath = getProjectClaudeDirMdPath(validatedWorkDir)

      const rootContent = readMemoryFile(rootPath)
      if (rootContent !== null) {
        return { success: true, path: rootPath, content: rootContent }
      }
      return { success: true, path: dotClaudePath, content: readMemoryFile(dotClaudePath) }
    } catch (error) {
      return errorResponse('memory:read-project-claude', error)
    }
  })

  // 读取 Halo 全局记忆
  ipcMain.handle('memory:read-halo-global', async () => {
    try {
      const path = getHaloGlobalMemoryPath()
      return { success: true, path, content: readMemoryFile(path) }
    } catch (error) {
      return errorResponse('memory:read-halo-global', error)
    }
  })

  // 读取空间级记忆
  ipcMain.handle('memory:read-space', async (_event, workDir: unknown) => {
    try {
      const validatedWorkDir = validateWorkDir(workDir)
      const path = getSpaceMemoryPath(validatedWorkDir)
      return { success: true, path, content: readMemoryFile(path) }
    } catch (error) {
      return errorResponse('memory:read-space', error)
    }
  })

  // 写入用户级 CLAUDE.md
  ipcMain.handle('memory:write-user-claude', async (_event, content: unknown) => {
    try {
      const validatedContent = validateContent(content)
      const path = getUserClaudeMdPath()
      return { success: writeMemoryFile(path, validatedContent) }
    } catch (error) {
      return errorResponse('memory:write-user-claude', error)
    }
  })

  // 写入项目级 CLAUDE.md
  ipcMain.handle('memory:write-project-claude', async (_event, workDir: unknown, content: unknown) => {
    try {
      const validatedWorkDir = validateWorkDir(workDir)
      const validatedContent = validateContent(content)
      const path = getProjectClaudeMdPath(validatedWorkDir)
      return { success: writeMemoryFile(path, validatedContent) }
    } catch (error) {
      return errorResponse('memory:write-project-claude', error)
    }
  })

  // 写入 Halo 全局记忆
  ipcMain.handle('memory:write-halo-global', async (_event, content: unknown) => {
    try {
      const validatedContent = validateContent(content)
      const path = getHaloGlobalMemoryPath()
      return { success: writeMemoryFile(path, validatedContent) }
    } catch (error) {
      return errorResponse('memory:write-halo-global', error)
    }
  })

  // 写入空间级记忆
  ipcMain.handle('memory:write-space', async (_event, workDir: unknown, content: unknown) => {
    try {
      const validatedWorkDir = validateWorkDir(workDir)
      const validatedContent = validateContent(content)
      const path = getSpaceMemoryPath(validatedWorkDir)
      return { success: writeMemoryFile(path, validatedContent) }
    } catch (error) {
      return errorResponse('memory:write-space', error)
    }
  })

  // 列出所有记忆文件
  ipcMain.handle('memory:list', async (_event, workDir: unknown) => {
    try {
      const validatedWorkDir = validateWorkDir(workDir)
      return { success: true, files: listMemoryFiles(validatedWorkDir) }
    } catch (error) {
      return errorResponse('memory:list', error)
    }
  })

  console.log('[IPC] Memory handlers registered')
}
