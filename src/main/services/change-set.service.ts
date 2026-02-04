/**
 * Change Set Service
 *
 * Tracks file changes during a single AI response and provides
 * real rollback capabilities using local snapshots.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join, resolve, relative } from 'path'
import { createHash } from 'crypto'
import { getSpace } from './space.service'

const CHANGE_SET_LIMIT = 3

export type ChangeFileType = 'edit' | 'create' | 'delete'
export type ChangeFileStatus = 'accepted' | 'rolled_back'
export type ChangeSetStatus = 'applied' | 'partial_rollback' | 'rolled_back'

export interface ChangeFile {
  id: string
  path: string
  relativePath: string
  fileName: string
  type: ChangeFileType
  status: ChangeFileStatus
  beforeExists: boolean
  afterExists: boolean
  beforeContent?: string
  afterContent?: string
  beforeHash?: string
  afterHash?: string
  stats: { added: number; removed: number }
}

export interface ChangeSet {
  id: string
  spaceId: string
  conversationId: string
  messageId?: string
  createdAt: string
  status: ChangeSetStatus
  summary: { totalFiles: number; totalAdded: number; totalRemoved: number }
  files: ChangeFile[]
}

interface PendingChangeFile {
  id: string
  absPath: string
  relativePath: string
  fileName: string
  beforeExists: boolean
  beforeContent?: string
  beforeHash?: string
}

interface PendingChangeSet {
  id: string
  spaceId: string
  conversationId: string
  workDir: string
  createdAt: string
  files: Map<string, PendingChangeFile>
}

const pendingChangeSets = new Map<string, PendingChangeSet>()

function getChangeSetsDir(spaceId: string): string {
  const space = getSpace(spaceId)
  if (!space) {
    throw new Error(`Space not found: ${spaceId}`)
  }
  return join(space.path, '.halo', 'change-sets')
}

function getChangeSetsFile(spaceId: string, conversationId: string): string {
  return join(getChangeSetsDir(spaceId), `${conversationId}.json`)
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function getFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function calculateDiffStats(oldStr: string, newStr: string): { added: number; removed: number } {
  const oldLines = oldStr ? oldStr.split('\n') : []
  const newLines = newStr ? newStr.split('\n') : []
  const changedLines = countChangedLines(oldStr, newStr)

  const added = Math.max(0, newLines.length - oldLines.length + changedLines)
  const removed = Math.max(0, oldLines.length - newLines.length + changedLines)

  return {
    added: Math.max(1, Math.ceil(added / 2)),
    removed: Math.max(oldStr ? 1 : 0, Math.ceil(removed / 2))
  }
}

function countChangedLines(oldStr: string, newStr: string): number {
  if (!oldStr || !newStr) return 0
  const oldLines = new Set(oldStr.split('\n').map(l => l.trim()).filter(Boolean))
  const newLines = new Set(newStr.split('\n').map(l => l.trim()).filter(Boolean))

  let changes = 0
  for (const line of newLines) {
    if (!oldLines.has(line)) changes++
  }
  return changes
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch (error) {
    console.warn(`[ChangeSet] Failed to read file: ${path}`, error)
    return null
  }
}

function resolveFilePath(workDir: string, filePath: string): string | null {
  if (!filePath) return null
  const resolved = resolve(workDir, filePath)
  const sep = require('path').sep
  if (!resolved.startsWith(workDir + sep) && resolved !== workDir) {
    console.warn(`[ChangeSet] Skipping path outside workDir: ${filePath}`)
    return null
  }
  return resolved
}

export function beginChangeSet(spaceId: string, conversationId: string, workDir: string): string {
  const id = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  pendingChangeSets.set(conversationId, {
    id,
    spaceId,
    conversationId,
    workDir,
    createdAt: new Date().toISOString(),
    files: new Map()
  })
  return id
}

export function clearPendingChangeSet(conversationId: string): void {
  pendingChangeSets.delete(conversationId)
}

export function trackChangeFile(conversationId: string, filePath?: string): void {
  if (!filePath) return
  const pending = pendingChangeSets.get(conversationId)
  if (!pending) return

  const resolved = resolveFilePath(pending.workDir, filePath)
  if (!resolved) return

  if (pending.files.has(resolved)) return

  const beforeExists = existsSync(resolved)
  const beforeContent = beforeExists ? readTextFile(resolved) ?? '' : ''

  pending.files.set(resolved, {
    id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    absPath: resolved,
    relativePath: relative(pending.workDir, resolved),
    fileName: getFileName(resolved),
    beforeExists,
    beforeContent: beforeExists ? beforeContent : undefined,
    beforeHash: beforeExists ? hashContent(beforeContent) : undefined
  })
}

export function finalizeChangeSet(
  spaceId: string,
  conversationId: string,
  messageId?: string
): ChangeSet | null {
  const pending = pendingChangeSets.get(conversationId)
  if (!pending) return null

  const files: ChangeFile[] = []
  let totalAdded = 0
  let totalRemoved = 0

  for (const pendingFile of pending.files.values()) {
    const afterExists = existsSync(pendingFile.absPath)
    const afterContent = afterExists ? readTextFile(pendingFile.absPath) ?? '' : ''
    const afterHash = afterExists ? hashContent(afterContent) : undefined

    if (!pendingFile.beforeExists && !afterExists) {
      continue
    }

    if (pendingFile.beforeExists && afterExists && pendingFile.beforeHash === afterHash) {
      continue
    }

    let type: ChangeFileType = 'edit'
    if (!pendingFile.beforeExists && afterExists) {
      type = 'create'
    } else if (pendingFile.beforeExists && !afterExists) {
      type = 'delete'
    }

    const stats = type === 'create'
      ? { added: (afterContent || '').split('\n').length, removed: 0 }
      : type === 'delete'
        ? { added: 0, removed: (pendingFile.beforeContent || '').split('\n').length }
        : calculateDiffStats(pendingFile.beforeContent || '', afterContent || '')

    totalAdded += stats.added
    totalRemoved += stats.removed

    files.push({
      id: pendingFile.id,
      path: pendingFile.absPath,
      relativePath: pendingFile.relativePath,
      fileName: pendingFile.fileName,
      type,
      status: 'accepted',
      beforeExists: pendingFile.beforeExists,
      afterExists,
      beforeContent: pendingFile.beforeContent,
      afterContent: afterExists ? afterContent : undefined,
      beforeHash: pendingFile.beforeHash,
      afterHash,
      stats
    })
  }

  clearPendingChangeSet(conversationId)

  if (files.length === 0) {
    return null
  }

  const changeSet: ChangeSet = {
    id: pending.id,
    spaceId,
    conversationId,
    messageId,
    createdAt: pending.createdAt,
    status: 'applied',
    summary: {
      totalFiles: files.length,
      totalAdded,
      totalRemoved
    },
    files
  }

  const existing = listChangeSets(spaceId, conversationId)
  const next = [changeSet, ...existing].slice(0, CHANGE_SET_LIMIT)
  saveChangeSets(spaceId, conversationId, next)

  return changeSet
}

export function listChangeSets(spaceId: string, conversationId: string): ChangeSet[] {
  const filePath = getChangeSetsFile(spaceId, conversationId)
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('[ChangeSet] Failed to read change sets:', error)
    return []
  }
}

function saveChangeSets(spaceId: string, conversationId: string, changeSets: ChangeSet[]): void {
  const dir = getChangeSetsDir(spaceId)
  ensureDir(dir)
  const filePath = getChangeSetsFile(spaceId, conversationId)
  writeFileSync(filePath, JSON.stringify(changeSets, null, 2), 'utf-8')
}

function updateChangeSet(
  spaceId: string,
  conversationId: string,
  changeSetId: string,
  updater: (changeSet: ChangeSet) => ChangeSet
): ChangeSet | null {
  const changeSets = listChangeSets(spaceId, conversationId)
  const index = changeSets.findIndex(cs => cs.id === changeSetId)
  if (index < 0) return null

  const updated = updater(changeSets[index])
  changeSets[index] = updated
  saveChangeSets(spaceId, conversationId, changeSets)
  return updated
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function computeChangeSetStatus(changeSet: ChangeSet): ChangeSetStatus {
  const rolledBackCount = changeSet.files.filter(f => f.status === 'rolled_back').length
  if (rolledBackCount === 0) return 'applied'
  if (rolledBackCount === changeSet.files.length) return 'rolled_back'
  return 'partial_rollback'
}

export function acceptChangeSet(
  spaceId: string,
  conversationId: string,
  changeSetId: string,
  filePath?: string
): ChangeSet | null {
  return updateChangeSet(spaceId, conversationId, changeSetId, (changeSet) => {
    const files = changeSet.files.map(file => {
      if (!filePath || file.path === filePath) {
        if (file.status === 'rolled_back') {
          return file
        }
        return { ...file, status: 'accepted' }
      }
      return file
    })
    const updated = { ...changeSet, files }
    return { ...updated, status: computeChangeSetStatus(updated) }
  })
}

export function rollbackChangeSet(
  spaceId: string,
  conversationId: string,
  changeSetId: string,
  options: { filePath?: string; force?: boolean }
): { changeSet: ChangeSet | null; conflicts: string[] } {
  const { filePath, force = false } = options
  const changeSets = listChangeSets(spaceId, conversationId)
  const changeSet = changeSets.find(cs => cs.id === changeSetId)
  if (!changeSet) return { changeSet: null, conflicts: [] }

  const targets = changeSet.files.filter(file => !filePath || file.path === filePath)

  const conflicts: string[] = []
  for (const file of targets) {
    if (file.status === 'rolled_back') continue
    const existsNow = existsSync(file.path)
    if (file.afterExists) {
      const currentContent = existsNow ? readTextFile(file.path) ?? '' : ''
      const currentHash = existsNow ? hashContent(currentContent) : undefined
      if (!force && currentHash !== file.afterHash) {
        conflicts.push(file.path)
      }
    } else if (!force && existsNow) {
      conflicts.push(file.path)
    }
  }

  if (conflicts.length > 0 && !force) {
    return { changeSet, conflicts }
  }

  const updatedFiles = changeSet.files.map(file => {
    if (file.status === 'rolled_back') return file
    if (filePath && file.path !== filePath) return file

    if (file.type === 'create') {
      if (existsSync(file.path)) {
        unlinkSync(file.path)
      }
    } else if (file.type === 'delete') {
      if (file.beforeContent !== undefined) {
        ensureParentDir(file.path)
        writeFileSync(file.path, file.beforeContent, 'utf-8')
      }
    } else {
      ensureParentDir(file.path)
      writeFileSync(file.path, file.beforeContent || '', 'utf-8')
    }

    return { ...file, status: 'rolled_back' }
  })

  const updatedSet: ChangeSet = {
    ...changeSet,
    files: updatedFiles
  }
  updatedSet.status = computeChangeSetStatus(updatedSet)

  const index = changeSets.findIndex(cs => cs.id === changeSetId)
  changeSets[index] = updatedSet
  saveChangeSets(spaceId, conversationId, changeSets)

  return { changeSet: updatedSet, conflicts: [] }
}
