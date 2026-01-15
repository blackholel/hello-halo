/**
 * Python Service - Embedded Python environment management
 *
 * Provides:
 * - Embedded Python interpreter detection and path management
 * - Code execution with timeout and output capture
 * - pip package installation
 * - Virtual environment management (per-space isolation)
 */

import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync, chmodSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import { execFilePromise, trackProcess, cleanupAllProcesses } from './python.async-utils'

// ============================================
// Types (imported from shared)
// ============================================

import type {
  PythonEnvironment,
  PythonExecutionResult,
  PipInstallProgress,
  VenvCreateProgress,
  PythonDetectionResult,
  PackageInfo
} from '../../shared/types/python.types'

import { validatePackageName, validateVersion, validateSpaceId } from './python.validation'

// Re-export types for consumers of this service
export type {
  PythonEnvironment,
  PythonExecutionResult,
  PipInstallProgress,
  VenvCreateProgress,
  PythonDetectionResult,
  PackageInfo
}

// ============================================
// Constants
// ============================================

const PYTHON_VERSION_EXPECTED = '3.11'
const EXECUTION_TIMEOUT_MS = 300000 // 5 minutes default
const MAX_OUTPUT_SIZE = 1024 * 1024 // 1MB max output

// ============================================
// Platform Configuration
// ============================================

interface PlatformPaths {
  /** Python executable relative path from python dir */
  pythonExe: string
  /** Python bin directory relative path from python dir */
  pythonBinDir: string
  /** pip executable relative path from python dir */
  pipExe: string
  /** Python executable relative path in venv */
  venvPython: string
  /** pip executable relative path in venv */
  venvPip: string
  /** site-packages path template in venv (use {version} for python version) */
  sitePackagesTemplate: string
  /** PATH environment variable separator */
  pathSeparator: string
  /** Resource subdirectory name for development */
  resourceSubdir: string
}

const PLATFORM_PATHS: Record<'win32' | 'darwin' | 'linux', PlatformPaths> = {
  win32: {
    pythonExe: 'python.exe',
    pythonBinDir: '',
    pipExe: join('Scripts', 'pip.exe'),
    venvPython: join('Scripts', 'python.exe'),
    venvPip: join('Scripts', 'pip.exe'),
    sitePackagesTemplate: join('Lib', 'site-packages'),
    pathSeparator: ';',
    resourceSubdir: 'win32-x64/python'
  },
  darwin: {
    pythonExe: join('bin', 'python3'),
    pythonBinDir: 'bin',
    pipExe: join('bin', 'pip3'),
    venvPython: join('bin', 'python3'),
    venvPip: join('bin', 'pip3'),
    sitePackagesTemplate: join('lib', 'python{version}', 'site-packages'),
    pathSeparator: ':',
    resourceSubdir: 'darwin-arm64/python'
  },
  linux: {
    pythonExe: join('bin', 'python3'),
    pythonBinDir: 'bin',
    pipExe: join('bin', 'pip3'),
    venvPython: join('bin', 'python3'),
    venvPip: join('bin', 'pip3'),
    sitePackagesTemplate: join('lib', 'python{version}', 'site-packages'),
    pathSeparator: ':',
    resourceSubdir: 'linux-x64/python'
  }
}

/** Current platform configuration */
const platformConfig: PlatformPaths =
  PLATFORM_PATHS[process.platform as keyof typeof PLATFORM_PATHS] || PLATFORM_PATHS.linux

// ============================================
// Path Management
// ============================================

/**
 * Get the path to the embedded Python installation
 */
export function getEmbeddedPythonDir(): string {
  // In development, use resources/python directly
  if (!app.isPackaged) {
    return join(__dirname, '../../resources/python', platformConfig.resourceSubdir)
  }

  // In production, extraResources places it in Resources/python
  return join(process.resourcesPath, 'python', 'python')
}

/**
 * Get the Python executable path
 */
export function getPythonExecutable(): string {
  const pythonDir = getEmbeddedPythonDir()
  return join(pythonDir, platformConfig.pythonExe)
}

/**
 * Get the pip executable path (we use python -m pip instead)
 */
export function getPipExecutable(): string {
  const pythonDir = getEmbeddedPythonDir()
  return join(pythonDir, platformConfig.pipExe)
}

/**
 * Get the PATH environment variable with embedded Python prepended.
 * This ensures the embedded Python is found first when executing commands.
 */
export function getPythonEnhancedPath(): string {
  const pythonDir = getEmbeddedPythonDir()
  const pythonBinDir = platformConfig.pythonBinDir
    ? join(pythonDir, platformConfig.pythonBinDir)
    : pythonDir
  return `${pythonBinDir}${platformConfig.pathSeparator}${process.env.PATH || ''}`
}

/**
 * Get the global packages directory (shared across all spaces)
 */
export function getGlobalPackagesDir(): string {
  return join(app.getPath('userData'), 'python-packages')
}

/**
 * Get the virtual environment directory for a space
 */
