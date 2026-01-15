# Python 集成安全与性能修复实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 Python 集成功能中的 5 个 P1 严重问题和关键 P2 问题，确保安全性和性能。

**Architecture:** 采用分层修复策略：首先添加输入验证层防止注入攻击，然后将同步阻塞调用改为异步，最后添加资源追踪和清理机制。

**Tech Stack:** TypeScript, Electron IPC, Node.js child_process, Zustand

---

## Phase 1: 输入验证与安全加固

### Task 1: 添加输入验证工具函数

**Files:**
- Create: `src/main/services/python.validation.ts`
- Test: 手动测试（验证函数为纯函数）

**Step 1: 创建验证模块**

```typescript
// src/main/services/python.validation.ts
/**
 * Python Service Input Validation
 *
 * 提供包名、spaceId、版本号等输入的验证函数
 */

/**
 * 有效的 pip 包名正则
 * 参考: https://peps.python.org/pep-0508/#names
 */
const VALID_PACKAGE_NAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/

/**
 * 有效的版本号正则（支持 PEP 440 格式）
 */
const VALID_VERSION_REGEX = /^[0-9]+(\.[0-9]+)*([a-zA-Z0-9.+-]*)?$/

/**
 * 有效的 spaceId 正则（只允许字母数字、下划线、连字符）
 */
const VALID_SPACE_ID_REGEX = /^[a-zA-Z0-9_-]+$/

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * 验证 pip 包名格式
 */
export function validatePackageName(packageName: string): ValidationResult {
  if (!packageName || typeof packageName !== 'string') {
    return { valid: false, error: '包名不能为空' }
  }

  const trimmed = packageName.trim()

  if (trimmed.length === 0) {
    return { valid: false, error: '包名不能为空' }
  }

  if (trimmed.length > 100) {
    return { valid: false, error: '包名过长（最大 100 字符）' }
  }

  if (!VALID_PACKAGE_NAME_REGEX.test(trimmed)) {
    return { valid: false, error: '包名格式无效，只允许字母、数字、点、下划线和连字符' }
  }

  return { valid: true }
}

/**
 * 验证版本号格式
 */
export function validateVersion(version: string): ValidationResult {
  if (!version || typeof version !== 'string') {
    return { valid: false, error: '版本号不能为空' }
  }

  const trimmed = version.trim()

  if (!VALID_VERSION_REGEX.test(trim   return { valid: false, error: '版本号格式无效' }
  }

  return { valid: true }
}

/**
 * 验证 spaceId 格式，防止路径遍历
 */
export function validateSpaceId(spaceId: string): ValidationResult {
  if (!spaceId || typeof spaceId !== 'string') {
    return { valid: false, error: 'Space ID 不能为空' }
  }

  const trimmed = spaceId.trim()

  // 检查路径遍历字符
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return { valid: false, error: 'Space ID 包含非法字符' }
  }

  if (!VALID_SPACE_ID_REGEX.test(trimmed)) {
    return { valid: false, error: 'Space ID 格式无效，只允许字母、数字、下划线和连字符' }
  }

  return { valid: true }
}

/**
 * 验证工作目录路径
 */
export function validateWorkingDirectory(cwd: string, allowedBasePaths: string[]): ValidationResult {
  if (!cwd || typeof cwd !== 'string') {
    return { valid: false, error: '工作目录不能为空' }
  }

  const path = require('path')
  const normalizedCwd = path.resolve(cwd)

  // 检查是否在允许的基础路径内
  const isAllowed = allowedBasePaths.some(basePath => {
    const normalizedBase = path.resolve(basePath)
    return normalizedCwd.startsWith(normalizedBase + path.sep) || normalizedCwd === normalizedBase
  })

  if (!isAllowed) {
    return { valid: false, error: '工作目录不在允许的范围内' }
  }

  return { valid: true }
}
```

**Step 2: 提交**

```bash
git add src/main/services/python.validation.ts
git commit -m "feat(python): add input validation utilities"
```

---

### Task 2: 在 installPackage 中添加包名验证

**Files:**
- Modify: `src/main/services/python.service.ts:424-440`

**Step 1: 导入验证函数**

在文件顶部添加导入：

```typescript
import { validatePackageName, validateVersion, validateSpaceId } from './python.validation'
```

**Step 2: 修改 installPackage 函数**

找到 `installPackage` 函数（约第 424 行），在函数开头添加验证：

