/**
 * Skills/Agents/Commands Watch Service
 *
 * Watches skill, agent, and command directories for changes and notifies renderer to refresh.
 */

import type { BrowserWindow } from 'electron'
import { watch, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative, isAbsolute } from 'path'
import { getConfig, getSpacesDir } from './config.service'
import { listEnabledPlugins } from './plugins.service'
import { clearSkillsCache, invalidateSkillsCache } from './skills.service'
import { clearAgentsCache, invalidateAgentsCache } from './agents.service'
import { clearCommandsCache, invalidateCommandsCache } from './commands.service'
import { getAllSpacePaths } from './space.service'
import { normalizePlatformPath } from '../utils/path-validation'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'
import { clearResourceExposureCache, getResourceExposureConfigPath } from './resource-exposure.service'

type WatchKind = 'skills' | 'agents' | 'commands' | 'spaces-root' | 'resource-exposure' | 'resource-exposure-dir'
type ResourceKind = 'skills' | 'agents' | 'commands'

interface WatchEntry {
  kind: WatchKind
  path: string
  watcher: ReturnType<typeof watch>
  workDir?: string
  isRoot?: boolean
}

interface DirEntry {
  path: string
  workDir?: string
}

const watchers = new Map<string, WatchEntry>()
const debounceTimers = new Map<string, NodeJS.Timeout>()
let mainWindow: BrowserWindow | null = null
let linuxRescanTimer: NodeJS.Timeout | null = null
const LINUX_RESCAN_INTERVAL = 60_000

const invalidators: Record<ResourceKind, (workDir?: string | null) => void> = {
  skills: invalidateSkillsCache,
  agents: invalidateAgentsCache,
  commands: invalidateCommandsCache
}

function makeKey(kind: WatchKind, path: string): string {
  return `${kind}:${normalizePlatformPath(path)}`
}

function sendEvent(channel: string, payload: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function scheduleNotify(kind: ResourceKind, workDir?: string): void {
  const key = `${kind}:${workDir || 'global'}`
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    invalidators[kind](workDir || null)
    sendEvent(`${kind}:changed`, { workDir: workDir || null })
  }, 200))
}

function scheduleExposureNotify(): void {
  const key = 'resource-exposure:global'
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    clearResourceExposureCache()
    clearSkillsCache()
    clearAgentsCache()
    clearCommandsCache()
    sendEvent('skills:changed', { workDir: null })
    sendEvent('agents:changed', { workDir: null })
    sendEvent('commands:changed', { workDir: null })
  }, 200))
}

function createWatcher(kind: WatchKind, path: string, workDir?: string, opts?: { isRoot?: boolean }): void {
  const key = makeKey(kind, path)
  if (watchers.has(key) || !existsSync(path)) return

  const supportsRecursive = process.platform !== 'linux'

  try {
    const watcher = watch(path, { recursive: supportsRecursive }, () => {
      if (kind === 'spaces-root') {
        refreshSpaceWatchers()
      } else if (kind === 'resource-exposure' || kind === 'resource-exposure-dir') {
        scheduleExposureNotify()
      } else {
        scheduleNotify(kind, workDir)
        if (!supportsRecursive && kind === 'skills') {
          patchSubdirWatchers(kind, path, workDir)
        }
      }
    })
    watchers.set(key, { kind, path, watcher, workDir, isRoot: opts?.isRoot ?? false })

    if (!supportsRecursive && kind === 'skills') {
      patchSubdirWatchers(kind, path, workDir)
    }
  } catch (error) {
    console.warn(`[Watch] Failed to watch ${path}:`, error)
  }
}

function stopWatcher(key: string): void {
  const entry = watchers.get(key)
  if (!entry) return
  try { entry.watcher.close() } catch { /* ignore */ }
  watchers.delete(key)
}

function resolveGlobalPath(globalPath: string): string {
  return globalPath.startsWith('/')
    ? globalPath
    : join(require('os').homedir(), globalPath)
}

/**
 * Collect directories to watch for a given resource kind.
 */
