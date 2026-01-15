/**
 * Shared Python Types
 *
 * Common type definitions for Python environment management
 * used by both main process and renderer process.
 */

// ============================================
// Environment Types
// ============================================

export interface PythonEnvironment {
  type: 'embedded' | 'venv'
  pythonPath: string
  pipPath: string
  version: string
  sitePackages: string
}

export interface PythonDetectionResult {
  found: boolean
  environment: PythonEnvironment | null
  error?: string
}

// ============================================
// Package Types
// ============================================

export interface PackageInfo {
  name: string
  version: string
}

// ============================================
// Execution Types
// ============================================

export interface ExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  duration: number
  error?: string
}

// Alias for backward compatibility with python.service.ts
export type PythonExecutionResult = ExecutionResult

// ============================================
// Progress Types
// ============================================

export interface PipInstallProgress {
  phase: 'downloading' | 'installing' | 'done' | 'error'
  package: string
  progress: number
  message: string
  error?: string
}

export interface VenvCreateProgress {
  phase: 'creating' | 'configuring' | 'done' | 'error'
  progress: number
  message: string
  error?: string
}
