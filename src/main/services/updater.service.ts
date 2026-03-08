/**
 * Kite Auto-Updater Service
 * Strategy:
 * - Auto check enabled by default
 * - Notify only, no auto download / auto install
 * - GitHub preferred, fallback to local update manifest (Baidu links)
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import electronUpdater from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { getConfig, saveConfig } from './config.service'

const { autoUpdater } = electronUpdater
type UpdateInfo = electronUpdater.UpdateInfo

type DownloadSource = 'github' | 'baidu'

type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'manual-download'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version: string | null
  latestVersion: string | null
  checkTime: string | null
  message?: string
  percent?: number
  releaseDate?: string
  releaseNotes?: string | { version: string; note: string }[]
  downloadSource: DownloadSource | null
  downloadUrl: string | null
  baiduExtractCode: string | null
  lastDismissedVersion: string | null
}

interface UpdateSettings {
  checkOnStartup: boolean
  lastCheckAt: string | null
  latestKnownVersion: string | null
  lastDismissedVersion: string | null
}

interface PlatformReleaseEntry {
  github?: string
  baidu?: {
    url: string
    extractCode?: string
  }
}

interface ReleaseEntry {
  notes?: string
  publishedAt?: string
  platforms?: Record<string, PlatformReleaseEntry>
}

interface UpdateManifest {
  schemaVersion: number
  latestVersion: string
  releases: Record<string, ReleaseEntry>
}

interface DownloadInfo {
  source: DownloadSource
  url: string
  baiduExtractCode?: string
}

const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  checkOnStartup: true,
  lastCheckAt: null,
  latestKnownVersion: null,
  lastDismissedVersion: null
}

const GITHUB_OWNER = 'blackholel'
const GITHUB_REPO = 'buddykite'
const GITHUB_LATEST_RELEASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const GITHUB_RELEASE_TAG_URL = (version: string) =>
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${version}`

// Configure updater behavior: notify-only strategy
autoUpdater.logger = console
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// Disable code signing verification for ad-hoc signed apps on macOS
if (process.platform === 'darwin') {
  autoUpdater.forceDevUpdateConfig = true
}

let mainWindow: BrowserWindow | null = null
let updaterEventsBound = false
let fallbackTriggeredForCurrentCheck = false

let updaterState: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  latestVersion: null,
  checkTime: null,
  downloadSource: null,
  downloadUrl: null,
  baiduExtractCode: null,
  lastDismissedVersion: null
}

function getUpdateSettings(): UpdateSettings {
  const config = getConfig()
  const update = config.system?.update
  return {
    ...DEFAULT_UPDATE_SETTINGS,
    ...(update || {})
  }
}

function persistUpdateSettings(updates: Partial<UpdateSettings>): UpdateSettings {
  const config = getConfig()
  const mergedUpdate = {
    ...getUpdateSettings(),
    ...updates
  }
  saveConfig({
    system: {
      ...config.system,
      update: mergedUpdate
    }
  })
  return mergedUpdate
}

function hydrateStateFromConfig(): void {
  const settings = getUpdateSettings()
  updaterState = {
    ...updaterState,
    checkTime: settings.lastCheckAt,
    latestVersion: settings.latestKnownVersion,
    lastDismissedVersion: settings.lastDismissedVersion
  }
}

function getCurrentVersion(): string {
  return app.getVersion()
}

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function parseVersionParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const matched = part.match(/\d+/)
      return matched ? Number.parseInt(matched[0], 10) : 0
    })
}

function compareSemver(a: string, b: string): number {
  const left = parseVersionParts(a)
  const right = parseVersionParts(b)
  const maxLen = Math.max(left.length, right.length)
  for (let i = 0; i < maxLen; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0)
    if (delta !== 0) return delta > 0 ? 1 : -1
  }
  return 0
}

function sendUpdateStatus(
  status: UpdaterStatus,
  data?: Partial<UpdaterState>
): void {
  updaterState = {
    ...updaterState,
    ...data,
    status,
    currentVersion: getCurrentVersion()
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', updaterState)
  }
}

function getManifestPathCandidates(): string[] {
  return [
    join(process.resourcesPath, 'update-manifest.json'),
    join(app.getAppPath(), 'resources', 'update-manifest.json'),
    join(process.cwd(), 'resources', 'update-manifest.json')
  ]
}

function loadUpdateManifest(): UpdateManifest | null {
  for (const candidate of getManifestPathCandidates()) {
    if (!existsSync(candidate)) continue
    try {
      const raw = readFileSync(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as UpdateManifest
      if (
        typeof parsed?.schemaVersion === 'number' &&
        typeof parsed?.latestVersion === 'string' &&
        parsed?.releases &&
        typeof parsed.releases === 'object'
      ) {
        return parsed
      }
      console.warn('[Updater] Invalid update manifest format:', candidate)
    } catch (error) {
      console.warn('[Updater] Failed to read update manifest:', candidate, error)
    }
  }
  return null
}

function resolveDownloadInfo(
  manifest: UpdateManifest | null,
  version: string,
  preferredSource: DownloadSource
): DownloadInfo {
  const fallbackGithub = {
    source: 'github' as const,
    url: GITHUB_RELEASE_TAG_URL(version)
  }

  if (!manifest) return fallbackGithub

  const release = manifest.releases?.[version]
  if (!release?.platforms) return fallbackGithub

  const platform = release.platforms[getPlatformKey()] || release.platforms.default
  if (!platform) return fallbackGithub

  const githubUrl = platform.github
  const baiduUrl = platform.baidu?.url
  const baiduExtractCode = platform.baidu?.extractCode

  if (preferredSource === 'baidu' && baiduUrl) {
    return {
      source: 'baidu',
      url: baiduUrl,
      baiduExtractCode
    }
  }

  if (preferredSource === 'github' && githubUrl) {
    return {
      source: 'github',
      url: githubUrl
    }
  }

  if (githubUrl) {
    return {
      source: 'github',
      url: githubUrl
    }
  }

  if (baiduUrl) {
    return {
      source: 'baidu',
      url: baiduUrl,
      baiduExtractCode
    }
  }

  return fallbackGithub
}

async function probeGithubReachability(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      method: 'HEAD',
      signal: controller.signal
    })
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function isGithubReachableWithRetry(): Promise<boolean> {
  const firstTry = await probeGithubReachability(2000)
  if (firstTry) return true

  const secondTry = await probeGithubReachability(2000)
  return secondTry
}

async function checkUpdatesFromManifest(preferredSource: DownloadSource): Promise<void> {
  const manifest = loadUpdateManifest()
  const currentVersion = getCurrentVersion()
  const checkTime = new Date().toISOString()
  const settings = persistUpdateSettings({ lastCheckAt: checkTime })

  if (!manifest) {
    sendUpdateStatus('error', {
      checkTime,
      latestVersion: settings.latestKnownVersion,
      message: '检查更新失败，请稍后重试'
    })
    return
  }

  const latestVersion = manifest.latestVersion
  const latestRelease = manifest.releases?.[latestVersion]
  persistUpdateSettings({ latestKnownVersion: latestVersion })

  if (compareSemver(latestVersion, currentVersion) <= 0) {
    sendUpdateStatus('not-available', {
      version: currentVersion,
      latestVersion,
      checkTime,
      message: '已是最新版本',
      downloadSource: null,
      downloadUrl: null,
      baiduExtractCode: null
    })
    return
  }

  const download = resolveDownloadInfo(manifest, latestVersion, preferredSource)

  sendUpdateStatus('available', {
    version: latestVersion,
    latestVersion,
    checkTime,
    message: '发现新版本',
    releaseDate: latestRelease?.publishedAt,
    releaseNotes: latestRelease?.notes,
    downloadSource: download.source,
    downloadUrl: download.url,
    baiduExtractCode: download.baiduExtractCode || null,
    lastDismissedVersion: settings.lastDismissedVersion
  })
}

async function runManifestFallback(): Promise<void> {
  if (fallbackTriggeredForCurrentCheck) return
  fallbackTriggeredForCurrentCheck = true
  await checkUpdatesFromManifest('baidu')
}

function bindUpdaterEvents(): void {
  if (updaterEventsBound) return
  updaterEventsBound = true

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking', {
      checkTime: new Date().toISOString(),
      message: undefined
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const version = typeof info.version === 'string' ? info.version : getCurrentVersion()
    const checkTime = new Date().toISOString()
    const settings = persistUpdateSettings({
      lastCheckAt: checkTime,
      latestKnownVersion: version
    })
    const download = resolveDownloadInfo(loadUpdateManifest(), version, 'github')

    sendUpdateStatus('available', {
      version,
      latestVersion: version,
      checkTime,
      message: '发现新版本',
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      downloadSource: download.source,
      downloadUrl: download.url,
      baiduExtractCode: download.baiduExtractCode || null,
      lastDismissedVersion: settings.lastDismissedVersion
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    const latestVersion = typeof info.version === 'string' ? info.version : getCurrentVersion()
    const checkTime = new Date().toISOString()
    persistUpdateSettings({
      lastCheckAt: checkTime,
      latestKnownVersion: latestVersion
    })

    sendUpdateStatus('not-available', {
      version: getCurrentVersion(),
      latestVersion,
      checkTime,
      message: '已是最新版本',
      downloadSource: null,
      downloadUrl: null,
      baiduExtractCode: null
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', {
      percent: progress.percent
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    sendUpdateStatus('downloaded', {
      version: info.version
    })
  })

  autoUpdater.on('error', async (error) => {
    console.error('[Updater] Error:', error.message)
    if (updaterState.status === 'checking') {
      await runManifestFallback()
      return
    }

    sendUpdateStatus('error', {
      message: '检查更新失败，请稍后重试'
    })
  })
}

/**
 * Initialize auto-updater
 */
