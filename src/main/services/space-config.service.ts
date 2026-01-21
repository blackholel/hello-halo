/**
 * Space Config Service - 管理空间级配置
 * 配置文件位置: {spacePath}/.halo/space-config.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// 空间配置类型
export interface SpacePluginsConfig {
  paths?: string[]            // Additional space-specific plugin paths
  disableGlobal?: boolean     // Default: false, whether to disable global plugins
  loadDefaultPath?: boolean   // Default: true, whether to load {workDir}/.claude/
}

export interface SpaceClaudeCodeConfig {
  memory?: {
    enabled?: boolean
    spaceMemory?: string
  }
  plugins?: SpacePluginsConfig
  agents?: Record<string, {
    description: string
    prompt: string
    tools?: string[]
    disallowedTools?: string[]
    model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
    mcpServers?: string[]
  }>
  hooks?: Record<string, Array<{
    matcher?: string
    command?: string
    timeout?: number
  }>>
  tools?: {
    allowed?: string[]
    disallowed?: string[]
  }
  mcpServers?: Record<string, any>
}

export interface SpaceConfig {
  claudeCode?: SpaceClaudeCodeConfig
}

// 获取空间配置文件路径
export function getSpaceConfigPath(workDir: string): string {
  return join(workDir, '.halo', 'space-config.json')
}

// 读取空间配置
export function getSpaceConfig(workDir: string): SpaceConfig | null {
  const configPath = getSpaceConfigPath(workDir)

  if (!existsSync(configPath)) {
    return null
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    return JSON.parse(content)
  } catch (e) {
    console.error(`[SpaceConfig] Failed to read: ${configPath}`, e)
    return null
  }
}

// 保存空间配置
export function saveSpaceConfig(workDir: string, config: SpaceConfig): boolean {
  const configPath = getSpaceConfigPath(workDir)

  try {
    const dir = dirname(configPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    console.log(`[SpaceConfig] Saved: ${configPath}`)
    return true
  } catch (e) {
    console.error(`[SpaceConfig] Failed to write: ${configPath}`, e)
    return false
  }
}

// 部分更新空间配置
export function updateSpaceConfig(
  workDir: string,
  updates: Partial<SpaceConfig>
): SpaceConfig | null {
  const current = getSpaceConfig(workDir) || {}

  const merged: SpaceConfig = {
    ...current,
    claudeCode: {
      ...current.claudeCode,
      ...updates.claudeCode
    }
  }

  if (saveSpaceConfig(workDir, merged)) {
    return merged
  }

  return null
}

// 获取空间 Claude Code 配置（带默认值）
export function getSpaceClaudeCodeConfig(workDir: string): SpaceClaudeCodeConfig {
  const config = getSpaceConfig(workDir)
  return config?.claudeCode || {}
}

// 更新空间 Claude Code 配置
export function updateSpaceClaudeCodeConfig(
  workDir: string,
  updates: Partial<SpaceClaudeCodeConfig>
): boolean {
  const result = updateSpaceConfig(workDir, { claudeCode: updates })
  return result !== null
}
