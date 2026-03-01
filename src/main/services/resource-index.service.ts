import { createHash } from 'crypto'
import { statSync } from 'fs'
import { getAllSpacePaths } from './space.service'
import { listSkills } from './skills.service'
import { listAgents } from './agents.service'
import { listCommands } from './commands.service'
import type { ResourceIndexSnapshot, ResourceRefreshReason } from '../../shared/resource-access'

const GLOBAL_INDEX_KEY = '__global__'
const DEFAULT_REASON: ResourceRefreshReason = 'manual-refresh'
const snapshots = new Map<string, ResourceIndexSnapshot>()

function toIndexKey(workDir?: string): string {
  return workDir || GLOBAL_INDEX_KEY
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function buildHash(entries: string[]): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((a, b) => a.localeCompare(b))) {
    hash.update(entry)
    hash.update('\n')
  }
  return hash.digest('hex')
}

export function rebuildResourceIndex(
  workDir?: string,
  reason: ResourceRefreshReason = DEFAULT_REASON
): ResourceIndexSnapshot {
  const skills = listSkills(workDir, 'taxonomy-admin')
  const agents = listAgents(workDir, 'taxonomy-admin')
  const commands = listCommands(workDir, 'taxonomy-admin')

  const entries: string[] = [
    ...skills.map((item) => `skill:${item.source}:${item.namespace || ''}:${item.name}:${item.path}:${safeMtime(item.path)}`),
    ...agents.map((item) => `agent:${item.source}:${item.namespace || ''}:${item.name}:${item.path}:${safeMtime(item.path)}`),
    ...commands.map((item) => `command:${item.source}:${item.namespace || ''}:${item.name}:${item.path}:${safeMtime(item.path)}`)
  ]

  const snapshot: ResourceIndexSnapshot = {
    hash: buildHash(entries),
    generatedAt: new Date().toISOString(),
    reason,
    counts: {
      skills: skills.length,
      agents: agents.length,
      commands: commands.length
    }
  }

  snapshots.set(toIndexKey(workDir), snapshot)
  return snapshot
}

export function rebuildAllResourceIndexes(reason: ResourceRefreshReason = DEFAULT_REASON): void {
  rebuildResourceIndex(undefined, reason)
  for (const workDir of getAllSpacePaths()) {
    rebuildResourceIndex(workDir, reason)
  }
}

export function getResourceIndexSnapshot(workDir?: string): ResourceIndexSnapshot {
  const key = toIndexKey(workDir)
  const cached = snapshots.get(key)
  if (cached) return cached
  return rebuildResourceIndex(workDir, DEFAULT_REASON)
}

export function getResourceIndexHash(workDir?: string): string {
  return getResourceIndexSnapshot(workDir).hash
}

export function clearResourceIndexSnapshot(workDir?: string | null): void {
  if (workDir === null || workDir === undefined) {
    snapshots.clear()
    return
  }
  snapshots.delete(toIndexKey(workDir))
}