export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window
  hydrateStateFromConfig()

  // Skip updates in development
  if (is.dev) {
    console.log('[Updater] Skipping auto-update in development mode')
    return
  }

  bindUpdaterEvents()

  const settings = getUpdateSettings()
  if (settings.checkOnStartup) {
    // Check for updates on startup with delay to avoid blocking app launch
    setTimeout(() => {
      void checkForUpdates()
    }, 5000)
  }
}

export function getUpdaterState(): UpdaterState {
  hydrateStateFromConfig()
  return {
    ...updaterState
  }
}

export function dismissUpdateVersion(version: string): void {
  const settings = persistUpdateSettings({ lastDismissedVersion: version })
  sendUpdateStatus(updaterState.status, {
    lastDismissedVersion: settings.lastDismissedVersion
  })
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<void> {
  if (is.dev) {
    console.log('[Updater] Skipping update check in development mode')
    return
  }

  fallbackTriggeredForCurrentCheck = false
  const checkTime = new Date().toISOString()
  persistUpdateSettings({ lastCheckAt: checkTime })
  sendUpdateStatus('checking', {
    checkTime,
    message: undefined
  })

  const githubReachable = await isGithubReachableWithRetry()
  if (!githubReachable) {
    await runManifestFallback()
    return
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.error('[Updater] GitHub update check failed, fallback to manifest:', error)
    await runManifestFallback()
  }
}

/**
 * Manual install is disabled in notify-only mode.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}

/**
 * Register IPC handlers for updater
 */
export function registerUpdaterHandlers(): void {
  ipcMain.handle('updater:check', async () => {
    await checkForUpdates()
    return { success: true, data: getUpdaterState() }
  })

  ipcMain.handle('updater:install', () => {
    return { success: false, error: 'Auto install is disabled. Please download manually.' }
  })

  ipcMain.handle('updater:get-version', () => {
    return { success: true, data: getCurrentVersion() }
  })

  ipcMain.handle('updater:get-state', () => {
    return { success: true, data: getUpdaterState() }
  })

  ipcMain.handle('updater:dismiss-version', (_event, version: string) => {
    dismissUpdateVersion(version)
    return { success: true }
  })
}