export function getSpaceVenvDir(spaceId: string): string {
  // 验证 spaceId 防止路径遍历
  const validation = validateSpaceId(spaceId)
  if (!validation.valid) {
    throw new Error(`Invalid spaceId: ${validation.error}`)
  }

  const userDataPath = app.getPath('userData')
  const venvDir = join(userDataPath, 'spaces', spaceId, '.venv')

  // 二次验证：确保路径在预期目录内
  if (!venvDir.startsWith(userDataPath)) {
    throw new Error('Path traversal detected')
  }

  return venvDir
}

// ============================================
// Environment Detection
// ============================================

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

/**
 * Check if a space has a virtual environment
 */
export function hasSpaceVenv(spaceId: string): boolean {
  const venvDir = getSpaceVenvDir(spaceId)
  const pythonPath = join(venvDir, platformConfig.venvPython)
  return existsSync(pythonPath)
}

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

  // Return global embedded environment
  return detection.environment
}

// ============================================
// Code Execution
// ============================================

/**
 * Execute Python code and return the result
 */
export async function executePythonCode(
  code: string,
  options: {
    spaceId?: string
    cwd?: string
    timeout?: number
    env?: Record<string, string>
    onStdout?: (data: string) => void
    onStderr?: (data: string) => void
  } = {}
): Promise<PythonExecutionResult> {
  const startTime = Date.now()
  const timeout = options.timeout || EXECUTION_TIMEOUT_MS

  // Get appropriate Python environment
  const env = options.spaceId
    ? await getSpaceEnvironment(options.spaceId)
    : (await detectPython()).environment

  if (!env) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      duration: Date.now() - startTime,
      error: 'Python environment not available'
    }
  }

  // Create temp file for code
  const tempDir = app.getPath('temp')
  const tempFile = join(tempDir, `halo-python-${Date.now()}-${Math.random().toString(36).slice(2)}.py`)

  try {
    writeFileSync(tempFile, code, 'utf8')

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false
      let outputTruncated = false

      // Build environment variables
      const processEnv: Record<string, string> = {
        ...process.env,
        ...options.env
      } as Record<string, string>

      // Add global packages to PYTHONPATH if using embedded env
      if (env.type === 'embedded') {
        const globalPackages = getGlobalPackagesDir()
        if (existsSync(globalPackages)) {
          processEnv.PYTHONPATH = globalPackages
        }
      }

      const pythonProcess = spawn(env.pythonPath, ['-u', tempFile], {
        cwd: options.cwd || tempDir,
        env: processEnv
      })

      // 追踪进程以便在应用关闭时清理
      trackProcess(pythonProcess)

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true
        pythonProcess.kill('SIGTERM')
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!pythonProcess.killed) {
            pythonProcess.kill('SIGKILL')
          }
        }, 5000)
      }, timeout)

      pythonProcess.stdout.on('data', (data) => {
        const str = data.toString()
        if (stdout.length + str.length <= MAX_OUTPUT_SIZE) {
          stdout += str
          options.onStdout?.(str)
        } else if (!outputTruncated) {
          outputTruncated = true
          stdout += '\n... [output truncated] ...'
        }
      })

      pythonProcess.stderr.on('data', (data) => {
        const str = data.toString()
        if (stderr.length + str.length <= MAX_OUTPUT_SIZE) {
          stderr += str
          options.onStderr?.(str)
        }
      })

      pythonProcess.on('close', (exitCode) => {
        clearTimeout(timeoutId)

        // Clean up temp file
        try {
          unlinkSync(tempFile)
        } catch {
          /* ignore */
        }

        resolve({
          success: exitCode === 0 && !killed,
          stdout,
          stderr,
          exitCode,
          duration: Date.now() - startTime,
          error: killed ? 'Execution timed out' : undefined
        })
      })

      pythonProcess.on('error', (error) => {
        clearTimeout(timeoutId)

        try {
          unlinkSync(tempFile)
        } catch {
          /* ignore */
        }

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: null,
          duration: Date.now() - startTime,
          error: error.message
        })
      })
    })
  } catch (error) {
    try {
      unlinkSync(tempFile)
    } catch {
      /* ignore */
    }

    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      duration: Date.now() - startTime,
      error: (error as Error).message
    }
  }
}

// ============================================
// Package Management
// ============================================

