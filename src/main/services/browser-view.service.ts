/**
 * BrowserView Service - Manages embedded browser views
 *
 * This service creates and manages BrowserView instances for the Content Canvas,
 * enabling true browser functionality within Kite - like having Chrome embedded
 * in the app.
 *
 * Key features:
 * - Multiple concurrent BrowserViews (one per tab)
 * - Full Chromium rendering with network capabilities
 * - Security isolation (sandbox mode)
 * - State tracking (URL, title, loading, navigation history)
 * - AI-ready (screenshot capture, JS execution)
 */

import { BrowserView, BrowserWindow } from 'electron'

// ============================================
// Types
// ============================================

export interface BrowserViewState {
  id: string
  url: string
  title: string
  favicon?: string // base64 data URL
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoomLevel: number
  isDevToolsOpen: boolean
  error?: string
}

export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export type SopAction =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'press_key'
  | 'wait_for'

export interface SemanticTarget {
  role?: string
  name?: string
  text?: string
  label?: string
  placeholder?: string
  urlPattern?: string
}

export interface SopRecordedStep {
  id: string
  action: SopAction
  target?: SemanticTarget
  value?: string
  assertion?: string
  retries: number
}

export interface SopSpec {
  version: string
  name: string
  steps: SopRecordedStep[]
  meta?: Record<string, unknown>
}

export interface SopRecordingState {
  viewId: string
  isRecording: boolean
  startedAt: number | null
  steps: SopRecordedStep[]
}

export interface BrowserSopRecordingEventPayload {
  type: 'state' | 'step'
  viewId: string
  state?: SopRecordingState
  step?: SopRecordedStep
}

interface SopRawDomTarget extends SemanticTarget {
  inputType?: string
  nameAttr?: string
  idAttr?: string
}

interface SopRawDomEvent {
  source: 'dom'
  eventType: 'click' | 'input' | 'change' | 'keydown' | 'submit'
  url?: string
  key?: string
  value?: string
  target?: SopRawDomTarget
}

interface SopRawNavigateEvent {
  source: 'navigate'
  url: string
}

type SopRawEvent = SopRawDomEvent | SopRawNavigateEvent

interface SopRecordingSession {
  isRecording: boolean
  startedAt: number | null
  steps: SopRecordedStep[]
  stepSeq: number
}

// ============================================
// Constants
// ============================================

// Chrome User-Agent to avoid detection as Electron app
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SOP_EVENT_PREFIX = '__KITE_SOP__:'
const SOP_SECRET_PLACEHOLDER = '{{secret_value}}'
const SOP_VERIFICATION_PLACEHOLDER = '{{verification_code}}'
const SOP_DEFAULT_RETRIES = 3
const SENSITIVE_FIELD_RE = /(pass(word)?|pwd|secret|token|credential|验证码|密码|口令)/i
const VERIFICATION_FIELD_RE = /(otp|验证码|verify|verification|code|2fa|mfa|captcha|sms)/i
const SELECT_INPUT_TYPES = new Set(['select-one', 'select-multiple'])
const ENTER_KEY = 'Enter'

function normalizeTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeSopSemanticTarget(target?: Partial<SopRawDomTarget> | null): SemanticTarget | undefined {
  if (!target) return undefined
  const normalized: SemanticTarget = {}
  const role = normalizeTextValue(target.role)
  const name = normalizeTextValue(target.name)
  const text = normalizeTextValue(target.text)
  const label = normalizeTextValue(target.label)
  const placeholder = normalizeTextValue(target.placeholder)
  const urlPattern = normalizeTextValue(target.urlPattern)

  if (role) normalized.role = role
  if (name) normalized.name = name
  if (text) normalized.text = text
  if (label) normalized.label = label
  if (placeholder) normalized.placeholder = placeholder
  if (urlPattern) normalized.urlPattern = urlPattern

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function classifySensitiveTarget(target?: Partial<SopRawDomTarget> | null): {
  sensitive: boolean
  verification: boolean
} {
  if (!target) return { sensitive: false, verification: false }

  const inputType = normalizeTextValue(target.inputType)?.toLowerCase()
  if (inputType === 'password') {
    return { sensitive: true, verification: false }
  }

  const fields = [
    target.name,
    target.label,
    target.placeholder,
    target.nameAttr,
    target.idAttr,
  ]

  const hasSensitive = fields.some((field) => isNonEmptyText(field) && SENSITIVE_FIELD_RE.test(field))
  const hasVerification = fields.some((field) => isNonEmptyText(field) && VERIFICATION_FIELD_RE.test(field))
  if (!hasSensitive && !hasVerification) {
    return { sensitive: false, verification: false }
  }

  return {
    sensitive: true,
    verification: hasVerification,
  }
}

export function redactSopValue(
  value: string | undefined,
  target?: Partial<SopRawDomTarget> | null
): string | undefined {
  const normalizedValue = normalizeTextValue(value)
  if (!normalizedValue) return undefined

  const sensitivity = classifySensitiveTarget(target)
  if (!sensitivity.sensitive) return normalizedValue
  return sensitivity.verification ? SOP_VERIFICATION_PLACEHOLDER : SOP_SECRET_PLACEHOLDER
}

function getTargetMergeKey(target?: SemanticTarget): string {
  if (!target) return ''
  return [
    target.role || '',
    target.name || '',
    target.text || '',
    target.label || '',
    target.placeholder || '',
    target.urlPattern || '',
  ].join('|')
}

function hasSemanticSignal(target?: SemanticTarget): boolean {
  return !!target && Object.values(target).some((value) => isNonEmptyText(value))
}

export function shouldMergeSopSteps(previous: SopRecordedStep | undefined, current: SopRecordedStep): boolean {
  if (!previous) return false
  if (previous.action !== 'fill' || current.action !== 'fill') return false
  return getTargetMergeKey(previous.target) === getTargetMergeKey(current.target)
}

export function appendSopStep(steps: SopRecordedStep[], incoming: SopRecordedStep): SopRecordedStep[] {
  const previous = steps[steps.length - 1]

  if (shouldMergeSopSteps(previous, incoming) && previous) {
    const merged = {
      ...previous,
      value: incoming.value,
      target: incoming.target || previous.target,
    }
    return [...steps.slice(0, -1), merged]
  }

  if (
    previous &&
    previous.action === incoming.action &&
    previous.value === incoming.value &&
    getTargetMergeKey(previous.target) === getTargetMergeKey(incoming.target)
  ) {
    return steps
  }

  if (
    previous &&
    previous.action === 'navigate' &&
    incoming.action === 'navigate' &&
    previous.value === incoming.value
  ) {
    return steps
  }

  return [...steps, incoming]
}

export function normalizeSopRawEvent(raw: SopRawEvent): Omit<SopRecordedStep, 'id'> | null {
  if (raw.source === 'navigate') {
    const url = normalizeTextValue(raw.url)
    if (!url) return null
    return {
      action: 'navigate',
      target: { urlPattern: url },
      value: url,
      retries: SOP_DEFAULT_RETRIES,
    }
  }

  const target = normalizeSopSemanticTarget(raw.target)

  if (raw.eventType === 'click') {
    if (!hasSemanticSignal(target)) return null
    return {
      action: 'click',
      target,
      retries: SOP_DEFAULT_RETRIES,
    }
  }

  if (raw.eventType === 'keydown') {
    if (raw.key !== ENTER_KEY || !hasSemanticSignal(target)) return null
    return {
      action: 'press_key',
      target,
      value: ENTER_KEY,
      retries: SOP_DEFAULT_RETRIES,
    }
  }

  if (raw.eventType === 'submit') {
    if (!hasSemanticSignal(target)) return null
    return {
      action: 'press_key',
      target,
      value: ENTER_KEY,
      retries: SOP_DEFAULT_RETRIES,
    }
  }

  if (raw.eventType === 'input' || raw.eventType === 'change') {
    if (!hasSemanticSignal(target)) return null
    const normalizedInputType = normalizeTextValue(raw.target?.inputType)?.toLowerCase()
    const action = normalizedInputType && SELECT_INPUT_TYPES.has(normalizedInputType)
      ? 'select'
      : 'fill'
    const value = redactSopValue(raw.value, raw.target)

    // Ignore non-select empty values to reduce invalid noisy steps.
    if (action === 'fill' && !value) return null

    return {
      action,
      target,
      value,
      retries: SOP_DEFAULT_RETRIES,
    }
  }

  return null
}

// ============================================
// BrowserView Manager
// ============================================

class BrowserViewManager {
  private views: Map<string, BrowserView> = new Map()
  private states: Map<string, BrowserViewState> = new Map()
  private mainWindow: BrowserWindow | null = null
  private activeViewId: string | null = null

  // Debounce timers for state change events
  // This prevents flooding the renderer with too many IPC messages during rapid navigation
  private stateChangeDebounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private static readonly STATE_CHANGE_DEBOUNCE_MS = 50 // 50ms debounce

  // SOP recording sessions keyed by viewId
  private sopRecordingSessions: Map<string, SopRecordingSession> = new Map()
  private activeSopRecordingViewId: string | null = null

  /**
   * Initialize the manager with the main window
   */
  initialize(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow

    // Clean up views when window is closed
    mainWindow.on('closed', () => {
      this.destroyAll()
    })
  }

  /**
   * Create a new BrowserView
   */
  async create(viewId: string, url?: string): Promise<BrowserViewState> {
    console.log(`[BrowserView] >>> create() called - viewId: ${viewId}, url: ${url}`)

    // Don't create duplicate views
    if (this.views.has(viewId)) {
      console.log(`[BrowserView] View already exists, returning existing state`)
      return this.states.get(viewId)!
    }

    console.log(`[BrowserView] Creating new BrowserView...`)
    const view = new BrowserView({
      webPreferences: {
        sandbox: true, // Security: enable sandbox for external content
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Persistent storage for cookies, localStorage, etc.
        partition: 'persist:browser',
        // Enable smooth scrolling and other web features
        scrollBounce: true,
      },
    })
    console.log(`[BrowserView] BrowserView instance created`)

    // Set Chrome User-Agent to avoid detection
    view.webContents.setUserAgent(CHROME_USER_AGENT)

    // Set background color to white (standard web)
    view.setBackgroundColor('#ffffff')

    // Initialize state
    const state: BrowserViewState = {
      id: viewId,
      url: url || 'about:blank',
      title: 'New Tab',
      isLoading: !!url,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 1,
      isDevToolsOpen: false,
    }

    this.views.set(viewId, view)
    this.states.set(viewId, state)
    console.log(`[BrowserView] View stored in map, views count: ${this.views.size}`)

    // Bind events
    this.bindEvents(viewId, view)
    console.log(`[BrowserView] Events bound`)

    // Navigate to initial URL
    if (url) {
      try {
        console.log(`[BrowserView] Loading URL: ${url}`)
        await view.webContents.loadURL(url)
        console.log(`[BrowserView] URL loaded successfully`)
      } catch (error) {
        console.error(`[BrowserView] Failed to load URL: ${url}`, error)
        state.error = (error as Error).message
        state.isLoading = false
      }
    }

    console.log(`[BrowserView] <<< create() returning state:`, JSON.stringify(state, null, 2))
    return state
  }

  /**
   * Show a BrowserView at specified bounds
   */
  show(viewId: string, bounds: BrowserViewBounds) {
    console.log(`[BrowserView] >>> show() called - viewId: ${viewId}, bounds:`, bounds)

    const view = this.views.get(viewId)
    if (!view) {
      console.error(`[BrowserView] show() - View not found: ${viewId}`)
      return false
    }
    if (!this.mainWindow) {
      console.error(`[BrowserView] show() - mainWindow is null`)
      return false
    }

    // Hide currently active view first
    if (this.activeViewId && this.activeViewId !== viewId) {
      console.log(`[BrowserView] Hiding previous active view: ${this.activeViewId}`)
      this.hide(this.activeViewId)
    }

    // Add to window
    console.log(`[BrowserView] Adding BrowserView to window...`)
    this.mainWindow.addBrowserView(view)
    console.log(`[BrowserView] BrowserView added to window`)

    // Set bounds with integer values
    const intBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    console.log(`[BrowserView] Setting bounds:`, intBounds)
    view.setBounds(intBounds)

    // Keep BrowserView size in sync with host window size changes.
    // Position is still controlled by renderer bounds updates.
    view.setAutoResize({
      width: true,
      height: true,
      horizontal: true,
      vertical: true,
    })

    this.activeViewId = viewId
    console.log(`[BrowserView] <<< show() success - activeViewId: ${this.activeViewId}`)
    return true
  }

  /**
   * Hide a BrowserView (remove from window but keep in memory)
   */
  hide(viewId: string) {
    const view = this.views.get(viewId)
    if (!view || !this.mainWindow) return false

    try {
      this.mainWindow.removeBrowserView(view)
    } catch (e) {
      // View might already be removed
    }

    if (this.activeViewId === viewId) {
      this.activeViewId = null
    }

    return true
  }

  /**
   * Resize a BrowserView
   */
  resize(viewId: string, bounds: BrowserViewBounds) {
    const view = this.views.get(viewId)
    if (!view) return false

    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })

    return true
  }

  /**
   * Navigate to a URL
   */
  async navigate(viewId: string, input: string): Promise<boolean> {
    const view = this.views.get(viewId)
    if (!view) return false

    // Process input - could be URL or search query
    let url = input.trim()

    if (!url) return false

    // Check if it's already a valid URL
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
      // Check if it looks like a domain
      if (url.includes('.') && !url.includes(' ') && this.looksLikeDomain(url)) {
        url = 'https://' + url
      } else {
        // Treat as search query
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`
      }
    }

    try {
      await view.webContents.loadURL(url)
      return true
    } catch (error) {
      console.error(`[BrowserView] Navigation failed: ${url}`, error)
      this.updateState(viewId, {
        error: (error as Error).message,
        isLoading: false,
      })
      this.emitStateChange(viewId)
      return false
    }
  }

  /**
   * Check if input looks like a domain
   */
  private looksLikeDomain(input: string): boolean {
    // Common TLDs
    const tlds = ['com', 'org', 'net', 'io', 'dev', 'co', 'ai', 'app', 'cn', 'uk', 'de', 'fr', 'jp']
    const parts = input.split('.')
    if (parts.length < 2) return false
    const lastPart = parts[parts.length - 1].toLowerCase()
    return tlds.includes(lastPart) || lastPart.length === 2
  }

  /**
   * Navigation: Go back
   */
  goBack(viewId: string): boolean {
    const view = this.views.get(viewId)
    if (!view || !view.webContents.canGoBack()) return false
    view.webContents.goBack()
    return true
  }

  /**
   * Navigation: Go forward
   */
  goForward(viewId: string): boolean {
    const view = this.views.get(viewId)
    if (!view || !view.webContents.canGoForward()) return false
    view.webContents.goForward()
    return true
  }

  /**
   * Navigation: Reload
   */
  reload(viewId: string): boolean {
    const view = this.views.get(viewId)
    if (!view) return false
    view.webContents.reload()
    return true
  }

  /**
   * Navigation: Stop loading
   */
  stop(viewId: string): boolean {
    const view = this.views.get(viewId)
    if (!view) return false
    view.webContents.stop()
    return true
  }

  /**
   * Capture screenshot of the view
   */
  async capture(viewId: string): Promise<string | null> {
    const view = this.views.get(viewId)
    if (!view) return null

    try {
      const image = await view.webContents.capturePage()
      return image.toDataURL()
    } catch (error) {
      console.error('[BrowserView] Screenshot failed:', error)
      return null
    }
  }

  /**
   * Execute JavaScript in the view
   */
  async executeJS(viewId: string, code: string): Promise<unknown> {
    const view = this.views.get(viewId)
    if (!view) return null

    try {
      return await view.webContents.executeJavaScript(code)
    } catch (error) {
      console.error('[BrowserView] JS execution failed:', error)
      return null
    }
  }

  async startSopRecording(viewId: string): Promise<SopRecordingState> {
    const view = this.views.get(viewId)
    if (!view) {
      throw new Error(`BrowserView not found: ${viewId}`)
    }

    if (this.activeSopRecordingViewId && this.activeSopRecordingViewId !== viewId) {
      throw new Error(
        `SOP recording already active on view ${this.activeSopRecordingViewId}. Stop it before starting a new one.`
      )
    }

    const session = this.getOrCreateSopSession(viewId)
    session.isRecording = true
    session.startedAt = Date.now()
    session.steps = []
    session.stepSeq = 0
    this.activeSopRecordingViewId = viewId
    console.log(`[BrowserView][SOP] start recording view=${viewId}`)

    await this.toggleInjectedRecorder(viewId, true)
    this.emitSopRecordingState(viewId)
    return this.getSopRecordingState(viewId)
  }

  async stopSopRecording(viewId: string): Promise<SopRecordingState> {
    const session = this.getOrCreateSopSession(viewId)
    session.isRecording = false
    if (this.activeSopRecordingViewId === viewId) {
      this.activeSopRecordingViewId = null
    }
    console.log(`[BrowserView][SOP] stop recording view=${viewId}, steps=${session.steps.length}`)
    await this.toggleInjectedRecorder(viewId, false)
    this.emitSopRecordingState(viewId)
    return this.getSopRecordingState(viewId)
  }

  getSopRecordingState(viewId: string): SopRecordingState {
    const session = this.sopRecordingSessions.get(viewId)
    return {
      viewId,
      isRecording: session?.isRecording ?? false,
      startedAt: session?.startedAt ?? null,
      steps: session ? session.steps.map((step) => ({ ...step })) : [],
    }
  }

  clearSopRecording(viewId: string): SopRecordingState {
    const session = this.getOrCreateSopSession(viewId)
    session.steps = []
    session.stepSeq = 0
    this.emitSopRecordingState(viewId)
    return this.getSopRecordingState(viewId)
  }

  /**
   * Set zoom level
   */
  setZoom(viewId: string, level: number): boolean {
    const view = this.views.get(viewId)
    if (!view) return false

    // Clamp zoom level
    const clampedLevel = Math.max(0.25, Math.min(5, level))
    view.webContents.setZoomFactor(clampedLevel)
    this.updateState(viewId, { zoomLevel: clampedLevel })
    this.emitStateChange(viewId)
    return true
  }

  /**
   * Toggle DevTools
   */
  toggleDevTools(viewId: string): boolean {
    const view = this.views.get(viewId)
    if (!view) return false

    if (view.webContents.isDevToolsOpened()) {
      view.webContents.closeDevTools()
      this.updateState(viewId, { isDevToolsOpen: false })
    } else {
      view.webContents.openDevTools({ mode: 'detach' })
      this.updateState(viewId, { isDevToolsOpen: true })
    }
    this.emitStateChange(viewId)
    return true
  }

  /**
   * Get current state of a view
   */
  getState(viewId: string): BrowserViewState | null {
    return this.states.get(viewId) || null
  }

  /**
   * Destroy a specific BrowserView
   */
  destroy(viewId: string) {
    const view = this.views.get(viewId)
    if (!view) return

    // Clear any pending debounce timer for this view
    const timer = this.stateChangeDebounceTimers.get(viewId)
    if (timer) {
      clearTimeout(timer)
      this.stateChangeDebounceTimers.delete(viewId)
    }

    // Remove from window
    if (this.mainWindow) {
      try {
        this.mainWindow.removeBrowserView(view)
      } catch (e) {
        // Already removed
      }
    }

    // Close webContents
    try {
      ;(view.webContents as any).destroy()
    } catch (e) {
      // Already destroyed
    }

    // Clean up maps
    this.views.delete(viewId)
    this.states.delete(viewId)
    this.sopRecordingSessions.delete(viewId)

    if (this.activeViewId === viewId) {
      this.activeViewId = null
    }
    if (this.activeSopRecordingViewId === viewId) {
      this.activeSopRecordingViewId = null
    }
  }

  /**
   * Destroy all BrowserViews
   */
  destroyAll() {
    // Clear all debounce timers
    for (const timer of this.stateChangeDebounceTimers.values()) {
      clearTimeout(timer)
    }
    this.stateChangeDebounceTimers.clear()

    for (const viewId of this.views.keys()) {
      this.destroy(viewId)
    }
    this.sopRecordingSessions.clear()
    this.activeSopRecordingViewId = null
  }

  /**
   * Bind WebContents events
   */
  private bindEvents(viewId: string, view: BrowserView) {
    const wc = view.webContents

    // Navigation start - immediate emit for responsive UI feedback
    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame) return

      this.recordSopRawEvent(viewId, { source: 'navigate', url })
      this.updateState(viewId, {
        url,
        isLoading: true,
        error: undefined,
      })
      // Use immediate emit for navigation start - user needs to see loading indicator
      this.emitStateChangeImmediate(viewId)
    })

    // Navigation finished - immediate emit for responsive UI feedback
    wc.on('did-finish-load', () => {
      this.updateState(viewId, {
        isLoading: false,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        error: undefined,
      })
      // Use immediate emit for load finish - user needs to see content immediately
      this.emitStateChangeImmediate(viewId)
    })

    // Re-inject recorder into newly loaded frames during active recording.
    wc.on('did-frame-finish-load', () => {
      const session = this.sopRecordingSessions.get(viewId)
      if (!session?.isRecording) return
      void this.toggleInjectedRecorder(viewId, true)
    })

    // Navigation failed - immediate emit
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return

      // Ignore aborted loads (user navigation)
      if (errorCode === -3) return

      this.updateState(viewId, {
        isLoading: false,
        error: errorDescription || `Error ${errorCode}`,
      })
      this.emitStateChangeImmediate(viewId)
    })

    // Title updated - debounced (can happen frequently during SPA navigation)
    wc.on('page-title-updated', (_event, title) => {
      this.updateState(viewId, { title })
      this.emitStateChange(viewId) // debounced
    })

    // Favicon updated - debounced (not urgent)
    wc.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        this.updateState(viewId, { favicon: favicons[0] })
        this.emitStateChange(viewId) // debounced
      }
    })

    // URL changed (for SPA navigation) - debounced (can happen very frequently)
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return

      this.recordSopRawEvent(viewId, { source: 'navigate', url })
      this.updateState(viewId, {
        url,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      })
      this.emitStateChange(viewId) // debounced
    })

    // Handle new window requests - open in same view
    wc.setWindowOpenHandler(({ url }) => {
      // Load in current view instead of opening new window
      wc.loadURL(url)
      return { action: 'deny' }
    })

    // Handle external protocol links
    wc.on('will-navigate', (event, url) => {
      // Allow http/https/file protocols, block others (like javascript:, data:, etc.)
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        event.preventDefault()
      }
    })

    wc.on('console-message', (_event, _level, message) => {
      if (!message.startsWith(SOP_EVENT_PREFIX)) return
      const rawPayload = message.slice(SOP_EVENT_PREFIX.length)
      try {
        const parsed = JSON.parse(rawPayload) as SopRawEvent
        this.recordSopRawEvent(viewId, parsed)
      } catch (error) {
        console.warn('[BrowserView] Failed to parse SOP event payload:', error)
      }
    })
  }

  /**
   * Update state
   */
  private updateState(viewId: string, updates: Partial<BrowserViewState>) {
    const state = this.states.get(viewId)
    if (state) {
      Object.assign(state, updates)
    }
  }

  /**
   * Emit state change event to renderer (debounced)
   * Uses debouncing to prevent flooding the renderer with too many IPC messages
   * during rapid state changes (e.g., fast navigation, SPA route changes)
   */
  private emitStateChange(viewId: string) {
    // Clear existing debounce timer for this view
    const existingTimer = this.stateChangeDebounceTimers.get(viewId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.stateChangeDebounceTimers.delete(viewId)
      this.doEmitStateChange(viewId)
    }, BrowserViewManager.STATE_CHANGE_DEBOUNCE_MS)

    this.stateChangeDebounceTimers.set(viewId, timer)
  }

  /**
   * Emit state change event immediately (no debounce)
   * Used for critical state changes that need immediate UI feedback
   */
  private emitStateChangeImmediate(viewId: string) {
    // Clear any pending debounced emit for this view
    const existingTimer = this.stateChangeDebounceTimers.get(viewId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.stateChangeDebounceTimers.delete(viewId)
    }

    this.doEmitStateChange(viewId)
  }

  /**
   * Actually emit the state change event
   */
  private doEmitStateChange(viewId: string) {
    const state = this.states.get(viewId)
    if (state && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('browser:state-change', {
        viewId,
        state: { ...state },
      })
    }
  }

  private getOrCreateSopSession(viewId: string): SopRecordingSession {
    const existing = this.sopRecordingSessions.get(viewId)
    if (existing) return existing

    const created: SopRecordingSession = {
      isRecording: false,
      startedAt: null,
      steps: [],
      stepSeq: 0,
    }
    this.sopRecordingSessions.set(viewId, created)
    return created
  }

  private emitSopRecordingEvent(payload: BrowserSopRecordingEventPayload): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('browser:sop-recording:event', payload)
  }

  private emitSopRecordingState(viewId: string): void {
    this.emitSopRecordingEvent({
      type: 'state',
      viewId,
      state: this.getSopRecordingState(viewId),
    })
  }

  private recordSopRawEvent(viewId: string, raw: SopRawEvent): void {
    const session = this.sopRecordingSessions.get(viewId)
    if (!session?.isRecording) return

    const normalized = normalizeSopRawEvent(raw)
    if (!normalized) return

    const nextStep: SopRecordedStep = {
      id: `step-${session.stepSeq + 1}`,
      ...normalized,
    }
    const nextSteps = appendSopStep(session.steps, nextStep)
    if (nextSteps === session.steps) return

    // Only consume step IDs on successful append.
    if (nextSteps.length > session.steps.length) {
      session.stepSeq += 1
    }

    session.steps = nextSteps

    const latestStep = session.steps[session.steps.length - 1]
    console.log(
      `[BrowserView][SOP] recorded view=${viewId}, action=${latestStep.action}, steps=${session.steps.length}`
    )
    this.emitSopRecordingEvent({
      type: 'step',
      viewId,
      step: latestStep,
    })
    this.emitSopRecordingState(viewId)
  }

  private async toggleInjectedRecorder(viewId: string, enabled: boolean): Promise<void> {
    const view = this.views.get(viewId)
    if (!view) return
    const script = this.buildRecorderInjectionScript(enabled)
    const frames = view.webContents.mainFrame?.framesInSubtree || []
    let injectedCount = 0
    try {
      for (const frame of frames) {
        try {
          await frame.executeJavaScript(script, true)
          injectedCount += 1
        } catch (error) {
          console.warn(
            `[BrowserView][SOP] Failed to inject recorder into frame view=${viewId} frameUrl=${frame.url}`,
            error
          )
        }
      }
      if (injectedCount === 0) {
        await view.webContents.executeJavaScript(script, true)
        injectedCount = 1
      }
      console.log(
        `[BrowserView][SOP] recorder ${enabled ? 'enabled' : 'disabled'} for view=${viewId}, frames=${injectedCount}`
      )
    } catch (error) {
      console.warn('[BrowserView] Failed to toggle SOP recorder injection:', error)
    }
  }

  private buildRecorderInjectionScript(enabled: boolean): string {
    return `
(() => {
  const PREFIX = '${SOP_EVENT_PREFIX}';
  const RECORDER_KEY = '__kiteSopRecorder__';
  const TARGET_SELECTOR = 'button,a,input,select,textarea,label,[role],[data-testid],[data-test],[contenteditable="true"]';

  const normalize = (value) => typeof value === 'string' ? value.trim() : '';
  const truncate = (value, size) => normalize(value).slice(0, size);

  const readText = (element) => {
    if (!(element instanceof Element)) return '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return truncate(element.value || '', 120);
    }
    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions?.[0];
      if (selected) return truncate(selected.text || selected.value || '', 120);
    }
    const text = element.innerText || element.textContent || '';
    return truncate(text, 120);
  };

  const readLabel = (element) => {
    if (!(element instanceof Element)) return '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (typeof element.labels?.[0]?.innerText === 'string') {
        const direct = normalize(element.labels[0].innerText);
        if (direct) return direct.slice(0, 80);
      }
      const id = element.id;
      if (id) {
        const ownerDocument = element.ownerDocument || document;
        const viaFor = ownerDocument.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (viaFor instanceof Element) {
          const labelText = truncate(viaFor.innerText || viaFor.textContent || '', 80);
          if (labelText) return labelText;
        }
      }
    }
    const parentLabel = element.closest('label');
    if (parentLabel) {
      const parentLabelText = truncate(parentLabel.innerText || parentLabel.textContent || '', 80);
      if (parentLabelText) return parentLabelText;
    }
    return '';
  };

  const readRole = (element) => {
    if (!(element instanceof Element)) return '';
    const explicitRole = normalize(element.getAttribute('role') || '');
    if (explicitRole) return explicitRole;
    if (element instanceof HTMLButtonElement) return 'button';
    if (element instanceof HTMLAnchorElement) return 'link';
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') return 'checkbox';
      if (element.type === 'radio') return 'radio';
      return 'textbox';
    }
    if (element instanceof HTMLSelectElement) return 'combobox';
    if (element instanceof HTMLTextAreaElement) return 'textbox';
    return '';
  };

  const readName = (element) => {
    if (!(element instanceof Element)) return '';
    const ariaLabel = truncate(element.getAttribute('aria-label') || '', 80);
    if (ariaLabel) return ariaLabel;
    const title = truncate(element.getAttribute('title') || '', 80);
    if (title) return title;
    const dataTestId = truncate(element.getAttribute('data-testid') || element.getAttribute('data-test') || '', 80);
    if (dataTestId) return dataTestId;
    const nameAttr = truncate(element.getAttribute('name') || '', 80);
    if (nameAttr) return nameAttr;
    const idAttr = truncate(element.id || '', 80);
    if (idAttr) return idAttr;
    const text = readText(element);
    if (text) return text.slice(0, 80);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const value = truncate(element.name || '', 80);
      if (value) return value;
    }
    return '';
  };

  const resolveActionElement = (rawTarget) => {
    if (!(rawTarget instanceof Element)) return null;
    const interactive = rawTarget.closest(TARGET_SELECTOR);
    return interactive || rawTarget;
  };

  const toTarget = (rawElement) => {
    const element = resolveActionElement(rawElement);
    if (!(element instanceof Element)) return null;
    const target = {
      role: readRole(element),
      name: readName(element),
      text: readText(element),
      label: readLabel(element),
      placeholder: '',
      urlPattern: '',
      inputType: '',
      nameAttr: '',
      idAttr: ''
    };

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      target.placeholder = truncate(element.placeholder || '', 80);
      target.nameAttr = truncate(element.name || '', 80);
      target.idAttr = truncate(element.id || '', 80);
      if (element instanceof HTMLSelectElement) {
        target.inputType = 'select-one';
      } else if (element instanceof HTMLInputElement) {
        target.inputType = normalize(element.type || 'text').toLowerCase();
      } else {
        target.inputType = 'textarea';
      }
    } else {
      target.nameAttr = truncate(element.getAttribute('name') || '', 80);
      target.idAttr = truncate(element.id || '', 80);
    }

    if (element instanceof HTMLAnchorElement) {
      target.urlPattern = truncate(element.href || '', 240);
    }

    return target;
  };

  const emit = (payload) => {
    try {
      console.log(PREFIX + JSON.stringify(payload));
    } catch (_) {
      // ignore
    }
  };

  const getEventUrl = (event) => {
    try {
      const ownerDocument = event?.target?.ownerDocument;
      const href = ownerDocument?.defaultView?.location?.href;
      if (typeof href === 'string' && href.length > 0) return href;
    } catch (_) {
      // ignore
    }
    return location.href;
  };

  const emitDomEvent = (eventType, event, extra = {}) => {
    const target = event && event.target instanceof Element ? event.target : null;
    if (!target) return;
    emit({
      source: 'dom',
      eventType,
      url: getEventUrl(event),
      target: toTarget(target),
      ...extra
    });
  };

  const attachToDocument = (recorder, doc) => {
    if (!doc || recorder.attachedDocs.has(doc)) return;
    doc.addEventListener('click', recorder.handlers.click, true);
    doc.addEventListener('input', recorder.handlers.input, true);
    doc.addEventListener('change', recorder.handlers.change, true);
    doc.addEventListener('keydown', recorder.handlers.keydown, true);
    doc.addEventListener('submit', recorder.handlers.submit, true);
    recorder.attachedDocs.add(doc);
  };

  const attachToFrames = (recorder, rootDoc) => {
    if (!rootDoc) return;
    attachToDocument(recorder, rootDoc);
    const frames = rootDoc.querySelectorAll('iframe,frame');
    frames.forEach((frame) => {
      if (!(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)) return;
      if (!recorder.boundFrames.has(frame)) {
        frame.addEventListener('load', () => {
          try {
            attachToFrames(recorder, frame.contentDocument || null);
          } catch (_) {
            // Cross-origin frame, skip.
          }
        }, true);
        recorder.boundFrames.add(frame);
      }

      try {
        const childDoc = frame.contentDocument || null;
        attachToFrames(recorder, childDoc);
      } catch (_) {
        // Cross-origin frame, skip.
      }
    });
  };

  let recorder = window[RECORDER_KEY];
  if (!recorder) {
    recorder = {
      active: false,
      handlers: {},
      attachedDocs: new WeakSet(),
      boundFrames: new WeakSet(),
      frameScanTimer: null
    };

    recorder.handlers.click = (event) => {
      if (!recorder.active) return;
      emitDomEvent('click', event);
    };

    recorder.handlers.input = (event) => {
      if (!recorder.active) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      emitDomEvent('input', event, { value: target.value });
    };

    recorder.handlers.change = (event) => {
      if (!recorder.active) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
      emitDomEvent('change', event, { value: target.value });
    };

    recorder.handlers.keydown = (event) => {
      if (!recorder.active) return;
      if (event.key !== '${ENTER_KEY}') return;
      emitDomEvent('keydown', event, { key: '${ENTER_KEY}' });
    };

    recorder.handlers.submit = (event) => {
      if (!recorder.active) return;
      const submitter = event.submitter instanceof Element
        ? event.submitter
        : (event.target instanceof Element ? event.target : null);
      if (!submitter) return;
      emit({
        source: 'dom',
        eventType: 'submit',
        url: getEventUrl(event),
        key: '${ENTER_KEY}',
        target: toTarget(submitter)
      });
    };

    attachToFrames(recorder, document);
    recorder.frameScanTimer = window.setInterval(() => {
      if (!recorder.active) return;
      attachToFrames(recorder, document);
    }, 1200);

    window[RECORDER_KEY] = recorder;
  }

  recorder.active = ${enabled ? 'true' : 'false'};
  if (recorder.active) {
    attachToFrames(recorder, document);
    emit({ source: 'dom', eventType: 'change', target: { role: 'status', text: 'recorder-attached' } });
  }
  return recorder.active;
})();
`
  }

  // ============================================
  // AI Browser Integration Methods
  // ============================================

  /**
   * Get WebContents for a view (used by AI Browser for CDP commands)
   */
  getWebContents(viewId: string): Electron.WebContents | null {
    const view = this.views.get(viewId)
    return view?.webContents || null
  }

  /**
   * Get all view states (used by AI Browser for listing pages)
   */
  getAllStates(): Array<BrowserViewState & { id: string }> {
    const states: Array<BrowserViewState & { id: string }> = []
    for (const [id, state] of this.states) {
      states.push({ ...state, id })
    }
    return states
  }

  /**
   * Get the currently active view ID
   */
  getActiveViewId(): string | null {
    return this.activeViewId
  }

  /**
   * Set a view as active (used by AI Browser when selecting pages)
   */
  setActiveView(viewId: string): boolean {
    if (!this.views.has(viewId)) return false
    this.activeViewId = viewId
    return true
  }
}

// Singleton instance
export const browserViewManager = new BrowserViewManager()
