/**
 * BrowserViewer - Embedded browser component using Electron BrowserView
 *
 * This component provides a true browser experience within the Content Canvas,
 * featuring:
 * - Full Chromium rendering (same as Chrome)
 * - Navigation controls (back, forward, reload)
 * - Address bar with smart URL/search detection (Bing search)
 * - Loading indicators
 * - Screenshot capture (for AI vision)
 * - AI operation indicator when AI is controlling the browser
 * - Native context menu for zoom and DevTools (uses Electron Menu)
 * - Page zoom controls via native menu
 *
 * The actual browser rendering is done by Electron's BrowserView in the main
 * process. This component manages the UI chrome and delegates lifecycle
 * management to CanvasLifecycle.
 *
 * IMPORTANT: BrowserView lifecycle (create, show, hide, destroy) is managed
 * by CanvasLifecycle, NOT by this component's useEffects.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Home,
  Lock,
  Unlock,
  Camera,
  Globe,
  ExternalLink,
  Bot,
  MoreVertical,
  Search,
  Save,
  Trash2,
} from 'lucide-react'
import { api } from '../../../api'
import { canvasLifecycle, type TabState, type BrowserState } from '../../../services/canvas-lifecycle'
import { useBrowserState } from '../../../hooks/useCanvasLifecycle'
import { useAIBrowserStore } from '../../../stores/ai-browser.store'
import { useSpaceStore } from '../../../stores/space.store'
import { useSkillsStore } from '../../../stores/skills.store'
import { useTranslation } from '../../../i18n'

interface BrowserViewerProps {
  tab: TabState
}

// Default home page and search engine
const DEFAULT_HOME_URL = 'https://www.bing.com'
const SEARCH_ENGINE_URL = 'https://www.bing.com/search?q='

interface SemanticTarget {
  role?: string
  name?: string
  text?: string
  label?: string
  placeholder?: string
  urlPattern?: string
}

interface SopRecordedStep {
  id: string
  action: 'navigate' | 'click' | 'fill' | 'select' | 'press_key' | 'wait_for'
  target?: SemanticTarget
  value?: string
  assertion?: string
  retries: number
}

interface SopRecordingState {
  viewId: string
  isRecording: boolean
  startedAt: number | null
  steps: SopRecordedStep[]
}

interface SopRecordingEventPayload {
  type: 'state' | 'step'
  viewId: string
  state?: SopRecordingState
  step?: SopRecordedStep
}

function normalizeSkillName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/]/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^-+|-+$/g, '')
}

function suggestSkillName(title: string | undefined): string {
  const normalized = normalizeSkillName(title || '')
  return normalized || 'browser-sop'
}

function formatSemanticTarget(target?: SemanticTarget): string {
  if (!target) return 'N/A'
  return (
    target.name ||
    target.text ||
    target.label ||
    target.placeholder ||
    target.urlPattern ||
    target.role ||
    'N/A'
  )
}

/**
 * Check if input is a valid URL or should be treated as search query
 */
function isValidUrl(input: string): boolean {
  // Common URL patterns
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://')) {
    return true
  }

  // Check for domain-like patterns (e.g., "google.com", "localhost:3000")
  const domainPattern = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z]{2,}|:\d+)/
  if (domainPattern.test(input)) {
    return true
  }

  // Localhost without port
  if (input === 'localhost' || input.startsWith('localhost/')) {
    return true
  }

  return false
}

/**
 * Convert input to URL - either validates URL or creates search URL
 */
function inputToUrl(input: string): string {
  const trimmed = input.trim()

  if (!trimmed) return DEFAULT_HOME_URL

  // Already a full URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) {
    return trimmed
  }

  // Looks like a URL, add https://
  if (isValidUrl(trimmed)) {
    return `https://${trimmed}`
  }

  // Treat as search query
  return `${SEARCH_ENGINE_URL}${encodeURIComponent(trimmed)}`
}

