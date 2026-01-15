/**
 * Python Service Input Validation
 *
 * 提供包名、spaceId、版本号等输入的验证函数
 */

import { join, resolve, sep } from 'path'

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

  if (!VALID_VERSION_REGEX.test(trimmed)) {
    return { valid: false, error: '版本号格式无效' }
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

  const normalizedCwd = resolve(cwd)

  // 检查是否在允许的基础路径内
  const isAllowed = allowedBasePaths.some(basePath => {
    const normalizedBase = resolve(basePath)
    return normalizedCwd.startsWith(normalizedBase + sep) || normalizedCwd === normalizedBase
  })

  if (!isAllowed) {
    return { valid: false, error: '工作目录不在允许的范围内' }
  }

  return { valid: true }
}