```typescript
export async function installPackage(
  packageName: string,
  options: {
    spaceId?: string
    version?: string
    onProgress?: (progress: PipInstallProgress) => void
  } = {}
): Promise<{ success: boolean; error?: string }> {
  // 验证包名
  const packageValidation = validatePackageName(packageName)
  if (!packageValidation.valid) {
    return { success: false, error: packageValidation.error }
  }

  // 验证版本号（如果提供）
  if (options.version) {
    const versionValidation = validateVersion(options.version)
    if (!versionValidation.valid) {
      return { success: false, error: versionValidation.error }
    }
  }

  // 验证 spaceId（如果提供）
  if (options.spaceId) {
    const spaceValidation = validateSpaceId(options.spaceId)
    if (!spaceValidation.valid) {
      return { success: false, error: spaceValidation.error }
    }
  }

  const env = options.spaceId ? getSpaceEnvironment(options.spaceId) : detectPython().environment
  // ... 后续代码保持不变
```

**Step 3: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "feat(python): add package name validation to installPackage"
```

---

### Task 3: 在 uninstallPackage 中添加验证

**Files:**
- Modify: `src/main/services/python.service.ts:531-567`

**Step 1: 修改 uninstallPackage 函数**

```typescript
export async function uninstallPackage(
  packageName: string,
  options: {
    spaceId?: string
  } = {}
): Promise<{ success: boolean; error?: string }> {
  // 验证包名
  const packageValidation = validatePackageName(packageName)
  if (!packageValidation.valid) {
    return { success: false, error: packageValidation.error }
  }

  // 验证 spaceId（如果提供）
  if (options.spaceId) {
    const spaceValidation = validateSpaceId(options.spaceId)
    if (!spaceValidation.valid) {
      return { success: false, error: spaceValidation.error }
    }
  }

  const env = options.spaceId ? getSpaceEnvironment(options.spaceId) : detectPython().environment
  // ... 后续代码保持不变
```

**Step 2: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "feat(python): add validation to uninstallPackage"
```

---

### Task 4: 修复 getSpaceVenvDir 路径遍历漏洞

**Files:**
- Modify: `src/main/services/python.service.ts:163-165`

**Step 1: 修改 getSpaceVenvDir 函数**

```typescript
/**
 * Get the virtual environment directory for a space
 */
export function getSpaceVenvDir(spaceId: string): string {
  // 验证 spaceId 防止路径遍历
  const validation = validateSpaceId(spaceId)
  if (!validation.valid) {
    throw new Error(`Invalid spaceId: ${validation.error}`)
  }

  const venvDir = join(app.getPath('userData'), 'spaces', spaceId, '.venv')

  // 二次验证：确保路径在预期目录内
  const userDataPath = app.getPath('userData')
  if (!venvDir.startsWith(userDataPath)) {
    throw new Error('Path traversal detected')
  }

  return venvDir
}
```

**Step 2: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "fix(python): prevent path traversal in getSpaceVenvDir"
```

---

## Phase 2: 异步化阻塞调用

### Task 5: 创建异步执行工具函数

**Files:**
- Create: `src/main/services/python.async-utils.ts`

**Step 1: 创建异步工具模块**

```typescript
// src/main/services/python.async-utils.ts
/**
 * Python Service Async Utilities
 *
 * 提供异步版本的进程执行函数，避免阻塞主进程
 */

import { execFile, spawn, ChildProcess } from 'child_process'
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
```

**Step 2: 提交**

```bash
git add src/main/services/python.async-utils.ts
git commit -m "feat(python): add async execution utilities with process tracking"
```

---

### Task 6: 将 detectPython 改为异步

**Files:**
- Modify: `src/main/services/python.service.ts:174-221`

**Step 1: 导入异步工具**

```typescript
import { execFilePromise, trackProcess, cleanupAllProcesses } from './python.async-utils'
```

**Step 2: 修改 detectPython 为异步函数**

```typescript
/**
 * Detect and validate the embedded Python installation
 */
export async function detectPython(): Promise<PythonDetectionResult> {
  const pythonPath = getPythonExecutable()
  const pipPath = getPipExecutable()

  if (!existsSync(pythonPath)) {
    return {
      found: false,
      environment: null,
      error: `Python 环境未找到，请确保应用已正确安装`
    }
  }

  try {
    // 异步获取 Python 版本
    const versionResult = await execFilePromise(pythonPath, ['--version'], {
      timeout: 5000
    })
    const version = versionResult.stdout.trim().replace('Python ', '')

    // 异步获取 site-packages 路径
    const sitePackagesResult = await execFilePromise(
      pythonPath,
      ['-c', 'import site; print(site.getsitepackages()[0])'],
      { timeout: 5000 }
    )
    const sitePackages = sitePackagesResult.stdout.trim()

    return {
      found: true,
      environment: {
        type: 'embedded',
        pythonPath,
        pipPath,
        version,
        sitePackages
      }
    }
  } catch (error) {
    return {
      found: false,
      environment: null,
      error: `Python 环境验证失败: ${(error as Error).message}`
    }
  }
}
```

**Step 3: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "refactor(python): make detectPython async to avoid blocking main process"
```

---

### Task 7: 更新所有 detectPython 调用点

**Files:**
- Modify: `src/main/services/python.service.ts` (多处)
- Modify: `src/main/ipc/python.ts`

**Step 1: 修改 getSpaceEnvironment 为异步**

```typescript
/**
 * Get the Python environment for a space (venv if exists, otherwise global)
 */
export async function getSpaceEnvironment(spaceId: string): Promise<PythonEnvironment | null> {
  const detection = await detectPython()
  if (!detection.found || !detection.environment) {
    return null
  }

  // Check for space-specific venv
  if (hasSpaceVenv(spaceId)) {
    const venvDir = getSpaceVenvDir(spaceId)
    const versionMajorMinor = detection.environment.version.split('.').slice(0, 2).join('.')

    return {
      type: 'venv',
      pythonPath: join(venvDir, platformConfig.venvPython),
      pipPath: join(venvDir, platformConfig.venvPip),
      version: detection.environment.version,
      sitePackages: join(
        venvDir,
        platformConfig.sitePackagesTemplate.replace('{version}', versionMajorMinor)
      )
    }
  }

  return detection.environment
}
```

**Step 2: 更新 executePythonCode 中的调用**

```typescript
// 第 284 行附近
const env = options.spaceId
  ? await getSpaceEnvironment(options.spaceId)
  : (await detectPython()).environment
```

**Step 3: 更新 installPackage 中的调用**

```typescript
// 第 432 行附近
const env = options.spaceId
  ? await getSpaceEnvironment(options.spaceId)
  : (await detectPython()).environment
```

**Step 4: 更新 uninstallPackage 中的调用**

```typescript
// 第 537 行附近
const env = options.spaceId
  ? await getSpaceEnvironment(options.spaceId)
  : (await detectPython()).environment
```

**Step 5: 更新 listPackages 中的调用并改为异步**

```typescript
export async function listPackages(
  spaceId?: string
): Promise<{ success: boolean; packages?: PackageInfo[]; error?: string }> {
  const env = spaceId
    ? await getSpaceEnvironment(spaceId)
    : (await detectPython()).environment

  if (!env) {
    return { success: false, error: 'Python environment not available' }
  }

  try {
    const processEnv: Record<string, string> = { ...process.env } as Record<string, string>

    if (env.type === 'embedded') {
      const globalPackages = getGlobalPackagesDir()
      if (existsSync(globalPackages)) {
        processEnv.PYTHONPATH = globalPackages
      }
    }

    // 使用异步版本
    const result = await execFilePromise(
      env.pythonPath,
      ['-m', 'pip', 'list', '--format=json'],
      {
        env: processEnv,
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024 // 5MB for large package lists
      }
    )

    const packages = JSON.parse(result.stdout) as PackageInfo[]
    return { success: true, packages }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
```

**Step 6: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "refactor(python): update all detectPython callers to use async"
```

---

### Task 8: 更新 IPC 处理器

**Files:**
- Modify: `src/main/ipc/python.ts`

**Step 1: 更新 IPC handlers 以支持异步 detectPython**

IPC handlers 已经使用 `createHandler` 包装，支持 Promise，无需修改结构。只需确保导入的函数签名正确。

**Step 2: 验证 IPC 调用正常工作**

运行应用并测试 Python 检测功能。

**Step 3: 提交**

```bash
git add src/main/ipc/python.ts
git commit -m "refactor(python): ensure IPC handlers work with async detectPython"
```

---

## Phase 3: 资源清理与进程追踪

### Task 9: 在 executePythonCode 中添加进程追踪

**Files:**
- Modify: `src/main/services/python.service.ts:324`

**Step 1: 修改 spawn 调用后添加追踪**

```typescript
const pythonProcess = spawn(env.pythonPath, ['-u', tempFile], {
  cwd: options.cwd || tempDir,
  env: processEnv
})

// 追踪进程
trackProcess(pythonProcess)
```

**Step 2: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "feat(python): track spawned processes in executePythonCode"
```

---

### Task 10: 在 installPackage/uninstallPackage 中添加进程追踪

**Files:**
- Modify: `src/main/services/python.service.ts:461,546`

**Step 1: 在 installPackage 中添加追踪**

```typescript
const pipProcess = spawn(env.pythonPath, args, {
  env: process.env as Record<string, string>
})

// 追踪进程
trackProcess(pipProcess)
```

**Step 2: 在 uninstallPackage 中添加追踪**

```typescript
const pipProcess = spawn(env.pythonPath, args, {
  env: process.env as Record<string, string>
})

// 追踪进程
trackProcess(pipProcess)
```

**Step 3: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "feat(python): track pip processes"
```

---

### Task 11: 完善 IPC 清理函数

**Files:**
- Modify: `src/main/ipc/python.ts:198-201`

**Step 1: 修改 cleanupPythonHandlers**

```typescript
import { cleanupAllProcesses } from '../services/python.async-utils'

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
```

**Step 2: 提交**

```bash
git add src/main/ipc/python.ts
git commit -m "fix(python): properly cleanup IPC handlers and processes"
```

---

### Task 12: 在 Bootstrap 中调用 Python 清理

**Files:**
- Modify: `src/main/bootstrap/extended.ts:100-110`

**Step 1: 导入并调用清理函数**

```typescript
import { cleanupPythonHandlers } from '../ipc/python'

export function cleanupExtendedServices(): void {
  // AI Browser: Cleanup MCP server and browser context
  cleanupAIBrowserHandlers()

  // Overlay: Cleanup overlay BrowserView
  cleanupOverlayHandlers()

  // Search: Cancel any ongoing searches
  cleanupSearchHandlers()

  // Python: Cleanup handlers and kill active processes
  cleanupPythonHandlers()

  console.log('[Bootstrap] Extended services cleaned up')
}
```

**Step 2: 提交**

```bash
git add src/main/bootstrap/extended.ts
git commit -m "fix(bootstrap): include Python cleanup in extended services"
```

---

## Phase 4: 环境检测缓存

### Task 13: 添加检测结果缓存

**Files:**
- Modify: `src/main/services/python.service.ts`

**Step 1: 添加缓存变量和函数**

在文件顶部（常量定义之后）添加：

```typescript
// ============================================
// Detection Cache
// ============================================

let cachedDetectionResult: PythonDetectionResult | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 60000 // 1 minute cache

/**
 * 清除检测缓存（在环境可能变化时调用）
 */
export function clearDetectionCache(): void {
  cachedDetectionResult = null
  cacheTimestamp = 0
  console.log('[Python] Detection cache cleared')
}

/**
 * Detect Python with caching
 */
export async function detectPythonCached(): Promise<PythonDetectionResult> {
  const now = Date.now()

  // 返回缓存结果（如果有效）
  if (cachedDetectionResult && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedDetectionResult
  }

  // 执行检测并缓存
  const result = await detectPython()
  cachedDetectionResult = result
  cacheTimestamp = now

  return result
}
```

**Step 2: 更新调用点使用缓存版本**

将所有 `detectPython()` 调用改为 `detectPythonCached()`（除了 IPC handler 中的直接检测调用，那个应该保持不缓存以便用户手动刷新）。

**Step 3: 提交**

```bash
git add src/main/services/python.service.ts
git commit -m "perf(python): add detection result caching"
```

---

## Phase 5: 最终验证

### Task 14: 手动测试验证

**Step 1: 启动应用**

```bash
npm run dev
```

**Step 2: 测试 Python 检测**

1. 打开设置页面
2. 确认 Python 环境正确检测
3. 确认 UI 不会冻结

**Step 3: 测试包安装验证**

1. 尝试安装正常包名：`requests`
2. 尝试安装非法包名：`../../../etc/passwd` - 应该被拒绝
3. 尝试安装带版本的包：`requests==2.28.0`

**Step 4: 测试应用关闭**

1. 启动一个长时间运行的 Python 脚本
2. 关闭应用
3. 确认没有孤儿进程残留

**Step 5: 提交最终更改**

```bash
git add -A
git commit -m "test: verify Python integration security fixes"
```

---

## 总结

| Phase | Tasks | 预计时间 |
|-------|-------|---------|
| Phase 1: 输入验证 | Task 1-4 | 20 分钟 |
| Phase 2: 异步化 | Task 5-8 | 30 分钟 |
| Phase 3: 资源清理 | Task 9-12 | 15 分钟 |
| Phase 4: 缓存 | Task 13 | 10 分钟 |
| Phase 5: 验证 | Task 14 | 15 分钟 |

**总计: 约 90 分钟**

---

## 后续优化（可选）

以下问题可以在后续迭代中处理：

1. **P2: 环境变量过滤** - 过滤敏感环境变量
2. **P2: 临时文件安全** - 使用 crypto.randomUUID 生成文件名
3. **P3: 错误消息国际化** - 使用 i18n 处理错误消息
4. **P3: 包列表虚拟化** - 使用 react-window 优化大列表渲染
