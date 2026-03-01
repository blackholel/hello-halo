/**
 * Skills/Agents/Commands Watch Service
 *
 * Watches resource directories and plugin/config registries, then notifies renderer to refresh.
 */

import type { BrowserWindow } from 'electron'
import { watch, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative } from 'path'
import { getConfig, getSpacesDir } from './config.service'
import { clearPluginsCache, listEnabledPlugins } from './plugins.service'
import { clearSkillsCache, invalidateSkillsCache } from './skills.service'
import { clearAgentsCache, invalidateAgentsCache } from './agents.service'
import { clearCommandsCache, invalidateCommandsCache } from './commands.service'
import { getAllSpacePaths } from './space.service'
import { normalizePlatformPath } from '../utils/path-validation'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'
import { clearResourceExposureCache, getResourceExposureConfigPath } from './resource-exposure.service'
import { clearResourceIndexSnapshot, rebuildAllResourceIndexes, rebuildResourceIndex } from './resource-index.service'
import type { ResourceChangedPayload, ResourceKind, ResourceRefreshReason } from '../../shared/resource-access'

type WatchKind =
  | ResourceKind
  | 'spaces-root'
  | 'resource-exposure'
  | 'resource-exposure-dir'
  | 'plugins-registry-file'
  | 'plugins-registry-dir'
  | 'settings-file'
  | 'settings-dir'

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

const RESOURCE_KINDS: ResourceKind[] = ['skills', 'agents', 'commands']
const REGISTRY_FILE_NAME = 'installed_plugins.json'
const SETTINGS_FILE_NAME = 'settings.json'
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

function makeResourceIdentity(path: string, workDir?: string): string {
  return `${normalizePlatformPath(path)}::${normalizePlatformPath(workDir || '__global__')}`
}

function sendEvent(channel: string, payload: ResourceChangedPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function buildChangedPayload(
  workDir: string | null,
  reason: ResourceRefreshReason,
  resources: ResourceKind[]
): ResourceChangedPayload {
  return {
    workDir,
    reason,
    ts: new Date().toISOString(),
    resources
  }
}

function emitResourceChanged(
  kind: ResourceKind,
  workDir: string | null,
  reason: ResourceRefreshReason
): void {
  sendEvent(`${kind}:changed`, buildChangedPayload(workDir, reason, [kind]))
}

function emitAllResourceChanged(reason: ResourceRefreshReason): void {
  const payload = buildChangedPayload(null, reason, RESOURCE_KINDS)
  sendEvent('skills:changed', payload)
  sendEvent('agents:changed', payload)
  sendEvent('commands:changed', payload)
}

function rebuildIndexForScope(workDir: string | null, reason: ResourceRefreshReason): void {
  if (workDir) {
    rebuildResourceIndex(workDir, reason)
    return
  }
  rebuildAllResourceIndexes(reason)
}

function scheduleNotify(kind: ResourceKind, workDir?: string, reason: ResourceRefreshReason = 'file-change'): void {
  const scope = workDir || 'global'
  const key = `${kind}:${scope}:${reason}`
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    invalidators[kind](workDir || null)
    rebuildIndexForScope(workDir || null, reason)
    emitResourceChanged(kind, workDir || null, reason)
  }, 200))
}

function schedulePluginConfigNotify(reason: 'plugin-registry-change' | 'settings-change'): void {
  const key = `plugin-config:${reason}`
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    clearPluginsCache()
    reconcileAllResourceWatchers()
    clearResourceIndexSnapshot()
    clearSkillsCache()
    clearAgentsCache()
    clearCommandsCache()
    rebuildAllResourceIndexes(reason)
    emitAllResourceChanged(reason)
  }, 200))
}

function scheduleExposureNotify(): void {
  const key = 'resource-exposure:global'
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    clearResourceExposureCache()
    clearResourceIndexSnapshot()
    clearSkillsCache()
    clearAgentsCache()
    clearCommandsCache()
    rebuildAllResourceIndexes('resource-exposure-change')
    emitAllResourceChanged('resource-exposure-change')
  }, 200))
}

function parseChangedName(filename: string | Buffer | null | undefined): string | undefined {
  if (typeof filename === 'string') return basename(filename)
  if (Buffer.isBuffer(filename)) return basename(filename.toString('utf-8'))
  return undefined
}