export function BrowserViewer({ tab }: BrowserViewerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeRafRef = useRef<number | null>(null)
  const lastBoundsRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null)
  const [addressBarValue, setAddressBarValue] = useState(tab.url || '')
  const [isAddressBarFocused, setIsAddressBarFocused] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [sopState, setSopState] = useState<SopRecordingState>({
    viewId: tab.browserViewId || '',
    isRecording: false,
    startedAt: null,
    steps: [],
  })
  const [showSopPanel, setShowSopPanel] = useState(false)
  const [editableSteps, setEditableSteps] = useState<SopRecordedStep[]>([])
  const [sopSkillName, setSopSkillName] = useState(suggestSkillName(tab.title))
  const [sopSkillDescription, setSopSkillDescription] = useState('')
  const [isSavingSopSkill, setIsSavingSopSkill] = useState(false)
  const [lastSavedSopSkillPath, setLastSavedSopSkillPath] = useState('')
  const [lastSavedSopSkillName, setLastSavedSopSkillName] = useState('')
  const { currentSpace, spaces } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    spaces: state.spaces
  }))
  const loadSkills = useSkillsStore((state) => state.loadSkills)
  const resolvedWorkDir = useMemo(() => {
    if (tab.workDir && tab.workDir.trim()) return tab.workDir
    if (tab.spaceId) {
      if (currentSpace?.id === tab.spaceId && currentSpace.path) {
        return currentSpace.path
      }
      const matchedSpace = spaces.find((space) => space.id === tab.spaceId)
      if (matchedSpace?.path) return matchedSpace.path
      return undefined
    }
    return currentSpace?.path
  }, [currentSpace?.id, currentSpace?.path, spaces, tab.spaceId, tab.workDir])

  // PDF mode: simplified UI without navigation controls
  const isPdf = tab.type === 'pdf'

  // Get browser state from lifecycle manager via hook
  const browserState = useBrowserState(tab.id)

  // AI Browser state - detect if AI is operating this browser
  const isAIOperating = useAIBrowserStore(state => state.isOperating)
  const aiActiveUrl = useAIBrowserStore(state => state.activeUrl)

  // Determine if this browser is the one AI is currently operating
  const isThisAIBrowser = (() => {
    if (!isAIOperating || !aiActiveUrl || !tab.url) return false
    if (tab.title?.includes('🤖')) return true
    try {
      const aiHostname = new URL(aiActiveUrl).hostname
      return tab.url.includes(aiHostname)
    } catch {
      return false
    }
  })()

  // ============================================
  // Container Bounds Registration
  // ============================================

  // Register container bounds getter with CanvasLifecycle
  // This allows CanvasLifecycle to position BrowserViews correctly
  useEffect(() => {
    const getBounds = () => containerRef.current?.getBoundingClientRect() || null
    canvasLifecycle.setContainerBoundsGetter(getBounds)

    // When container becomes available, ensure BrowserView is shown
    // This handles the case where the BrowserView was created before this
    // component mounted (e.g., switching from a non-browser tab to a new browser tab)
    if (containerRef.current && tab.browserViewId) {
      // Use ensureActiveBrowserViewShown instead of updateActiveBounds
      // because the view may not have been added to the window yet
      canvasLifecycle.ensureActiveBrowserViewShown()
    }
  }, [tab.browserViewId])

  // ============================================
  // Resize Observer
  // ============================================

  // Monitor container geometry changes and update BrowserView bounds
  useEffect(() => {
    if (!containerRef.current) return

    const syncBounds = () => {
      if (!tab.browserViewId) return
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const nextBounds = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      const previous = lastBoundsRef.current
      if (
        previous &&
        previous.left === nextBounds.left &&
        previous.top === nextBounds.top &&
        previous.width === nextBounds.width &&
        previous.height === nextBounds.height
      ) {
        return
      }
      lastBoundsRef.current = nextBounds

      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        canvasLifecycle.updateActiveBounds()
        resizeRafRef.current = null
      })
    }

    lastBoundsRef.current = null
    const resizeObserver = new ResizeObserver(() => {
      syncBounds()
    })

    resizeObserver.observe(containerRef.current)
    window.addEventListener('resize', syncBounds)
    window.addEventListener('scroll', syncBounds, true)
    syncBounds()

    return () => {
      window.removeEventListener('resize', syncBounds)
      window.removeEventListener('scroll', syncBounds, true)
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      resizeObserver.disconnect()
    }
  }, [tab.browserViewId])

  // ============================================
  // Address Bar Sync
  // ============================================

  // Sync address bar with tab URL when URL changes (and not focused)
  useEffect(() => {
    if (!isAddressBarFocused && tab.url) {
      setAddressBarValue(tab.url)
    }
  }, [tab.url, isAddressBarFocused])

  // ============================================
  // Navigation Handlers
  // ============================================

  const handleNavigate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tab.browserViewId) return

    const url = inputToUrl(addressBarValue)
    await api.navigateBrowserView(tab.browserViewId, url)
  }, [tab.browserViewId, addressBarValue])

  const handleBack = useCallback(async () => {
    if (tab.browserViewId && browserState.canGoBack) {
      await api.browserGoBack(tab.browserViewId)
    }
  }, [tab.browserViewId, browserState.canGoBack])

  const handleForward = useCallback(async () => {
    if (tab.browserViewId && browserState.canGoForward) {
      await api.browserGoForward(tab.browserViewId)
    }
  }, [tab.browserViewId, browserState.canGoForward])

  const handleReload = useCallback(async () => {
    if (!tab.browserViewId) return

    if (browserState.isLoading) {
      await api.browserStop(tab.browserViewId)
    } else {
      await api.browserReload(tab.browserViewId)
    }
  }, [tab.browserViewId, browserState.isLoading])

  const handleHome = useCallback(async () => {
    if (tab.browserViewId) {
      await api.navigateBrowserView(tab.browserViewId, DEFAULT_HOME_URL)
    }
  }, [tab.browserViewId])

  const handleCapture = useCallback(async () => {
    if (!tab.browserViewId) return

    const result = await api.captureBrowserView(tab.browserViewId)
    if (result.success && result.data) {
      console.log('[BrowserViewer] Screenshot captured')
    }
  }, [tab.browserViewId])

  const handleOpenExternal = useCallback(async () => {
    // For PDF, open with system default app; for browser, open URL in external browser
    if (isPdf && tab.path) {
      await api.openArtifact(tab.path)
    } else if (tab.url) {
      window.open(tab.url, '_blank')
    }
  }, [isPdf, tab.path, tab.url])

  // ============================================
  // Address Bar Handlers
  // ============================================

  const handleAddressBarFocus = useCallback(() => {
    setIsAddressBarFocused(true)
  }, [])

  const handleAddressBarBlur = useCallback(() => {
    setIsAddressBarFocused(false)
    // Reset to current URL if unchanged
    if (tab.url) {
      setAddressBarValue(tab.url)
    }
  }, [tab.url])

  const handleAddressBarKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (tab.url) {
        setAddressBarValue(tab.url)
      }
      ;(e.target as HTMLInputElement).blur()
    }
  }, [tab.url])

  // ============================================
  // Native Menu Handler
  // ============================================

  // Show native context menu (renders above BrowserView)
  const handleShowMenu = useCallback(async () => {
    if (!tab.browserViewId) return
    await api.showBrowserContextMenu({
      viewId: tab.browserViewId,
      url: tab.url,
      zoomLevel
    })
  }, [tab.browserViewId, tab.url, zoomLevel])

  // Listen for zoom changes from native menu
  useEffect(() => {
    const unsubscribe = api.onBrowserZoomChanged((data) => {
      if (data.viewId === tab.browserViewId) {
        setZoomLevel(data.zoomLevel)
      }
    })
    return unsubscribe
  }, [tab.browserViewId])

  useEffect(() => {
    if (!tab.browserViewId) return

    let active = true
    const syncState = async () => {
      const result = await api.getBrowserSopRecordingState(tab.browserViewId!)
      if (!active || !result.success || !result.data) return
      const nextState = result.data as SopRecordingState
      setSopState(nextState)
      setEditableSteps(nextState.steps || [])
    }

    void syncState()

    const unsubscribe = api.onBrowserSopRecordingEvent((data) => {
      const payload = data as SopRecordingEventPayload
      if (payload.viewId !== tab.browserViewId) return
      if (payload.type === 'state' && payload.state) {
        setSopState(payload.state)
        setEditableSteps(payload.state.steps || [])
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [tab.browserViewId])

  useEffect(() => {
    if (!sopSkillName || sopSkillName === 'browser-sop') {
      setSopSkillName(suggestSkillName(tab.title))
    }
  }, [tab.title, sopSkillName])

  const handleStartSopRecording = useCallback(async () => {
    if (!tab.browserViewId) return
    const result = await api.startBrowserSopRecording(tab.browserViewId)
    if (!result.success) {
      alert(result.error || t('Failed to start recording'))
      return
    }
    const state = result.data as SopRecordingState
    setSopState(state)
    setEditableSteps(state.steps || [])
    setShowSopPanel(true)
  }, [tab.browserViewId, t])

  const handleStopSopRecording = useCallback(async () => {
    if (!tab.browserViewId) return
    const result = await api.stopBrowserSopRecording(tab.browserViewId)
    if (!result.success) {
      alert(result.error || t('Failed to stop recording'))
      return
    }
    const state = result.data as SopRecordingState
    setSopState(state)
    setEditableSteps(state.steps || [])
    setShowSopPanel(true)
  }, [tab.browserViewId, t])

  const handleClearSopRecording = useCallback(async () => {
    if (!tab.browserViewId) return
    const result = await api.clearBrowserSopRecording(tab.browserViewId)
    if (!result.success) {
      alert(result.error || t('Failed to clear recording'))
      return
    }
    const state = result.data as SopRecordingState
    setSopState(state)
    setEditableSteps(state.steps || [])
  }, [tab.browserViewId, t])

  const handleDeleteRecordedStep = useCallback((stepId: string) => {
    setEditableSteps((prev) => prev.filter((step) => step.id !== stepId))
  }, [])

  const handleStepValueChange = useCallback((stepId: string, value: string) => {
    setEditableSteps((prev) =>
      prev.map((step) =>
        step.id === stepId
          ? {
            ...step,
            value,
          }
          : step
      )
    )
  }, [])

  const handleSaveSopSkill = useCallback(async () => {
    const workDir = resolvedWorkDir
    if (!workDir) {
      alert(t('No active workspace path found'))
      return
    }

    const skillName = normalizeSkillName(sopSkillName || suggestSkillName(tab.title))
    if (!skillName) {
      alert(t('Skill name is required'))
      return
    }

    if (editableSteps.length === 0) {
      alert(t('No recorded steps to save'))
      return
    }

    const steps = editableSteps.map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      retries: Number.isFinite(step.retries) && step.retries > 0 ? step.retries : 3,
    }))

    setIsSavingSopSkill(true)
    try {
      const result = await api.saveSopSkill({
        workDir,
        skillName,
        description: sopSkillDescription.trim() || undefined,
        sopSpec: {
          version: '1.0',
          name: skillName,
          steps,
          meta: {
            source: 'browser_view_recording',
            browserViewId: tab.browserViewId,
            recordedUrl: tab.url || '',
            updatedAt: new Date().toISOString(),
          },
        },
      })
      if (!result.success) {
        alert(result.error || t('Failed to save SOP skill'))
        return
      }
      await api.refreshSkillsIndex(workDir)
      await loadSkills(workDir)
      const savedPath = (result.data as { skillPath?: string } | undefined)?.skillPath || ''
      const finalSavedPath = savedPath || `${workDir}/.claude/skills/${skillName}/SKILL.md`
      setLastSavedSopSkillPath(finalSavedPath)
      setLastSavedSopSkillName(skillName)
      alert(
        t('SOP skill saved. Use /{{name}} in chat.\nPath: {{path}}', {
          name: skillName,
          path: finalSavedPath,
        })
      )
    } finally {
      setIsSavingSopSkill(false)
    }
  }, [
    tab.title,
    tab.browserViewId,
    tab.url,
    resolvedWorkDir,
    sopSkillName,
    sopSkillDescription,
    editableSteps,
    loadSkills,
    t,
  ])

  // Check if URL is HTTPS
  const isSecure = tab.url?.startsWith('https://')

  // Check if address bar value looks like a search query
  const isSearchQuery = addressBarValue && !isValidUrl(addressBarValue)

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col h-full bg-background">
      {/* AI Operating Indicator (browser only, not PDF) */}
      {!isPdf && isThisAIBrowser && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/30">
          <div className="relative">
            <Bot size={16} className="text-primary animate-pulse" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-ping" />
          </div>
          <span className="text-xs font-medium text-primary">{t('AI is operating this browser')}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-muted-foreground">{t('Live')}</span>
          </div>
        </div>
      )}

      {/* PDF Toolbar - simplified */}
      {isPdf ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
          <span className="text-sm text-muted-foreground truncate flex-1">
            {tab.title}
          </span>
          <div className="flex items-center gap-0.5">
            {/* Open external button */}
            <button
              onClick={handleOpenExternal}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Open with external application')}
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </button>
            {/* More menu button - triggers native Electron menu */}
            <button
              onClick={handleShowMenu}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('More options (zoom)')}
            >
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      ) : (
        /* Browser Chrome (Toolbar) */
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
          {/* Navigation Buttons */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleBack}
              disabled={!browserState.canGoBack}
              className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t('Back (Alt+←)')}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleForward}
              disabled={!browserState.canGoForward}
              className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t('Forward (Alt+→)')}
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleReload}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={browserState.isLoading ? t('Stop') : t('Reload (Ctrl+R)')}
            >
              {browserState.isLoading ? (
                <X className="w-4 h-4" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleHome}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Home')}
            >
              <Home className="w-4 h-4" />
            </button>
          </div>

          {/* Address Bar */}
          <form onSubmit={handleNavigate} className="flex-1">
            <div
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full
                bg-secondary/50 border transition-colors
                ${isAddressBarFocused
                  ? 'border-primary/50 bg-secondary'
                  : 'border-transparent hover:bg-secondary/80'
                }
              `}
            >
              {/* Security/Search Indicator */}
              {isAddressBarFocused && isSearchQuery ? (
                <Search className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              ) : tab.url ? (
                isSecure ? (
                  <Lock className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                )
              ) : (
                <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}

              <input
                type="text"
                value={addressBarValue}
                onChange={(e) => setAddressBarValue(e.target.value)}
                onFocus={handleAddressBarFocus}
                onBlur={handleAddressBarBlur}
                onKeyDown={handleAddressBarKeyDown}
                placeholder={t('Enter URL or search Bing...')}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                spellCheck={false}
                autoComplete="off"
              />

              {/* Loading Indicator */}
              {browserState.isLoading && (
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
              )}
            </div>
          </form>

          {/* Tool Buttons - Screenshot and External outside, More for native menu */}
          <div className="flex items-center gap-0.5">
            {/* Screenshot button */}
            <button
              onClick={handleCapture}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Screenshot')}
            >
              <Camera className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Open external button */}
            <button
              onClick={handleOpenExternal}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Open in external browser')}
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* More menu button - triggers native Electron menu */}
            <button
              onClick={handleShowMenu}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('More options (zoom, developer tools)')}
            >
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="mx-1 h-4 w-px bg-border" />

            <button
              onClick={sopState.isRecording ? handleStopSopRecording : handleStartSopRecording}
              className={`px-2 py-1.5 rounded text-xs transition-colors ${
                sopState.isRecording
                  ? 'bg-red-500/15 text-red-500 hover:bg-red-500/20'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={sopState.isRecording ? t('Stop SOP recording') : t('Start SOP recording')}
            >
              {sopState.isRecording ? t('Stop') : t('Record SOP')}
            </button>

            <button
              onClick={() => setShowSopPanel((prev) => !prev)}
              className="px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-secondary transition-colors"
              title={t('Toggle SOP panel')}
            >
              {showSopPanel ? t('Hide SOP') : t('Show SOP')}
            </button>
          </div>
        </div>
      )}

      {!isPdf && showSopPanel && (
        <div className="border-b border-border bg-background/70 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {sopState.isRecording ? t('Recording...') : t('Recording stopped')}
            </span>
            <span>{t('Steps')}: {editableSteps.length}</span>
            {sopState.startedAt && (
              <span>{new Date(sopState.startedAt).toLocaleTimeString()}</span>
            )}
            <div className="flex-1" />
            <button
              onClick={handleClearSopRecording}
              className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary transition-colors"
              title={t('Clear recording')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('Clear')}
            </button>
          </div>
          <div className="text-xs text-muted-foreground">
            {t('Workspace')}: {resolvedWorkDir || t('Not resolved')}
          </div>

          <div className="max-h-44 overflow-auto space-y-2 pr-1">
            {editableSteps.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t('No recorded steps yet. Start recording and operate the page.')}
              </div>
            ) : (
              editableSteps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded border border-border/60 bg-card/50 p-2 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary font-medium">
                      {index + 1}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-primary font-medium">
                      {step.action}
                    </span>
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {formatSemanticTarget(step.target)}
                    </span>
                    <button
                      onClick={() => handleDeleteRecordedStep(step.id)}
                      className="p-1 rounded hover:bg-secondary transition-colors"
                      title={t('Delete step')}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>

                  {(step.action === 'fill' || step.action === 'select' || step.action === 'press_key' || step.action === 'navigate') && (
                    <input
                      value={step.value || ''}
                      onChange={(event) => handleStepValueChange(step.id, event.target.value)}
                      placeholder={t('Step value')}
                      className="w-full h-7 px-2 rounded border border-border bg-background text-xs outline-none focus:border-primary/40"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              value={sopSkillName}
              onChange={(event) => setSopSkillName(event.target.value)}
              placeholder={t('Skill name')}
              className="h-8 px-2 rounded border border-border bg-background text-sm outline-none focus:border-primary/40"
            />
            <input
              value={sopSkillDescription}
              onChange={(event) => setSopSkillDescription(event.target.value)}
              placeholder={t('Description (optional)')}
              className="h-8 px-2 rounded border border-border bg-background text-sm outline-none focus:border-primary/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveSopSkill}
              disabled={isSavingSopSkill || editableSteps.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {isSavingSopSkill ? t('Saving...') : t('Save as Skill')}
            </button>
            <span className="text-xs text-muted-foreground">
              {t('Saved skill can be invoked with /<skill-name>.')}
            </span>
          </div>

          {lastSavedSopSkillPath && (
            <div className="rounded border border-border/60 bg-card/50 px-2 py-1.5 text-xs text-muted-foreground">
              <div>{t('Last saved skill')}: /{lastSavedSopSkillName || sopSkillName}</div>
              <div className="mt-1 break-all font-mono text-[11px]">{lastSavedSopSkillPath}</div>
            </div>
          )}
        </div>
      )}

      {/* Browser Content Area - BrowserView renders here */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-white"
        style={{ minHeight: '200px' }}
      >
        {/* Loading Overlay (only shown during initial load before BrowserView is ready) */}
        {!tab.browserViewId && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">{t('Opening...')}</p>
            </div>
          </div>
        )}

        {/* The actual BrowserView is rendered by Electron main process */}
        {/* This div serves as the positioning target */}
      </div>
    </div>
  )
}

/**
 * Remote Mode Fallback
 * Shows a message when browser features are not available
 */
export function BrowserViewerFallback({ tab }: BrowserViewerProps) {
  const { t } = useTranslation()
  const openExternal = () => {
    if (tab.url) {
      window.open(tab.url, '_blank')
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Globe className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-medium mb-2">{t('Browser features are only available in the desktop client')}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('Please use the built-in browser in the Kite desktop app')}
          </p>
          {tab.url && (
            <button
              onClick={openExternal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {t('Open in new window')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
