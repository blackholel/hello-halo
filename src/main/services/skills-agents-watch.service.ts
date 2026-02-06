/**
 * Skills/Agents Watch Service
 *
 * Watches skill and agent directories for changes and notifies renderer to refresh.
 */

import type { BrowserWindow } from 'electron'
import { watch, existsSync } from 'fs'
import { join } from 'path'
import { getConfig, getHaloDir, getSpacesDir } from './config.service'
import { listEnabledPlugins } from './plugins.service'
import { invalidateSkillsCache } from './skills.service'
import { invalidateAgentsCache } from './agents.service'
import { getAllSpacePaths } from './space.service'

type WatchKind = 'skills' | 'agents' | 'spaces-root'

interface WatchEntry {
  kind: WatchKind
  path: string
  watcher: ReturnType<typeof watch>
  workDir?: string
}

const watchers = new Map<string, WatchEntry>()
const debounceTimers = new Map<string, NodeJS.Timeout>()
let mainWindow: BrowserWindow | null = null

function makeKey(kind: WatchKind, path: string): string {
  return `${kind}:${path}`
}

function sendEvent(channel: 'skills:changed' | 'agents:changed', payload: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function scheduleNotify(kind: 'skills' | 'agents', workDir?: string): void {
  const key = `${kind}:${workDir || 'global'}`
  const timer = debounceTimers.get(key)
  if (timer) {
    clearTimeout(timer)
  }
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    if (kind === 'skills') {
      invalidateSkillsCache(workDir || null)
      sendEvent('skills:changed', { workDir: workDir || null })
    } else {
      invalidateAgentsCache(workDir || null)
      sendEvent('agents:changed', { workDir: workDir || null })
    }
  }, 200))
}

function createWatcher(kind: WatchKind, path: string, workDir?: string): void {
  const key = makeKey(kind, path)
  if (watchers.has(key)) return
  if (!existsSync(path)) return

  try {
    const watcher = watch(path, { recursive: true }, () => {
      if (kind === 'skills' || kind === 'agents') {
        scheduleNotify(kind, workDir)
      } else if (kind === 'spaces-root') {
        refreshSpaceWatchers()
      }
    })
    watchers.set(key, { kind, path, watcher, workDir })
  } catch (error) {
    console.warn(`[Watch] Failed to watch ${path}:`, error)
  }
}

function stopWatcher(key: string): void {
  const entry = watchers.get(key)
  if (!entry) return
  try {
    entry.watcher.close()
  } catch {
    // ignore
  }
  watchers.delete(key)
}

function resolveGlobalPath(globalPath: string): string {
  return globalPath.startsWith('/')
    ? globalPath
    : join(require('os').homedir(), globalPath)
}

function getSkillDirs(): Array<{ path: string; workDir?: string }> {
  const dirs: Array<{ path: string; workDir?: string }> = []
  const haloDir = getHaloDir()
  if (haloDir) {
    dirs.push({ path: join(haloDir, 'skills') })
  }

  const config = getConfig()
  const globalPaths = config.claudeCode?.plugins?.globalPaths || []
  for (const globalPath of globalPaths) {
    const resolvedPath = resolveGlobalPath(globalPath)
    const skillsSubdir = join(resolvedPath, 'skills')
    dirs.push({ path: skillsSubdir })
  }

  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    dirs.push({ path: join(plugin.installPath, 'skills') })
  }

  const spaces = getAllSpacePaths()
  for (const spacePath of spaces) {
    dirs.push({ path: join(spacePath, '.claude', 'skills'), workDir: spacePath })
  }

  return dirs
}

function getAgentDirs(): Array<{ path: string; workDir?: string }> {
  const dirs: Array<{ path: string; workDir?: string }> = []
  const haloDir = getHaloDir()
  if (haloDir) {
    dirs.push({ path: join(haloDir, 'agents') })
  }

  const config = getConfig()
  const globalPaths = config.claudeCode?.agents?.paths || []
  for (const globalPath of globalPaths) {
    const resolvedPath = resolveGlobalPath(globalPath)
    dirs.push({ path: resolvedPath })
  }

  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    dirs.push({ path: join(plugin.installPath, 'agents') })
  }

  const spaces = getAllSpacePaths()
  for (const spacePath of spaces) {
    dirs.push({ path: join(spacePath, '.claude', 'agents'), workDir: spacePath })
  }

  return dirs
}

function refreshSpaceWatchers(): void {
  const currentSpaceDirs = new Set(getAllSpacePaths().map((p) => p))

  // Remove watchers for deleted spaces
  for (const [key, entry] of watchers.entries()) {
    if (entry.kind === 'skills' || entry.kind === 'agents') {
      if (entry.workDir && !currentSpaceDirs.has(entry.workDir)) {
        stopWatcher(key)
      }
    }
  }

  // Add watchers for new spaces
  for (const spacePath of currentSpaceDirs) {
    createWatcher('skills', join(spacePath, '.claude', 'skills'), spacePath)
    createWatcher('agents', join(spacePath, '.claude', 'agents'), spacePath)
  }
}

export function initSkillAgentWatchers(window: BrowserWindow): void {
  mainWindow = window

  // Watch spaces root for new/deleted spaces
  createWatcher('spaces-root', getSpacesDir())

  // Initialize skill watchers
  for (const dir of getSkillDirs()) {
    createWatcher('skills', dir.path, dir.workDir)
  }

  // Initialize agent watchers
  for (const dir of getAgentDirs()) {
    createWatcher('agents', dir.path, dir.workDir)
  }
}

export function cleanupSkillAgentWatchers(): void {
  for (const key of watchers.keys()) {
    stopWatcher(key)
  }
  watchers.clear()
  debounceTimers.forEach((timer) => clearTimeout(timer))
  debounceTimers.clear()
  mainWindow = null
}
