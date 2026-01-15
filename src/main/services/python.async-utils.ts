/**
 * Python Service Async Utilities
 *
 * 提供异步版本的进程执行函数，避免阻塞主进程
 */

import { execFile, ChildProcess } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
}

/**
 * 异步执行命令并返回输出
 */
export async function execFilePromise(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding
    timeout?: number
    env?: NodeJS.ProcessEnv
    cwd?: string
    maxBuffer?: number
  } = {}
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: options.encoding || 'utf8',
    timeout: options.timeout || 30000,
    env: options.env,
    cwd: options.cwd,
    maxBuffer: options.maxBuffer || 1024 * 1024 // 1MB default
  })

  return {
    stdout: typeof stdout === 'string' ? stdout : stdout.toString(),
    stderr: typeof stderr === 'string' ? stderr : stderr.toString()
  }
}

/**
 * 活跃进程追踪集合
 */
const activeProcesses = new Set<ChildProcess>()

/**
 * 注册进程到追踪集合
 */
export function trackProcess(proc: ChildProcess): void {
  activeProcesses.add(proc)
  proc.on('exit', () => {
    activeProcesses.delete(proc)
  })
  proc.on('error', () => {
    activeProcesses.delete(proc)
  })
}

/**
 * 获取活跃进程数量
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size
}

/**
 * 清理所有活跃进程
 */
export function cleanupAllProcesses(): void {
  console.log(`[Python] Cleaning up ${activeProcesses.size} active processes`)
  for (const proc of activeProcesses) {
    try {
      proc.kill('SIGTERM')
      // 5秒后强制终止
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 5000)
    } catch (e) {
      console.error('[Python] Error killing process:', e)
    }
  }
  activeProcesses.clear()
}
