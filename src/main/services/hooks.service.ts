/**
 * Hooks Service - 管理 Claude Code 钩子系统
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

// ============================================
// 安全配置
// ============================================

// 允许的命令白名单（基础命令名，不含路径）
// 用户可以使用这些命令来处理钩子输入
const ALLOWED_COMMANDS = new Set([
  // 文本处理
  'echo', 'cat', 'head', 'tail', 'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc',
  // JSON 处理
  'jq',
  // 脚本运行时
  'node', 'python', 'python3', 'ruby', 'perl',
  // 实用工具
  'date', 'env', 'true', 'false', 'test', 'expr',
  // Windows 兼容
  'cmd', 'powershell'
])

// 危险的命令模式（正则表达式）
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/i,           // rm -r, rm -rf
  /\bsudo\b/i,                 // sudo
  /\bchmod\b/i,                // chmod
  /\bchown\b/i,                // chown
  /\bmkfs\b/i,                 // mkfs
  /\bdd\b/i,                   // dd
  /\b>\s*\/dev\//i,            // 写入设备
  /\bcurl\b.*\|\s*sh/i,        // curl | sh
  /\bwget\b.*\|\s*sh/i,        // wget | sh
  /\beval\b/i,                 // eval
  /`[^`]+`/,                   // 反引号命令替换
  /\$\([^)]+\)/,               // $() 命令替换
]

// SDK Hook 类型
export type HookEvent =
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'Notification' | 'UserPromptSubmit'
  | 'SessionStart' | 'SessionEnd' | 'Stop'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreCompact' | 'PermissionRequest'

export interface HookOutput {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: any
}

export type HookCallback = (
  input: any,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookOutput>

export interface HookCallbackMatcher {
  matcher?: string
  hooks: HookCallback[]
  timeout?: number
}

// 用户配置的钩子格式
export interface HookMatcherConfig {
  matcher?: string
  command?: string
  timeout?: number
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcherConfig[]>>

// ============================================
// 钩子构建
// ============================================

/**
 * 从配置构建 SDK hooks 参数
 */