function getResourceDirs(kind: ResourceKind): DirEntry[] {
  const dirs: DirEntry[] = []
  const sourceMode = getLockedConfigSourceMode()
  const userRoot = getLockedUserConfigRootDir()
  const config = getConfig()

  // App-level directory
  dirs.push({ path: join(userRoot, kind) })

  // Kite mode only: config-driven global paths
  if (sourceMode === 'kite') {
    if (kind === 'skills') {
      for (const p of config.claudeCode?.plugins?.globalPaths || []) {
        dirs.push({ path: join(resolveGlobalPath(p), 'skills') })
      }
    } else if (kind === 'agents') {
      for (const p of config.claudeCode?.agents?.paths || []) {
        dirs.push({ path: resolveGlobalPath(p) })
      }
    }
  }

  // Plugin directories
  for (const plugin of listEnabledPlugins()) {
    dirs.push({ path: join(plugin.installPath, kind) })
  }

  // Space directories
  for (const spacePath of getAllSpacePaths()) {
    dirs.push({ path: join(spacePath, '.claude', kind), workDir: spacePath })
  }

  return dirs
}

function isChildPath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function patchSubdirWatchers(kind: WatchKind, dirPath: string, workDir?: string): void {
  const normalizedDir = normalizePlatformPath(dirPath)

  // Remove watchers for deleted subdirectories
  for (const [key, entry] of Array.from(watchers.entries())) {
    if (entry.kind !== kind) continue
    const normalizedEntry = normalizePlatformPath(entry.path)
    if (normalizedEntry === normalizedDir) continue
    if (isChildPath(normalizedDir, normalizedEntry) && !existsSync(entry.path)) {
      stopWatcher(key)
    }
  }

  // Add watchers for new subdirectories
  try {
    for (const name of readdirSync(dirPath)) {
      const subPath = join(dirPath, name)
      const subKey = makeKey(kind, subPath)
      if (watchers.has(subKey)) continue
      try {
        if (!statSync(subPath).isDirectory()) continue
        const subWatcher = watch(subPath, () => scheduleNotify(kind as ResourceKind, workDir))
        watchers.set(subKey, { kind, path: subPath, watcher: subWatcher, workDir, isRoot: false })
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

function startLinuxRescan(): void {
  if (process.platform !== 'linux' || linuxRescanTimer) return
  linuxRescanTimer = setInterval(() => {
    for (const entry of watchers.values()) {
      if (entry.kind === 'skills' && entry.isRoot) {
        patchSubdirWatchers(entry.kind, entry.path, entry.workDir)
      }
    }
  }, LINUX_RESCAN_INTERVAL)
}

function refreshSpaceWatchers(): void {
  const currentSpaces = new Set(getAllSpacePaths())

  // Remove watchers for deleted spaces
  for (const [key, entry] of watchers.entries()) {
    if (entry.workDir && !currentSpaces.has(entry.workDir)) {
      stopWatcher(key)
    }
  }

  // Add watchers for new spaces
  for (const spacePath of currentSpaces) {
    createWatcher('skills', join(spacePath, '.claude', 'skills'), spacePath, { isRoot: true })
    createWatcher('agents', join(spacePath, '.claude', 'agents'), spacePath)
    createWatcher('commands', join(spacePath, '.claude', 'commands'), spacePath)
  }
}

export function initSkillAgentWatchers(window: BrowserWindow): void {
  mainWindow = window
  createWatcher('spaces-root', getSpacesDir())
  const exposurePath = getResourceExposureConfigPath()
  const exposureDir = dirname(exposurePath)
  if (!existsSync(exposureDir)) {
    mkdirSync(exposureDir, { recursive: true })
  }
  createWatcher('resource-exposure', exposurePath)
  createWatcher('resource-exposure-dir', exposureDir)

  const kinds: ResourceKind[] = ['skills', 'agents', 'commands']
  for (const kind of kinds) {
    for (const dir of getResourceDirs(kind)) {
      createWatcher(kind, dir.path, dir.workDir, kind === 'skills' ? { isRoot: true } : undefined)
    }
  }

  startLinuxRescan()
}

export function cleanupSkillAgentWatchers(): void {
  if (linuxRescanTimer) {
    clearInterval(linuxRescanTimer)
    linuxRescanTimer = null
  }
  for (const key of watchers.keys()) stopWatcher(key)
  watchers.clear()
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  mainWindow = null
}

// Test helper: expose resolved watch directories without creating filesystem watchers
export function _testGetResourceDirs(kind: ResourceKind): Array<{ path: string; workDir?: string }> {
  return getResourceDirs(kind)
}