/**
 * Install a pip package
 */
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

  const env = options.spaceId
    ? await getSpaceEnvironment(options.spaceId)
    : (await detectPython()).environment

  if (!env) {
    return { success: false, error: 'Python environment not available' }
  }

  const packageSpec = options.version ? `${packageName}==${options.version}` : packageName

  // Determine target directory
  const targetDir = env.type === 'venv' ? undefined : getGlobalPackagesDir()

  // Ensure global packages dir exists
  if (targetDir && !existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  const args = ['-m', 'pip', 'install', packageSpec, '--no-warn-script-location']
  if (targetDir) {
    args.push('--target', targetDir)
  }

  options.onProgress?.({
    phase: 'downloading',
    package: packageName,
    progress: 0,
    message: `Installing ${packageSpec}...`
  })

  return new Promise((resolve) => {
    const pipProcess = spawn(env.pythonPath, args, {
      env: process.env as Record<string, string>
    })

    // 追踪进程以便在应用关闭时清理
    trackProcess(pipProcess)

    let stderr = ''
    let lastPhase: 'downloading' | 'installing' = 'downloading'

    pipProcess.stdout.on('data', (data) => {
      const str = data.toString()
      // Parse pip output for progress
      if (str.includes('Downloading') || str.includes('Collecting')) {
        lastPhase = 'downloading'
        options.onProgress?.({
          phase: 'downloading',
          package: packageName,
          progress: 30,
          message: str.trim().split('\n')[0]
        })
      } else if (str.includes('Installing') || str.includes('Successfully installed')) {
        lastPhase = 'installing'
        options.onProgress?.({
          phase: 'installing',
          package: packageName,
          progress: 70,
          message: str.trim().split('\n')[0]
        })
      }
    })

    pipProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    pipProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        options.onProgress?.({
          phase: 'done',
          package: packageName,
          progress: 100,
          message: `Successfully installed ${packageSpec}`
        })
        resolve({ success: true })
      } else {
        options.onProgress?.({
          phase: 'error',
          package: packageName,
          progress: 0,
          message: 'Installation failed',
          error: stderr
        })
        resolve({ success: false, error: stderr })
      }
    })

    pipProcess.on('error', (error) => {
      options.onProgress?.({
        phase: 'error',
        package: packageName,
        progress: 0,
        message: 'Installation failed',
        error: error.message
      })
      resolve({ success: false, error: error.message })
    })
  })
}

/**
 * Uninstall a pip package
 */
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

  const env = options.spaceId
    ? await getSpaceEnvironment(options.spaceId)
    : (await detectPython()).environment

  if (!env) {
    return { success: false, error: 'Python environment not available' }
  }

  const args = ['-m', 'pip', 'uninstall', '-y', packageName]

  return new Promise((resolve) => {
    const pipProcess = spawn(env.pythonPath, args, {
      env: process.env as Record<string, string>
    })

    // 追踪进程以便在应用关闭时清理
    trackProcess(pipProcess)

    let stderr = ''

    pipProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    pipProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr })
      }
    })

    pipProcess.on('error', (error) => {
      resolve({ success: false, error: error.message })
    })
  })
}

/**
 * List installed packages
 */
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
    // Build environment for the command
    const processEnv: Record<string, string> = { ...process.env } as Record<string, string>

    // Add global packages to PYTHONPATH if using embedded env
    if (env.type === 'embedded') {
      const globalPackages = getGlobalPackagesDir()
      if (existsSync(globalPackages)) {
        processEnv.PYTHONPATH = globalPackages
      }
    }

    // 使用异步版本避免阻塞主进程
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

// ============================================
// Virtual Environment Management
// ============================================

/**
 * Create a virtual environment for a space
 */
export async function createSpaceVenv(
  spaceId: string,
  onProgress?: (progress: VenvCreateProgress) => void
): Promise<{ success: boolean; path?: string; error?: string }> {
  const detection = await detectPython()
  if (!detection.found || !detection.environment) {
    return { success: false, error: 'Embedded Python not available' }
  }

  const venvDir = getSpaceVenvDir(spaceId)

  // Check if already exists
  if (hasSpaceVenv(spaceId)) {
    return { success: true, path: venvDir }
  }

  // Ensure parent directory exists
  const parentDir = join(venvDir, '..')
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }

  onProgress?.({
    phase: 'creating',
    progress: 0,
    message: 'Creating virtual environment...'
  })

  return new Promise((resolve) => {
    const venvProcess = spawn(detection.environment!.pythonPath, ['-m', 'venv', venvDir], {
      env: process.env as Record<string, string>
    })

    let stderr = ''

    venvProcess.stdout.on('data', () => {
      onProgress?.({
        phase: 'creating',
        progress: 50,
        message: 'Setting up virtual environment...'
      })
    })

    venvProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    venvProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        onProgress?.({
          phase: 'done',
          progress: 100,
          message: 'Virtual environment created'
        })
        resolve({ success: true, path: venvDir })
      } else {
        onProgress?.({
          phase: 'error',
          progress: 0,
          message: 'Failed to create virtual environment',
          error: stderr
        })
        resolve({ success: false, error: stderr })
      }
    })

    venvProcess.on('error', (error) => {
      onProgress?.({
        phase: 'error',
        progress: 0,
        message: 'Failed to create virtual environment',
        error: error.message
      })
      resolve({ success: false, error: error.message })
    })
  })
}

/**
 * Delete a space's virtual environment
 */
export async function deleteSpaceVenv(
  spaceId: string
): Promise<{ success: boolean; error?: string }> {
  const venvDir = getSpaceVenvDir(spaceId)

  if (!existsSync(venvDir)) {
    return { success: true }
  }

  try {
    await rm(venvDir, { recursive: true, force: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