function createWatcher(kind: WatchKind, path: string, workDir?: string, opts?: { isRoot?: boolean }): void {
  const key = makeKey(kind, path)
  if (watchers.has(key) || !existsSync(path)) return

  const supportsRecursive = process.platform !== 'linux'

  try {
    const watcher = watch(path, { recursive: supportsRecursive }, (_eventType, filename) => {
      const changedName = parseChangedName(filename)

      if (kind === 'spaces-root') {
        reconcileAllResourceWatchers()
        return
      }

      if (kind === 'resource-exposure' || kind === 'resource-exposure-dir') {
        scheduleExposureNotify()
        return
      }

      if (kind === 'plugins-registry-file') {
        schedulePluginConfigNotify('plugin-registry-change')
        return
      }
      if (kind === 'plugins-registry-dir') {
        if (changedName && changedName !== REGISTRY_FILE_NAME) return
        schedulePluginConfigNotify('plugin-registry-change')
        return
      }

      if (kind === 'settings-file') {
        schedulePluginConfigNotify('settings-change')
        return
      }
      if (kind === 'settings-dir') {
        if (changedName && changedName !== SETTINGS_FILE_NAME) return
        schedulePluginConfigNotify('settings-change')
        return
      }

      scheduleNotify(kind as ResourceKind, workDir, 'file-change')
      if (!supportsRecursive && kind === 'skills') {
        patchSubdirWatchers(kind as ResourceKind, path, workDir)
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

function stopResourceWatcherTree(kind: ResourceKind, rootPath: string): void {
  for (const [key, entry] of Array.from(watchers.entries())) {
    if (entry.kind !== kind) continue
    if (entry.path === rootPath || isChildPath(rootPath, entry.path)) {
      stopWatcher(key)
    }
  }
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

function patchSubdirWatchers(kind: ResourceKind, dirPath: string, workDir?: string): void {
  const normalizedDir = normalizePlatformPath(dirPath)

  // Remove watchers for deleted subdirectories
  for (const [key, entry] of Array.from(watchers.entries())) {
    if (entry.kind !== kind) continue
    if (entry.isRoot) continue
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
        const subWatcher = watch(subPath, () => scheduleNotify(kind, workDir, 'file-change'))
        watchers.set(subKey, { kind, path: subPath, watcher: subWatcher, workDir, isRoot: false })
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
}

function reconcileResourceWatchers(kind: ResourceKind): void {
  const desiredDirs = getResourceDirs(kind)
  const desiredByIdentity = new Map<string, DirEntry>()
  for (const dir of desiredDirs) {
    desiredByIdentity.set(makeResourceIdentity(dir.path, dir.workDir), dir)
  }

  const existingRoots: Array<{ key: string; entry: WatchEntry; identity: string }> = []
  for (const [key, entry] of watchers.entries()) {
    if (entry.kind !== kind || !entry.isRoot) continue
    existingRoots.push({
      key,
      entry,
      identity: makeResourceIdentity(entry.path, entry.workDir)
    })
  }

  for (const existing of existingRoots) {
    if (desiredByIdentity.has(existing.identity)) continue
    stopResourceWatcherTree(kind, existing.entry.path)
  }

  const existingIdentitySet = new Set(existingRoots.map((item) => item.identity))
  for (const [identity, dir] of desiredByIdentity.entries()) {
    if (existingIdentitySet.has(identity)) continue
    createWatcher(kind, dir.path, dir.workDir, { isRoot: true })
  }
}

function reconcileAllResourceWatchers(): void {
  for (const kind of RESOURCE_KINDS) {
    reconcileResourceWatchers(kind)
  }
}

function startLinuxRescan(): void {
  if (process.platform !== 'linux' || linuxRescanTimer) return
  linuxRescanTimer = setInterval(() => {
    for (const entry of watchers.values()) {
      if (entry.kind === 'skills' && entry.isRoot) {
        patchSubdirWatchers('skills', entry.path, entry.workDir)
      }
    }
  }, LINUX_RESCAN_INTERVAL)
}

function initPluginConfigWatchers(): void {
  const userRoot = getLockedUserConfigRootDir()
  const pluginsDir = join(userRoot, 'plugins')
  const installedPluginsPath = join(pluginsDir, REGISTRY_FILE_NAME)
  const settingsPath = join(userRoot, SETTINGS_FILE_NAME)

  if (!existsSync(userRoot)) mkdirSync(userRoot, { recursive: true })
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true })

  createWatcher('plugins-registry-dir', pluginsDir)
  createWatcher('plugins-registry-file', installedPluginsPath)
  createWatcher('settings-dir', userRoot)
  createWatcher('settings-file', settingsPath)
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

  initPluginConfigWatchers()
  reconcileAllResourceWatchers()
  rebuildAllResourceIndexes('manual-refresh')
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
