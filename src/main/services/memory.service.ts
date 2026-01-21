/**
 * Memory Service - 管理 CLAUDE.md 记忆文件和自定义记忆
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// ============================================
// 路径定义
// ============================================

// Claude Code 原生记忆路径
export function getUserClaudeMdPath(): string {
  return join(homedir(), '.claude', 'CLAUDE.md')
}

export function getProjectClaudeMdPath(workDir: string): string {
  return join(workDir, 'CLAUDE.md')
}

export function getProjectClaudeDirMdPath(workDir: string): string {
  return join(workDir, '.claude', 'CLAUDE.md')
}

// Halo 自定义记忆路径
export function getHaloGlobalMemoryPath(): string {
  return join(homedir(), '.halo', 'memory.md')
}

export function getSpaceMemoryPath(workDir: string): string {
  return join(workDir, '.halo', 'memory.md')
}

// ============================================
// 读取记忆
// ============================================

export function readMemoryFile(path: string): string | null {
  try {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8')
      // 限制记忆文件大小（10KB）
      if (content.length > 10240) {
        console.warn(`[Memory] File too large, truncating: ${path}`)
        return content.substring(0, 10240) + '\n... (truncated)'
      }
      return content
    }
  } catch (e) {
    console.warn(`[Memory] Failed to read: ${path}`, e)
  }
  return null
}

// ============================================
// 写入记忆
// ============================================

export function writeMemoryFile(path: string, content: string): boolean {
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, content, 'utf-8')
    console.log(`[Memory] Written: ${path}`)
    return true
  } catch (e) {
    console.error(`[Memory] Failed to write: ${path}`, e)
    return false
  }
}

// ============================================
// 格式化记忆内容
// ============================================

export interface MemoryOptions {
  enabled: boolean
  autoLoadClaudeMd: boolean
  globalMemory?: string
  spaceMemory?: string
}

/**
 * 获取格式化的完整记忆内容
 * 用于注入到系统提示词
 */
export function getFormattedMemory(workDir: string, options: MemoryOptions): string {
  if (!options.enabled) {
    return ''
  }

  const sections: string[] = []

  // 1. Claude Code 原生 CLAUDE.md (如果启用)
  if (options.autoLoadClaudeMd) {
    // 用户级 ~/.claude/CLAUDE.md
    const userClaudeMd = readMemoryFile(getUserClaudeMdPath())
    if (userClaudeMd) {
      sections.push(`## User Memory (from ~/.claude/CLAUDE.md)\n${userClaudeMd}`)
    }

    // 项目级 CLAUDE.md (根目录或 .claude/ 目录)
    const projectClaudeMd = readMemoryFile(getProjectClaudeMdPath(workDir))
      || readMemoryFile(getProjectClaudeDirMdPath(workDir))
    if (projectClaudeMd) {
      sections.push(`## Project Memory (from CLAUDE.md)\n${projectClaudeMd}`)
    }
  }

  // 2. Halo 全局记忆（配置中的）
  if (options.globalMemory) {
    sections.push(`## Global Instructions\n${options.globalMemory}`)
  }

  // 3. Halo 全局记忆文件
  const haloGlobalMemory = readMemoryFile(getHaloGlobalMemoryPath())
  if (haloGlobalMemory) {
    sections.push(`## Halo Global Memory\n${haloGlobalMemory}`)
  }

  // 4. 空间级记忆（配置中的）
  if (options.spaceMemory) {
    sections.push(`## Space Instructions\n${options.spaceMemory}`)
  }

  // 5. 空间级记忆文件
  const spaceMemory = readMemoryFile(getSpaceMemoryPath(workDir))
  if (spaceMemory) {
    sections.push(`## Space Memory\n${spaceMemory}`)
  }

  if (sections.length === 0) {
    return ''
  }

  return `\n<memory>\n${sections.join('\n\n')}\n</memory>\n`
}

// ============================================
// 记忆管理 API
// ============================================

export interface MemoryInfo {
  type: 'user-claude' | 'project-claude' | 'halo-global' | 'halo-space'
  path: string
  exists: boolean
  size?: number
}

export function listMemoryFiles(workDir: string): MemoryInfo[] {
  const userClaudePath = getUserClaudeMdPath()
  const projectClaudePath = getProjectClaudeMdPath(workDir)
  const haloGlobalPath = getHaloGlobalMemoryPath()
  const spacePath = getSpaceMemoryPath(workDir)

  const files: MemoryInfo[] = [
    { type: 'user-claude', path: userClaudePath, exists: existsSync(userClaudePath) },
    { type: 'project-claude', path: projectClaudePath, exists: existsSync(projectClaudePath) },
    { type: 'halo-global', path: haloGlobalPath, exists: existsSync(haloGlobalPath) },
    { type: 'halo-space', path: spacePath, exists: existsSync(spacePath) }
  ]

  // 添加文件大小信息
  for (const file of files) {
    if (file.exists) {
      try {
        const content = readFileSync(file.path, 'utf-8')
        file.size = content.length
      } catch {
        // ignore
      }
    }
  }

  return files
}
