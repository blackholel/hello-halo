/**
 * Settings Page - App configuration
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/app.store'
import { api } from '../api'
import type {
  KiteConfig,
  ThemeMode,
  McpServersConfig,
  ApiProfile,
  ProviderProtocol
} from '../types'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, ArrowLeft, Bot, CheckCircle2, ChevronDown, Download, Eye, EyeOff, Info, Network, Palette, RefreshCw, ServerCog, Shield, SlidersHorizontal, X } from 'lucide-react'
import { McpServerList } from '../components/settings/McpServerList'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { ensureAiConfig } from '../../shared/types/ai-profile'
import {
  AI_PROFILE_TEMPLATES,
  isValidAnthropicCompatEndpoint,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  normalizeModelCatalogForDefaultModelChange,
  normalizeProfileForSave
} from '../components/settings/aiProfileDomain'

function createProfileId(seed: string): string {
  const normalized = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'
  const rand = Math.random().toString(36).slice(2, 7)
  return `${normalized}-${Date.now().toString(36)}-${rand}`
}

function toUniqueProfileName(base: string, profiles: ApiProfile[]): string {
  const trimmed = base.trim() || 'Profile'
  if (!profiles.some(profile => profile.name === trimmed)) {
    return trimmed
  }

  let index = 2
  while (profiles.some(profile => profile.name === `${trimmed} ${index}`)) {
    index += 1
  }

  return `${trimmed} ${index}`
}

function selectFirstEnabledProfileId(profiles: ApiProfile[]): string {
  const enabledProfile = profiles.find(profile => profile.enabled !== false)
  return enabledProfile?.id || profiles[0]?.id || ''
}

function ensureTemplateProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const baseProfiles = [...profiles]
  for (const template of AI_PROFILE_TEMPLATES) {
    const exists = baseProfiles.some(
      profile => profile.vendor === template.vendor && profile.protocol === template.protocol
    )
    if (!exists) {
      baseProfiles.push({
        id: createProfileId(template.key),
        name: template.label,
        vendor: template.vendor,
        protocol: template.protocol,
        apiUrl: template.apiUrl,
        apiKey: '',
        defaultModel: template.defaultModel,
        modelCatalog: template.modelCatalog,
        docUrl: template.docUrl,
        enabled: false
      })
    }
  }
  return baseProfiles
}

function getProfileMonogram(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '·'
  const matchedLatin = trimmed.match(/[A-Za-z]/)
  if (matchedLatin?.[0]) return matchedLatin[0].toUpperCase()
  return trimmed[0]
}

const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: 'light', labelKey: 'Light' },
  { value: 'dark', labelKey: 'Dark' }
]

type SettingsSectionId =
  | 'model'
  | 'appearance'
  | 'general'
  | 'permissions'
  | 'mcp'
  | 'network'
  | 'about'

type SettingsSectionGroup = 'required' | 'optional' | 'advanced'

interface SettingsSectionDef {
  id: SettingsSectionId
  group: SettingsSectionGroup
  labelKey: string
  hintKey: string
  icon: LucideIcon
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'model',
    group: 'required',
    labelKey: 'Model',
    hintKey: 'Connect provider and model',
    icon: Bot
  },
  {
    id: 'appearance',
    group: 'optional',
    labelKey: 'Appearance',
    hintKey: 'Adjust theme and language',
    icon: Palette
  },
  {
    id: 'general',
    group: 'optional',
    labelKey: 'General',
    hintKey: 'Tune app behavior',
    icon: SlidersHorizontal
  },
  {
    id: 'permissions',
    group: 'advanced',
    labelKey: 'Permissions',
    hintKey: 'Review execution trust',
    icon: Shield
  },
  {
    id: 'mcp',
    group: 'advanced',
    labelKey: 'MCP',
    hintKey: 'Manage tool servers',
    icon: ServerCog
  },
  {
    id: 'network',
    group: 'optional',
    labelKey: 'Network',
    hintKey: 'Enable remote access',
    icon: Network
  },
  {
    id: 'about',
    group: 'advanced',
    labelKey: 'About',
    hintKey: 'Check version and updates',
    icon: Info
  }
]

const SETTINGS_SECTION_GROUPS: Array<{ id: SettingsSectionGroup; labelKey: string }> = [
  { id: 'required', labelKey: 'Must configure' },
  { id: 'optional', labelKey: 'Optional enhancements' },
  { id: 'advanced', labelKey: 'Advanced tools' }
]

// Apple-style toggle component (extracted to top-level to avoid re-creation on every render)
function AppleToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`toggle-apple ${checked ? 'toggle-apple-on' : 'toggle-apple-off'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
    >
      <div className="toggle-apple-knob" />
    </button>
  )
}

// Remote access status type
interface RemoteAccessStatus {
  enabled: boolean
  server: {
    running: boolean
    port: number
    token: string | null
    localUrl: string | null
    lanUrl: string | null
  }
  tunnel: {
    status: 'stopped' | 'starting' | 'running' | 'error'
    url: string | null
    error: string | null
  }
  clients: number
}

interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
  currentVersion: string
  latestVersion?: string | null
  checkTime?: string | null
  message?: string
  downloadSource?: 'github' | 'baidu' | null
  downloadUrl?: string | null
  baiduExtractCode?: string | null
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { config, setConfig, goBack } = useAppStore()

  const initialAiConfig = ensureAiConfig(config?.ai, config?.api)
  const [profiles, setProfiles] = useState<ApiProfile[]>(ensureTemplateProfiles(initialAiConfig.profiles))
  const [defaultProfileId, setDefaultProfileId] = useState(initialAiConfig.defaultProfileId)
  const [selectedProfileId, setSelectedProfileId] = useState(initialAiConfig.defaultProfileId)
  const [theme, setTheme] = useState<ThemeMode>(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('model')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState('')
  const [showAdvancedModelFields, setShowAdvancedModelFields] = useState(false)
  const [expandedModelStep, setExpandedModelStep] = useState<'protocol' | 'api' | 'model'>('api')

  // Connection status
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    message?: string
  } | null>(null)

  // Remote access state
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null)
  const [isEnablingRemote, setIsEnablingRemote] = useState(false)
  const [isEnablingTunnel, setIsEnablingTunnel] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // System settings state
  const [autoLaunch, setAutoLaunch] = useState(config?.system?.autoLaunch || false)
  const [minimizeToTray, setMinimizeToTray] = useState(config?.system?.minimizeToTray || false)

  // Updater state (About section)
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId) || null
  const selectedCatalog = selectedProfile
    ? normalizeModelCatalog(selectedProfile.defaultModel, selectedProfile.modelCatalog)
    : []
  const selectedProfileUrlError = (() => {
    if (!selectedProfile) return null
    const apiUrl = selectedProfile.apiUrl.trim()
    if (!apiUrl) return null
    if (selectedProfile.protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(apiUrl)) {
      return t('URL must end with /chat/completions or /responses')
    }
    if (selectedProfile.protocol === 'anthropic_compat' && !isValidAnthropicCompatEndpoint(apiUrl)) {
      return t('Anthropic compatible URL should not end with /chat/completions or /responses')
    }
    return null
  })()
  const selectedProfileUrlInvalid = Boolean(selectedProfileUrlError)

  // Load remote access status
  useEffect(() => {
    loadRemoteStatus()

    // Listen for status changes
    const unsubscribe = api.onRemoteStatusChange((data) => {
      setRemoteStatus(data as RemoteAccessStatus)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const nextAiConfig = ensureAiConfig(config?.ai, config?.api)
    setProfiles(ensureTemplateProfiles(nextAiConfig.profiles))
    setDefaultProfileId(nextAiConfig.defaultProfileId)
    setSelectedProfileId((prev) => {
      if (nextAiConfig.profiles.some(profile => profile.id === prev)) {
        return prev
      }
      return nextAiConfig.defaultProfileId
    })
  }, [config?.ai, config?.api])

  useEffect(() => {
    setShowApiKey(false)
    setModelInput('')
    setShowAdvancedModelFields(false)
    setExpandedModelStep('api')
  }, [selectedProfileId])

  useEffect(() => {
    setTheme(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
  }, [config?.appearance?.theme])

  // Load system settings
  useEffect(() => {
    loadSystemSettings()
  }, [])

  useEffect(() => {
    if (api.isRemoteMode()) return

    void loadUpdaterState()
    const unsubscribe = api.onUpdaterStatus((data) => {
      const nextState = data as UpdaterState
      setUpdaterState(nextState)
      setIsCheckingUpdate(nextState.status === 'checking')
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const loadSystemSettings = async () => {
    try {
      const [autoLaunchRes, minimizeRes] = await Promise.all([
        api.getAutoLaunch(),
        api.getMinimizeToTray()
      ])
      if (autoLaunchRes.success) {
        setAutoLaunch(autoLaunchRes.data as boolean)
      }
      if (minimizeRes.success) {
        setMinimizeToTray(minimizeRes.data as boolean)
      }
    } catch (error) {
      console.error('[Settings] Failed to load system settings:', error)
    }
  }

  const loadUpdaterState = async () => {
    try {
      const response = await api.getUpdaterState()
      if (response.success && response.data) {
        const nextState = response.data as UpdaterState
        setUpdaterState(nextState)
        setIsCheckingUpdate(nextState.status === 'checking')
      }
    } catch (error) {
      console.error('[Settings] Failed to load updater state:', error)
    }
  }

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true)
    try {
      await api.checkForUpdates()
    } catch (error) {
      console.error('[Settings] Failed to check updates:', error)
      setIsCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async () => {
    const version = updaterState?.latestVersion || updaterState?.currentVersion
    if (!version) return
    const targetUrl = updaterState?.downloadUrl || `https://github.com/blackholel/buddykite/releases/tag/v${version}`
    await api.openExternal(targetUrl)
  }

  // Load QR code when remote is enabled
  useEffect(() => {
    if (remoteStatus?.enabled) {
      loadQRCode()
    } else {
      setQrCode(null)
    }
  }, [remoteStatus?.enabled, remoteStatus?.tunnel.url])

  const loadRemoteStatus = async () => {
    console.log('[Settings] loadRemoteStatus called')
    try {
      const response = await api.getRemoteStatus()
      console.log('[Settings] getRemoteStatus response:', response)
      if (response.success && response.data) {
        setRemoteStatus(response.data as RemoteAccessStatus)
      }
    } catch (error) {
      console.error('[Settings] loadRemoteStatus error:', error)
    }
  }

  const loadQRCode = async () => {
    const response = await api.getRemoteQRCode(true) // Include token
    if (response.success && response.data) {
      setQrCode((response.data as any).qrCode)
    }
  }

  const handleToggleRemote = async () => {
    console.log('[Settings] handleToggleRemote called, current status:', remoteStatus?.enabled)

    if (remoteStatus?.enabled) {
      // Disable
      console.log('[Settings] Disabling remote access...')
      const response = await api.disableRemoteAccess()
      console.log('[Settings] Disable response:', response)
      setRemoteStatus(null)
      setQrCode(null)
    } else {
      // Enable
      console.log('[Settings] Enabling remote access...')
      setIsEnablingRemote(true)
      try {
        const response = await api.enableRemoteAccess()
        console.log('[Settings] Enable response:', response)
        if (response.success && response.data) {
          setRemoteStatus(response.data as RemoteAccessStatus)
        } else {
          console.error('[Settings] Enable failed:', response.error)
        }
      } catch (error) {
        console.error('[Settings] Enable error:', error)
      } finally {
        setIsEnablingRemote(false)
      }
    }
  }

  const handleToggleTunnel = async () => {
    if (remoteStatus?.tunnel.status === 'running') {
      // Disable tunnel
      await api.disableTunnel()
    } else {
      // Enable tunnel
      setIsEnablingTunnel(true)
      try {
        await api.enableTunnel()
      } finally {
        setIsEnablingTunnel(false)
      }
    }
    loadRemoteStatus()
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleThemeChange = async (nextTheme: ThemeMode) => {
    setTheme(nextTheme)

    try {
      localStorage.setItem('kite-theme', nextTheme)
    } catch {
      // ignore
    }

    try {
      await api.setConfig({ appearance: { theme: nextTheme } })
      if (config) {
        setConfig({
          ...config,
          appearance: { ...config.appearance, theme: nextTheme }
        } as KiteConfig)
      }
    } catch (error) {
      console.error('[Settings] Failed to save theme:', error)
      setTheme(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
    }
  }

  const handleLanguageChange = (locale: LocaleCode) => {
    setLanguage(locale)
  }

  // Handle auto launch change
  const handleAutoLaunchChange = async (enabled: boolean) => {
    setAutoLaunch(enabled)
    try {
      await api.setAutoLaunch(enabled)
    } catch (error) {
      console.error('[Settings] Failed to set auto launch:', error)
      setAutoLaunch(!enabled) // Revert on error
    }
  }

  // Handle minimize to tray change
  const handleMinimizeToTrayChange = async (enabled: boolean) => {
    setMinimizeToTray(enabled)
    try {
      await api.setMinimizeToTray(enabled)
    } catch (error) {
      console.error('[Settings] Failed to set minimize to tray:', error)
      setMinimizeToTray(!enabled) // Revert on error
    }
  }

  // Handle MCP servers save
  const handleMcpServersSave = async (servers: McpServersConfig) => {
    await api.setConfig({ mcpServers: servers })
    setConfig({ ...config, mcpServers: servers } as KiteConfig)
  }

  const updateSelectedProfile = (updates: Partial<ApiProfile>) => {
    if (!selectedProfileId) return

    setProfiles(prevProfiles =>
      prevProfiles.map(profile =>
        profile.id === selectedProfileId
          ? {
              ...profile,
              ...updates
            }
          : profile
      )
    )
  }

  const handleSelectedProfileEnabledChange = (enabled: boolean) => {
    if (!selectedProfile) return

    const nextProfiles = profiles.map(profile =>
      profile.id === selectedProfile.id
        ? {
            ...profile,
            enabled
          }
        : profile
    )
    setProfiles(nextProfiles)

    if (!enabled && selectedProfile.id === defaultProfileId) {
      setDefaultProfileId(selectFirstEnabledProfileId(nextProfiles))
    }
  }

  const handleProtocolChange = (protocol: ProviderProtocol) => {
    updateSelectedProfile({ protocol })
    setValidationResult(null)
  }

  const handleAddModelId = () => {
    if (!selectedProfile) return
    const normalizedModel = modelInput.trim()
    if (!normalizedModel) return
    updateSelectedProfile({
      modelCatalog: normalizeModelCatalog(selectedProfile.defaultModel, [...selectedCatalog, normalizedModel])
    })
    setModelInput('')
    setValidationResult(null)
  }

  const handleAddProfileFromTemplate = () => {
    const template = AI_PROFILE_TEMPLATES.find(item =>
      !profiles.some(profile => profile.vendor === item.vendor && profile.protocol === item.protocol)
    )
    if (!template) return

    const profileName = toUniqueProfileName(template.label, profiles)
    const profileId = createProfileId(template.key)
    const nextProfile: ApiProfile = {
      id: profileId,
      name: profileName,
      apiKey: '',
      enabled: true,
      vendor: template.vendor,
      protocol: template.protocol,
      apiUrl: template.apiUrl,
      defaultModel: template.defaultModel,
      modelCatalog: template.modelCatalog,
      docUrl: template.docUrl
    }

    setProfiles(prevProfiles => [...prevProfiles, nextProfile])
    setSelectedProfileId(profileId)
    if (!defaultProfileId) {
      setDefaultProfileId(profileId)
    }
    setValidationResult(null)
  }

  const handleRemoveSelectedProfile = () => {
    if (!selectedProfile) return
    if (profiles.length <= 1) return

    const nextProfiles = profiles.filter(profile => profile.id !== selectedProfile.id)
    const nextSelected = nextProfiles[0]?.id || ''
    const nextDefault =
      selectedProfile.id === defaultProfileId
        ? nextSelected
        : defaultProfileId

    setProfiles(nextProfiles)
    setSelectedProfileId(nextSelected)
    setDefaultProfileId(nextDefault)
    setValidationResult(null)
  }

  const parseValidationResult = (response: { success: boolean; data?: unknown; error?: string }) => {
    const data = response.data as { valid?: boolean; message?: string } | undefined
    const valid = typeof data?.valid === 'boolean' ? data.valid : response.success
    const message = data?.message || response.error
    return { valid, message }
  }

  const handleValidateConnection = async () => {
    if (!selectedProfile) return

    if (selectedProfile.enabled !== false && !selectedProfile.apiKey.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API Key') })
      return
    }

    if (selectedProfile.protocol !== 'anthropic_official' && !selectedProfile.apiUrl.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API URL') })
      return
    }

    if (selectedProfileUrlInvalid) {
      setValidationResult({ valid: false, message: selectedProfileUrlError || t('Please enter API URL') })
      return
    }

    setIsValidating(true)
    setValidationResult(null)
    const validateStartedAt = Date.now()

    try {
      let response = await api.validateApi(
        selectedProfile.apiKey.trim(),
        selectedProfile.apiUrl.trim(),
        selectedProfile.protocol,
        selectedProfile.defaultModel.trim()
      )
      let parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })

      // Backward compatibility: old backends only understand provider=openai for OpenAI-compatible validation.
      if (!parsed.valid && selectedProfile.protocol === 'openai_compat') {
        response = await api.validateApi(
          selectedProfile.apiKey.trim(),
          selectedProfile.apiUrl.trim(),
          'openai',
          selectedProfile.defaultModel.trim()
        )
        parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })
      }

      // 成功时保留最小加载时长，避免“瞬间闪过”导致反馈不明显。
      if (parsed.valid) {
        const SUCCESS_MIN_DURATION_MS = 900
        const elapsed = Date.now() - validateStartedAt
        if (elapsed < SUCCESS_MIN_DURATION_MS) {
          await new Promise(resolve => setTimeout(resolve, SUCCESS_MIN_DURATION_MS - elapsed))
        }
      }

      setValidationResult({
        valid: parsed.valid,
        message: parsed.valid ? t('Connection successful') : (parsed.message || t('Connection failed'))
      })
    } catch (error) {
      setValidationResult({ valid: false, message: t('Connection failed') })
    } finally {
      setIsValidating(false)
    }
  }

  const handleSave = async () => {
    if (profiles.length === 0) {
      setValidationResult({ valid: false, message: t('Please create at least one profile') })
      return
    }

    if (!selectedProfile) {
      setValidationResult({ valid: false, message: t('Please select a profile') })
      return
    }

    if (!selectedProfile.apiKey.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API Key') })
      return
    }

    if (selectedProfile.protocol !== 'anthropic_official' && !selectedProfile.apiUrl.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API URL') })
      return
    }

    if (selectedProfileUrlInvalid) {
      setValidationResult({ valid: false, message: selectedProfileUrlError || t('Please enter API URL') })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const normalizedProfiles = profiles.map(normalizeProfileForSave)

      const normalizedDefaultProfileId =
        (() => {
          const selectedDefault = normalizedProfiles.find(profile => profile.id === defaultProfileId)
          if (selectedDefault && selectedDefault.enabled !== false) {
            return selectedDefault.id
          }
          return selectFirstEnabledProfileId(normalizedProfiles)
        })()

      const aiConfig = {
        profiles: normalizedProfiles,
        defaultProfileId: normalizedDefaultProfileId
      }

      await api.setConfig({ ai: aiConfig })
      const nextConfig = {
        ...config,
        ai: aiConfig
      } as KiteConfig
      setConfig(nextConfig)
      setValidationResult({ valid: true, message: t('Model connected, you can start chatting') })
    } catch (error) {
      setValidationResult({ valid: false, message: t('Save failed') })
    } finally {
      setIsValidating(false)
    }
  }

  const currentLanguage = getCurrentLanguage()
  const localeEntries = Object.entries(SUPPORTED_LOCALES) as [LocaleCode, string][]
  const activeSectionMeta = SETTINGS_SECTIONS.find(section => section.id === activeSection) || SETTINGS_SECTIONS[0]
  const groupedSections = SETTINGS_SECTION_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  }))
  const formatCheckTime = (value?: string | null): string => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
  }

  const getUpdateStatusLabel = (): string => {
    if (!updaterState) return '-'
    if (updaterState.status === 'checking' || isCheckingUpdate) return t('Checking for updates...')
    if (updaterState.status === 'available') return t('Update available')
    if (updaterState.status === 'not-available') return t('Already up to date')
    if (updaterState.status === 'error') return t('Update check failed')
    return updaterState.message || '-'
  }

  const renderModelSection = () => {
    const hasProfile = Boolean(selectedProfile)
    const hasApiKey = Boolean(selectedProfile?.apiKey.trim())
    const requiresApiUrl = selectedProfile?.protocol !== 'anthropic_official'
    const hasApiUrl = !requiresApiUrl || Boolean(selectedProfile?.apiUrl.trim())
    const hasDefaultModel = Boolean(selectedProfile?.defaultModel.trim())
    const protocolReady = hasProfile
    const apiReady = hasApiKey && hasApiUrl
    const modelReady = hasDefaultModel
    const completedSteps = [hasProfile, hasApiKey && hasApiUrl, hasDefaultModel].filter(Boolean).length
    const canTestConnection = Boolean(
      selectedProfile &&
      selectedProfile.enabled !== false &&
      hasApiKey &&
      hasApiUrl &&
      !selectedProfileUrlInvalid
    )
    const canSaveModel = Boolean(
      selectedProfile &&
      !selectedProfileUrlInvalid &&
      (selectedProfile.enabled === false || hasApiKey)
    )

    return (
      <section className="settings-modal-card settings-model-shell">
        <div className="settings-model-layout">
          <aside className="settings-model-sidebar">
            <section className="settings-quick-card">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t('Quick setup for beginners')}</p>
              <h4 className="mt-2 text-base font-semibold">{t('Model setup')}</h4>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2">
                <span className="text-xs text-muted-foreground">{t('Start in 3 simple steps')}</span>
                <span className="text-sm font-semibold">{completedSteps}/3</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">1 · {t('Protocol')}</span>
                <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">2 · API</span>
                <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">3 · {t('Default Model')}</span>
              </div>
            </section>

            <section className="settings-profile-card">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{t('Vendor')}</label>
                <button
                  type="button"
                  onClick={handleAddProfileFromTemplate}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xl leading-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  title={t('Add Profile')}
                >
                  +
                </button>
              </div>
              <div className="space-y-1.5">
                {profiles.map((profile) => {
                  const selected = profile.id === selectedProfileId
                  const enabled = profile.enabled !== false
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        setSelectedProfileId(profile.id)
                        setValidationResult(null)
                      }}
                      className={`settings-profile-item ${selected ? 'settings-profile-item-active' : ''}`}
                    >
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                        {getProfileMonogram(profile.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {enabled ? t('Enabled') : t('Disabled')}
                        </p>
                      </div>
                      <div className={`h-2 w-2 rounded-full ${enabled ? 'bg-kite-success' : 'bg-muted-foreground/40'}`} />
                    </button>
                  )
                })}
              </div>
            </section>
          </aside>

          <section className="settings-model-content">
            {!selectedProfile ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                {t('Please create or select a profile')}
              </div>
            ) : (
              <div className="space-y-4">
                <section className="settings-step-card">
                  <div className="settings-step-head">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t('Current profile')}</p>
                      <h3 className="mt-1 text-xl font-semibold">{selectedProfile.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedProfile.enabled !== false ? 'bg-kite-success/15 text-kite-success' : 'bg-secondary text-muted-foreground'}`}>
                        {selectedProfile.enabled !== false ? t('Enabled') : t('Disabled')}
                      </span>
                      <AppleToggle
                        checked={selectedProfile.enabled !== false}
                        onChange={handleSelectedProfileEnabledChange}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t('Complete model setup before chatting')}</p>
                </section>

                <section className={`settings-step-card ${expandedModelStep !== 'protocol' ? 'settings-step-card-collapsed' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedModelStep('protocol')}
                    className="settings-step-toggle"
                  >
                    <div className="settings-step-toggle-left">
                      <h4 className="text-sm font-semibold">1. {t('Protocol')}</h4>
                      <span className="settings-step-status">{t('Step 1: Choose protocol')}</span>
                    </div>
                    <div className="settings-step-toggle-right">
                      {protocolReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelStep === 'protocol' ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {expandedModelStep === 'protocol' && (
                    <div className="settings-step-panel">
                      <p className="mb-3 text-xs text-muted-foreground">{t('Protocol help')}</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleProtocolChange('anthropic_compat')}
                          className={`settings-choice-btn ${selectedProfile.protocol !== 'openai_compat' ? 'settings-choice-btn-active' : ''}`}
                        >
                          {t('Anthropic Compatible')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleProtocolChange('openai_compat')}
                          className={`settings-choice-btn ${selectedProfile.protocol === 'openai_compat' ? 'settings-choice-btn-active' : ''}`}
                        >
                          {t('OpenAI Compatible')}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {selectedProfile.enabled === false ? (
                  <section className="settings-step-card text-center">
                    <p className="text-base font-medium">{t('Disabled')}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{t('Please enable the AI provider in Settings')}</p>
                    <button
                      type="button"
                      onClick={() => handleSelectedProfileEnabledChange(true)}
                      className="mt-4 rounded-xl btn-apple px-4 py-2 text-sm"
                    >
                      {t('Enable')} {selectedProfile.name}
                    </button>
                  </section>
                ) : (
                  <>
                    <section className={`settings-step-card ${expandedModelStep !== 'api' ? 'settings-step-card-collapsed' : ''}`}>
                      <button
                        type="button"
                        onClick={() => setExpandedModelStep('api')}
                        className="settings-step-toggle"
                      >
                        <div className="settings-step-toggle-left">
                          <h4 className="text-sm font-semibold">2. API</h4>
                          <span className="settings-step-status">{t('Step 2: Enter API Key')}</span>
                        </div>
                        <div className="settings-step-toggle-right">
                          {apiReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelStep === 'api' ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedModelStep === 'api' && (
                        <div className="settings-step-panel space-y-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">API Key</label>
                            <p className="mb-2 text-xs text-muted-foreground">{t('API Key help')}</p>
                            <div className="relative">
                              <input
                                type={showApiKey ? 'text' : 'password'}
                                value={selectedProfile.apiKey}
                                onChange={(event) => {
                                  updateSelectedProfile({ apiKey: event.target.value })
                                  setValidationResult(null)
                                }}
                                className="w-full input-apple px-4 py-2.5 pr-11 text-sm"
                                placeholder={t('Please enter API Key')}
                              />
                              <button
                                type="button"
                                onClick={() => setShowApiKey(prev => !prev)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                aria-label={showApiKey ? t('Hide API Key') : t('Show API Key')}
                              >
                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-700">{t('Where to get API Key')}</summary>
                              <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{t('API Key guide')}</p>
                            </details>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">API URL</label>
                            <p className="mb-2 text-xs text-muted-foreground">{t('API URL help')}</p>
                            <input
                              type="text"
                              value={selectedProfile.apiUrl}
                              onChange={(event) => {
                                updateSelectedProfile({ apiUrl: event.target.value })
                                setValidationResult(null)
                              }}
                              className="w-full input-apple px-4 py-2.5 text-sm"
                            />
                            {selectedProfileUrlInvalid && (
                              <p className="mt-1 text-xs text-destructive">{selectedProfileUrlError}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className={`settings-step-card ${expandedModelStep !== 'model' ? 'settings-step-card-collapsed' : ''}`}>
                      <button
                        type="button"
                        onClick={() => setExpandedModelStep('model')}
                        className="settings-step-toggle"
                      >
                        <div className="settings-step-toggle-left">
                          <h4 className="text-sm font-semibold">3. {t('Default Model')}</h4>
                          <span className="settings-step-status">{t('Step 3: Set model')}</span>
                        </div>
                        <div className="settings-step-toggle-right">
                          {modelReady && <CheckCircle2 className="h-4 w-4 text-kite-success" />}
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedModelStep === 'model' ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      {expandedModelStep === 'model' && (
                        <div className="settings-step-panel space-y-3">
                          <div>
                            <p className="mb-2 text-xs text-muted-foreground">{t('Default model help')}</p>
                            <input
                              type="text"
                              value={selectedProfile.defaultModel}
                              onChange={(event) => {
                                const previousDefaultModel = selectedProfile.defaultModel
                                const nextDefaultModel = event.target.value
                                updateSelectedProfile({
                                  defaultModel: nextDefaultModel,
                                  modelCatalog: normalizeModelCatalogForDefaultModelChange(
                                    nextDefaultModel,
                                    previousDefaultModel,
                                    selectedCatalog
                                  )
                                })
                                setValidationResult(null)
                              }}
                              className="w-full input-apple px-4 py-2.5 text-sm"
                            />
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-700">{t('Common models')}</summary>
                              <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{t('Model examples')}</p>
                            </details>
                          </div>

                          <div className="rounded-xl border border-dashed border-border/75 bg-secondary/20 p-3">
                            <button
                              type="button"
                              onClick={() => setShowAdvancedModelFields((prev) => !prev)}
                              className="flex w-full items-center justify-between text-left"
                            >
                              <span className="text-sm font-medium">{t('Advanced options')}</span>
                              <span className="text-xs text-muted-foreground">
                                {showAdvancedModelFields ? t('Hide') : t('Show')}
                              </span>
                            </button>

                            {showAdvancedModelFields && (
                              <div className="mt-3 space-y-3">
                                <div>
                                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Model Catalog')}</label>
                                  <div className="mb-2 flex flex-wrap gap-1.5">
                                    {selectedCatalog.map((modelId) => (
                                      <button
                                        type="button"
                                        key={modelId}
                                        onClick={() => {
                                          if (modelId === selectedProfile.defaultModel) return
                                          updateSelectedProfile({
                                            modelCatalog: selectedCatalog.filter(item => item !== modelId)
                                          })
                                        }}
                                        className={`rounded-full border px-2.5 py-1 text-xs ${
                                          modelId === selectedProfile.defaultModel
                                            ? 'cursor-default border-primary/45 bg-primary/10 text-primary'
                                            : 'border-border bg-background text-muted-foreground hover:bg-secondary/50'
                                        }`}
                                      >
                                        {modelId}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={modelInput}
                                      onChange={(event) => setModelInput(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          handleAddModelId()
                                        }
                                      }}
                                      className="w-full input-apple px-4 py-2 text-sm"
                                      placeholder={t('Add model id')}
                                    />
                                    <button
                                      type="button"
                                      onClick={handleAddModelId}
                                      className="rounded-xl border border-border/70 px-3 text-sm hover:bg-secondary/50"
                                    >
                                      {t('Add')}
                                    </button>
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Doc URL')}</label>
                                  <input
                                    type="text"
                                    value={selectedProfile.docUrl || ''}
                                    onChange={(event) => {
                                      updateSelectedProfile({ docUrl: event.target.value })
                                      setValidationResult(null)
                                    }}
                                    className="w-full input-apple px-4 py-2.5 text-sm"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  </>
                )}

                <section className="settings-action-row">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => selectedProfile.enabled !== false && setDefaultProfileId(selectedProfile.id)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                        selectedProfile.id === defaultProfileId
                          ? 'bg-secondary text-foreground ring-1 ring-border/80'
                          : 'bg-secondary/55 text-foreground hover:bg-secondary'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                      disabled={selectedProfile.enabled === false}
                    >
                      {selectedProfile.id === defaultProfileId ? t('Default') : t('Set as Default')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleValidateConnection()}
                      className="rounded-xl bg-secondary/85 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isValidating || !canTestConnection}
                    >
                      {isValidating ? t('Testing...') : t('Test Connection')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isValidating || !canSaveModel}
                    >
                      {isValidating ? t('Saving...') : t('Save')}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleRemoveSelectedProfile}
                      className="rounded-xl bg-red-500/12 px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={profiles.length <= 1}
                    >
                      {t('Delete')}
                    </button>

                    {validationResult?.valid && (
                      <button
                        type="button"
                        onClick={goBack}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/50"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        {t('Return to conversation')}
                      </button>
                    )}
                  </div>

                  {validationResult?.message && (
                    <div
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                        validationResult.valid
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-600'
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      {validationResult.valid ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span>{validationResult.message}</span>
                    </div>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      </section>
    )
  }

  const renderAppearanceSection = () => (
    <div className="settings-section-stack">
      <section className="settings-modal-card settings-block-card">
        <div className="settings-block-head">
          <h3 className="text-base font-semibold tracking-tight">{t('Theme')}</h3>
          <p className="text-xs text-muted-foreground">{t('Adjust theme and language')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:max-w-[360px]">
          {THEME_OPTIONS.map((themeOption) => (
            <button
              key={themeOption.value}
              onClick={() => handleThemeChange(themeOption.value)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                theme === themeOption.value
                  ? 'bg-secondary text-foreground ring-2 ring-foreground/15'
                  : 'bg-secondary/50 text-foreground/75 hover:bg-secondary/80'
              }`}
            >
              {t(themeOption.labelKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-modal-card settings-block-card">
        <div className="settings-block-head">
          <h3 className="text-base font-semibold tracking-tight">{t('Language')}</h3>
          <p className="text-xs text-muted-foreground">{t('Pick required setup first, then optional improvements')}</p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {localeEntries.map(([code, name]) => (
              <button
                key={code}
                type="button"
                onClick={() => handleLanguageChange(code)}
                className={`rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                  currentLanguage === code
                    ? 'bg-secondary text-foreground ring-2 ring-foreground/15'
                    : 'bg-secondary/50 text-foreground/75 hover:bg-secondary/80'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <select
            value={currentLanguage}
            onChange={(event) => handleLanguageChange(event.target.value as LocaleCode)}
            className="w-full input-apple px-4 py-2.5 text-sm"
          >
            {localeEntries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  )

  const renderGeneralSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('System')}</h3>
        <p className="text-xs text-muted-foreground">{t('Tune app behavior')}</p>
      </div>
      {api.isRemoteMode() ? (
        <p className="text-sm text-muted-foreground">{t('System settings are unavailable in remote mode')}</p>
      ) : (
        <div className="space-y-3">
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Auto Launch on Startup')}</p>
              <p className="text-sm text-muted-foreground">{t('Automatically run Kite when system starts')}</p>
            </div>
            <AppleToggle checked={autoLaunch} onChange={handleAutoLaunchChange} />
          </div>
          <div className="settings-setting-row">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Background Daemon')}</p>
              <p className="text-sm text-muted-foreground">
                {t('Minimize to {{trayType}} when closing window, instead of exiting the program', {
                  trayType: window.platform?.isMac ? t('menu bar') : t('system tray')
                })}
              </p>
            </div>
            <AppleToggle checked={minimizeToTray} onChange={handleMinimizeToTrayChange} />
          </div>
        </div>
      )}
    </section>
  )

  const renderPermissionSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head-row">
        <h3 className="text-base font-semibold tracking-tight">{t('Permissions')}</h3>
        <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
          {t('Full Permission Mode')}
        </span>
      </div>

      <div className="settings-info mb-5 text-sm text-muted-foreground">
        {t('Current version defaults to full permission mode, AI can freely perform all operations. Future versions will support fine-grained permission control.')}
      </div>

      <div className="space-y-4 opacity-60">
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('File Read/Write')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to read and create files')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Execute Commands')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to execute terminal commands')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Trust Mode')}</p>
            <p className="text-sm text-muted-foreground">{t('Automatically execute all operations')}</p>
          </div>
          <AppleToggle checked={true} onChange={() => {}} disabled={true} />
        </div>
      </div>
    </section>
  )

  const renderMcpSection = () => (
    <section className="settings-modal-card settings-block-card">
      <McpServerList
        servers={config?.mcpServers || {}}
        onSave={handleMcpServersSave}
      />
      <div className="mt-5 border-t border-border/50 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('Format compatible with Cursor / Claude Desktop')}</span>
          <a
            href="https://modelcontextprotocol.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground transition-colors hover:text-foreground/80"
          >
            {t('Learn about MCP')} →
          </a>
        </div>
        <p className="text-xs text-amber-500/80">
          ⚠️ {t('Configuration changes will take effect after starting a new conversation')}
        </p>
      </div>
    </section>
  )

  const renderNetworkSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('Remote Access')}</h3>
        <p className="text-xs text-muted-foreground">{t('Enable remote access')}</p>
      </div>

      <div className="settings-warning mb-5">
        <div className="flex items-start gap-3">
          <span className="text-xl text-amber-500">⚠️</span>
          <div className="text-sm">
            <p className="mb-1 font-medium text-amber-500">{t('Security Warning')}</p>
            <p className="text-amber-500/80">
              {t('After enabling remote access, anyone with the password can fully control your computer (read/write files, execute commands). Do not share the access password with untrusted people.')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="settings-setting-row">
          <div>
            <p className="font-medium">{t('Enable Remote Access')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow access to Kite from other devices')}</p>
          </div>
          <AppleToggle
            checked={remoteStatus?.enabled || false}
            onChange={handleToggleRemote}
            disabled={isEnablingRemote}
          />
        </div>

        {remoteStatus?.enabled && (
          <>
            <div className="space-y-3 rounded-lg bg-secondary/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Local Address')}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-background px-2 py-1 text-sm">{remoteStatus.server.localUrl}</code>
                  <button
                    onClick={() => copyToClipboard(remoteStatus.server.localUrl || '')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('Copy')}
                  </button>
                </div>
              </div>

              {remoteStatus.server.lanUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t('LAN Address')}</span>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-background px-2 py-1 text-sm">{remoteStatus.server.lanUrl}</code>
                    <button
                      onClick={() => copyToClipboard(remoteStatus.server.lanUrl || '')}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t('Copy')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Access Password')}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-wider">
                    {showPassword ? remoteStatus.server.token : '••••••'}
                  </code>
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? t('Hide') : t('Show')}
                  </button>
                  <button
                    onClick={() => copyToClipboard(remoteStatus.server.token || '')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('Copy')}
                  </button>
                </div>
              </div>

              {remoteStatus.clients > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('Connected Devices')}</span>
                  <span className="text-green-500">{t('{{count}} devices', { count: remoteStatus.clients })}</span>
                </div>
              )}
            </div>

            <div className="border-t border-border/50 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Internet Access')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('Get public address via Cloudflare (wait about 10 seconds for DNS resolution after startup)')}
                  </p>
                </div>
                <button
                  onClick={handleToggleTunnel}
                  disabled={isEnablingTunnel}
                  className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                    remoteStatus.tunnel.status === 'running'
                      ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                      : 'bg-secondary text-foreground hover:bg-secondary/80'
                  }`}
                >
                  {isEnablingTunnel
                    ? t('Connecting...')
                    : remoteStatus.tunnel.status === 'running'
                    ? t('Stop Tunnel')
                    : remoteStatus.tunnel.status === 'starting'
                    ? t('Connecting...')
                    : t('Start Tunnel')}
                </button>
              </div>

              {remoteStatus.tunnel.status === 'running' && remoteStatus.tunnel.url && (
                <div className="space-y-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-green-500">{t('Public Address')}</span>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-background px-2 py-1 text-sm text-green-500">{remoteStatus.tunnel.url}</code>
                      <button
                        onClick={() => copyToClipboard(remoteStatus.tunnel.url || '')}
                        className="text-xs text-green-500/80 hover:text-green-500"
                      >
                        {t('Copy')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {remoteStatus.tunnel.status === 'error' && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-sm text-red-500">
                    {t('Tunnel connection failed')}: {remoteStatus.tunnel.error}
                  </p>
                </div>
              )}
            </div>

            {qrCode && (
              <div className="border-t border-border/50 pt-4">
                <p className="mb-3 font-medium">{t('Scan to Access')}</p>
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <img src={qrCode} alt="QR Code" className="h-48 w-48" />
                  </div>
                  <div className="text-center text-sm">
                    <p className="text-muted-foreground">{t('Scan the QR code with your phone and enter the password to access')}</p>
                    <p className="mt-1 text-xs text-amber-500">{t('QR code contains password, do not share screenshots with others')}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )

  const renderAboutSection = () => (
    <section className="settings-modal-card settings-block-card">
      <div className="settings-block-head">
        <h3 className="text-base font-semibold tracking-tight">{t('About')}</h3>
        <p className="text-xs text-muted-foreground">{t('Check version and updates')}</p>
      </div>
      {api.isRemoteMode() ? (
        <p className="text-sm text-muted-foreground">{t('System settings are unavailable in remote mode')}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Current version')}</span>
            <span>{updaterState?.currentVersion || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Latest version')}</span>
            <span>{updaterState?.latestVersion || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Last checked at')}</span>
            <span>{formatCheckTime(updaterState?.checkTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('Status')}</span>
            <span>{getUpdateStatusLabel()}</span>
          </div>
          {updaterState?.downloadSource === 'baidu' && updaterState.baiduExtractCode && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Extract code')}</span>
              <span className="font-mono">{updaterState.baiduExtractCode}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
            <button
              type="button"
              onClick={() => void handleCheckUpdates()}
              className="inline-flex items-center gap-2 rounded-xl border border-border/70 px-4 py-2 text-sm hover:bg-secondary/50 disabled:opacity-50"
              disabled={isCheckingUpdate}
            >
              <RefreshCw className={`h-4 w-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              {t('Check for updates')}
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadUpdate()}
              className="inline-flex items-center gap-2 rounded-xl btn-apple px-4 py-2 text-sm disabled:opacity-50"
              disabled={updaterState?.status !== 'available'}
            >
              <Download className="h-4 w-4" />
              {t('Download update')}
            </button>
          </div>
        </div>
      )}
    </section>
  )

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'model':
        return renderModelSection()
      case 'appearance':
        return renderAppearanceSection()
      case 'general':
        return renderGeneralSection()
      case 'permissions':
        return renderPermissionSection()
      case 'mcp':
        return renderMcpSection()
      case 'network':
        return renderNetworkSection()
      case 'about':
      default:
        return renderAboutSection()
    }
  }

  return (
    <div className="settings-modal-page">
      <div className="settings-modal-overlay" />
      <div className="settings-modal-shell">
        <aside className="settings-modal-sidebar">
          <div className="settings-modal-sidebar-title">
            <p className="text-sm font-semibold tracking-tight">{t('Settings')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('Pick required setup first, then optional improvements')}</p>
          </div>

          <nav className="space-y-3">
            {groupedSections.map((group) => (
              <div key={group.id} className="space-y-1">
                <p className="px-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t(group.labelKey)}
                </p>
                {group.sections.map((section) => {
                  const Icon = section.icon
                  const selected = section.id === activeSection
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={`settings-modal-nav-item ${selected ? 'settings-modal-nav-item-active' : ''}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 text-left text-sm font-medium">{t(section.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        <section className="settings-modal-main">
          <header className="settings-modal-header">
            <div>
              <span className="settings-header-chip">{t(activeSectionMeta.group === 'required' ? 'Must configure' : activeSectionMeta.group === 'optional' ? 'Optional enhancements' : 'Advanced tools')}</span>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t(activeSectionMeta.labelKey)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t(activeSectionMeta.hintKey)}</p>
            </div>
            <button
              type="button"
              onClick={goBack}
              className="settings-modal-close"
              aria-label={t('Close')}
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="settings-modal-content">
            {renderActiveSection()}
          </div>

          <footer className="settings-modal-footer">
            <button
              type="button"
              onClick={goBack}
              className="btn-apple rounded-2xl px-6 py-2.5 text-sm"
            >
              {t('Done')}
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}