export function buildHooksFromConfig(
  globalHooks: HooksConfig = {},
  spaceHooks: HooksConfig = {}
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  // 合并钩子配置
  const mergedHooks = mergeHooksConfig(globalHooks, spaceHooks)

  if (Object.keys(mergedHooks).length === 0) {
    return undefined
  }

  // 转换为 SDK 格式
  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}

  for (const [event, matchers] of Object.entries(mergedHooks)) {
    if (!Array.isArray(matchers) || matchers.length === 0) continue

    result[event as HookEvent] = matchers.map(m => ({
      matcher: m.matcher,
      timeout: m.timeout || 30,
      hooks: [createHookCallback(m)]
    }))
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 合并全局和空间钩子配置
 */
function mergeHooksConfig(
  globalHooks: HooksConfig,
  spaceHooks: HooksConfig
): HooksConfig {
  const result: HooksConfig = {}

  // 收集所有事件类型
  const allEvents = new Set([
    ...Object.keys(globalHooks),
    ...Object.keys(spaceHooks)
  ]) as Set<HookEvent>

  for (const event of allEvents) {
    const globalMatchers = globalHooks[event] || []
    const spaceMatchers = spaceHooks[event] || []

    // 追加空间钩子到全局钩子后面
    if (globalMatchers.length > 0 || spaceMatchers.length > 0) {
      result[event] = [...globalMatchers, ...spaceMatchers]
    }
  }

  return result
}

/**
 * 创建钩子回调函数
 */
function createHookCallback(matcher: HookMatcherConfig): HookCallback {
  return async (input, toolUseID, { signal }) => {
    // 如果配置了 shell 命令，执行它
    if (matcher.command) {
      try {
        const result = await executeHookCommand(
          matcher.command,
          input,
          signal,
          matcher.timeout || 30
        )
        return parseHookResult(result)
      } catch (e) {
        console.error('[Hooks] Command execution failed:', e)
        return { continue: true }
      }
    }

    // 默认继续
    return { continue: true }
  }
}

// ============================================
// 命令安全验证
// ============================================

/**
 * 验证钩子命令是否安全
 * @returns 错误消息，如果安全则返回 null
 */
function validateHookCommand(command: string): string | null {
  // 1. 检查危险模式
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command contains dangerous pattern: ${pattern.toString()}`
    }
  }

  // 2. 提取基础命令名（处理管道和重定向）
  const baseCommand = extractBaseCommand(command)
  if (!baseCommand) {
    return 'Could not parse command'
  }

  // 3. 检查是否在白名单中
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return `Command '${baseCommand}' is not in the allowed list. Allowed: ${Array.from(ALLOWED_COMMANDS).join(', ')}`
  }

  return null
}

/**
 * 从命令字符串中提取基础命令名
 */
function extractBaseCommand(command: string): string | null {
  // 去除前导空格和环境变量设置
  const trimmed = command.trim().replace(/^(\w+=\S+\s+)+/, '')

  // 获取第一个命令（管道前的部分）
  const firstCommand = trimmed.split(/\s*\|\s*/)[0]

  // 提取命令名（可能带路径）
  const parts = firstCommand.trim().split(/\s+/)
  if (parts.length === 0) return null

  // 获取命令名（去除路径）
  const cmdWithPath = parts[0]
  const cmdName = cmdWithPath.split(/[/\\]/).pop() || cmdWithPath

  return cmdName.toLowerCase()
}

/**
 * 执行钩子命令
 */
async function executeHookCommand(
  command: string,
  input: any,
  signal: AbortSignal,
  timeoutSeconds: number
): Promise<string> {
  // 安全验证
  const validationError = validateHookCommand(command)
  if (validationError) {
    console.warn(`[Hooks] Security: Command rejected - ${validationError}`)
    console.warn(`[Hooks] Rejected command: ${command}`)
    throw new Error(`Hook command rejected: ${validationError}`)
  }

  // 跨平台 shell 选择
  const isWindows = process.platform === 'win32'
  const shell = isWindows ? 'cmd' : 'sh'
  const shellArgs = isWindows ? ['/c', command] : ['-c', command]

  return new Promise((resolvePromise, reject) => {
    const proc = spawn(shell, shellArgs, {
      env: {
        ...process.env,
        HOOK_INPUT: JSON.stringify(input)
      },
      timeout: timeoutSeconds * 1000
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new Error(`Hook command exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })

    // 处理中断信号
    const abortHandler = () => {
      proc.kill('SIGTERM')
      reject(new Error('Hook aborted'))
    }
    signal.addEventListener('abort', abortHandler)

    // 清理
    proc.on('close', () => {
      signal.removeEventListener('abort', abortHandler)
    })
  })
}

/**
 * 解析钩子命令输出
 */
function parseHookResult(output: string): HookOutput {
  try {
    const parsed = JSON.parse(output.trim())
    return {
      continue: parsed.continue ?? true,
      suppressOutput: parsed.suppressOutput,
      stopReason: parsed.stopReason,
      decision: parsed.decision,
      systemMessage: parsed.systemMessage,
      reason: parsed.reason,
      hookSpecificOutput: parsed.hookSpecificOutput
    }
  } catch {
    // 非 JSON 输出，默认继续
    return { continue: true }
  }
}

// ============================================
// 内置钩子
// ============================================

/**
 * 获取 Halo 内置钩子
 */
export function getBuiltinHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    SessionStart: [{
      hooks: [async (input) => ({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `
[Halo Context]
- Session started at: ${new Date().toISOString()}
- Running in Halo Desktop App
- Extended capabilities: AI Browser, Canvas, Remote Access
`
        }
      })]
    }]
  }
}

/**
 * 合并内置钩子和用户钩子
 */
export function mergeWithBuiltinHooks(
  userHooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const builtin = getBuiltinHooks()

  if (!userHooks) return builtin

  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = { ...builtin }

  for (const [event, matchers] of Object.entries(userHooks)) {
    const existing = result[event as HookEvent] || []
    result[event as HookEvent] = [...existing, ...matchers]
  }

  return result
}

/**
 * 获取所有支持的钩子事件列表
 */
export function getHookEvents(): HookEvent[] {
  return [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Notification', 'UserPromptSubmit',
    'SessionStart', 'SessionEnd', 'Stop',
    'SubagentStart', 'SubagentStop',
    'PreCompact', 'PermissionRequest'
  ]
}
