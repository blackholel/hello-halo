/**
 * Settings Page - App configuration
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app.store'
import { usePythonStore } from '../stores/python.store'
import { api } from '../api'
import type {
  KiteConfig,
  ThemeMode,
  McpServersConfig,
  ConfigSourceMode,
  ApiProfile,
  ProviderVendor,
  ProviderProtocol
} from '../types'
import { DEFAULT_MODEL } from '../types'
import { CheckCircle2, XCircle, ArrowLeft, Eye, EyeOff, ChevronDown, ChevronRight, Package, Trash2, Loader2 } from '../components/icons/ToolIcons'
import { Header } from '../components/layout/Header'
import { McpServerList } from '../components/settings/McpServerList'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { ensureAiConfig } from '../../shared/types/ai-profile'

interface ProfileTemplate {
  key: string
  label: string
  profile: Omit<ApiProfile, 'id' | 'name' | 'apiKey' | 'enabled'>
}

const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    key: 'minimax',
    label: 'MiniMax',
    profile: {
      vendor: 'minimax',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.minimaxi.com/anthropic',
      defaultModel: 'MiniMax-M2.5',
      modelCatalog: ['MiniMax-M2.5'],
      docUrl: 'https://platform.minimaxi.com/docs/coding-plan/claude-code'
    }
  },
  {
    key: 'moonshot',
    label: 'Kimi / Moonshot',
    profile: {
      vendor: 'moonshot',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.moonshot.cn/anthropic',
      defaultModel: 'kimi-k2-thinking',
      modelCatalog: ['kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
      docUrl: 'https://platform.moonshot.cn/docs/guide/agent-support'
    }
  },
  {
    key: 'glm',
    label: 'GLM',
    profile: {
      vendor: 'zhipu',
      protocol: 'anthropic_compat',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic',
      defaultModel: 'glm-4.7',
      modelCatalog: ['glm-4.7'],
      docUrl: 'https://open.bigmodel.cn/dev/api'
    }
  },
  {
    key: 'openai',
    label: 'OpenAI',
    profile: {
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://api.openai.com/v1/responses',
      defaultModel: 'gpt-4o-mini',
      modelCatalog: ['gpt-4o-mini', 'gpt-4.1-mini'],
      docUrl: 'https://platform.openai.com/docs/api-reference/responses'
    }
  },
  {
    key: 'topic_official',
    label: 'Topic 官方',
    profile: {
      vendor: 'topic',
      protocol: 'anthropic_official',
      apiUrl: 'https://api.topic.ai',
      defaultModel: DEFAULT_MODEL,
      modelCatalog: [DEFAULT_MODEL],
      docUrl: 'https://docs.topic.ai'
    }
  },
  {
    key: 'topic_compat',
    label: 'Topic 兼容',
    profile: {
      vendor: 'topic',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.topic.ai/anthropic',
      defaultModel: DEFAULT_MODEL,
      modelCatalog: [DEFAULT_MODEL],
      docUrl: 'https://docs.topic.ai'
    }
  }
]

const VENDOR_LABELS: Record<ProviderVendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  zhipu: 'GLM',
  minimax: 'MiniMax',
  moonshot: 'Kimi / Moonshot',
  topic: 'Topic',
  custom: 'Custom'
}

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic_official: 'Anthropic Official',
  anthropic_compat: 'Anthropic Compatible',
  openai_compat: 'OpenAI Compatible'
}

const API_KEY_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'sk-ant-xxxxxxxxxxxxx',
  anthropic_compat: 'sk-ant-xxxxxxxxxxxxx',
  openai_compat: 'sk-xxxxxxxxxxxxx'
}

const API_URL_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'https://api.anthropic.com',
  anthropic_compat: 'https://provider.example.com/anthropic',
  openai_compat: 'https://provider.example.com/v1/chat/completions or /v1/responses'
}

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

function isValidOpenAICompatEndpoint(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') || normalized.endsWith('/responses')
}

function selectFirstEnabledProfileId(profiles: ApiProfile[]): string {
  const enabledProfile = profiles.find(profile => profile.enabled !== false)
  return enabledProfile?.id || profiles[0]?.id || ''
}

const THEME_LABELS: Record<string, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow System',
}

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

export function SettingsPage() {
  const { t } = useTranslation()
  const { config, setConfig, goBack, setView } = useAppStore()

  // Python store
  const {
    isAvailable: pythonAvailable,
    isDetecting: pythonDetecting,
    globalEnvironment: pythonEnvironment,
    globalPackages: pythonPackages,
    isLoadingGlobalPackages: loadingPythonPackages,
    detectionError: pythonError,
    isInstallingPackage,
    installProgress,
    detectPython,
    loadGlobalPackages,
    installPackage,
    uninstallPackage
  } = usePythonStore()

  // Python UI state
  const [showPythonPackages, setShowPythonPackages] = useState(false)
  const [newPackageName, setNewPackageName] = useState('')

  const initialAiConfig = ensureAiConfig(config?.ai, config?.api)
  const [profiles, setProfiles] = useState<ApiProfile[]>(initialAiConfig.profiles)
  const [defaultProfileId, setDefaultProfileId] = useState(initialAiConfig.defaultProfileId)
  const [selectedProfileId, setSelectedProfileId] = useState(initialAiConfig.defaultProfileId)
  const [templateKey, setTemplateKey] = useState(PROFILE_TEMPLATES[0]?.key || 'minimax')

  const [theme, setTheme] = useState<ThemeMode>(config?.appearance.theme || 'system')
  const [configSourceMode, setConfigSourceMode] = useState<ConfigSourceMode>(config?.configSourceMode || 'kite')
  const [configSourceNotice, setConfigSourceNotice] = useState<string | null>(null)
  const [taxonomyAdminEnabled, setTaxonomyAdminEnabled] = useState<boolean>(config?.extensionTaxonomy?.adminEnabled || false)

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

  // API Key visibility state
  const [showApiKey, setShowApiKey] = useState(false)

  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId) || null
  const selectedProfileUrlInvalid =
    selectedProfile?.protocol === 'openai_compat' &&
    !isValidOpenAICompatEndpoint(selectedProfile.apiUrl)

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
    setConfigSourceMode(config?.configSourceMode || 'kite')
  }, [config?.configSourceMode])

  useEffect(() => {
    setTaxonomyAdminEnabled(config?.extensionTaxonomy?.adminEnabled || false)
  }, [config?.extensionTaxonomy?.adminEnabled])

  useEffect(() => {
    const nextAiConfig = ensureAiConfig(config?.ai, config?.api)
    setProfiles(nextAiConfig.profiles)
    setDefaultProfileId(nextAiConfig.defaultProfileId)
    setSelectedProfileId((prev) => {
      if (nextAiConfig.profiles.some(profile => profile.id === prev)) {
        return prev
      }
      return nextAiConfig.defaultProfileId
    })
  }, [config?.ai, config?.api])

  // Load system settings
  useEffect(() => {
    loadSystemSettings()
  }, [])

  // Load Python environment on mount
  useEffect(() => {
    detectPython()
  }, [detectPython])

  // Load Python packages when environment is available
  useEffect(() => {
    if (pythonAvailable && showPythonPackages) {
      loadGlobalPackages()
    }
  }, [pythonAvailable, showPythonPackages, loadGlobalPackages])

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

  // Auto-save helper for appearance settings
  const autoSave = useCallback(async (partialConfig: Partial<KiteConfig>) => {
    const newConfig = { ...config, ...partialConfig } as KiteConfig
    await api.setConfig(partialConfig)
    setConfig(newConfig)
  }, [config, setConfig])

  // Handle theme change with auto-save
  const handleThemeChange = async (value: ThemeMode) => {
    setTheme(value)
    // Sync to localStorage immediately (for anti-flash on reload)
    try {
      localStorage.setItem('kite-theme', value)
    } catch (e) { /* ignore */ }
    await autoSave({
      appearance: { theme: value }
    })
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

  const handleConfigSourceModeChange = async (nextMode: ConfigSourceMode) => {
    const previousMode = configSourceMode
    setConfigSourceMode(nextMode)
    setConfigSourceNotice(null)

    if (nextMode === previousMode) {
      return
    }

    try {
      await api.setConfig({ configSourceMode: nextMode })
      // Do not update global in-memory config here.
      // Runtime source mode is locked in main process until restart,
      // so UI should keep using current effective source outside this page.
      setConfigSourceNotice(t('Configuration source saved. Restart Kite to apply changes.'))
    } catch (error) {
      console.error('[Settings] Failed to update configuration source mode:', error)
      setConfigSourceMode(previousMode)
      setConfigSourceNotice(t('Save failed'))
    }
  }

  const handleTaxonomyAdminToggle = async (enabled: boolean) => {
    setTaxonomyAdminEnabled(enabled)
    try {
      await api.setConfig({ extensionTaxonomy: { adminEnabled: enabled } })
      setConfig({
        ...config,
        extensionTaxonomy: { adminEnabled: enabled }
      } as KiteConfig)
    } catch (error) {
      console.error('[Settings] Failed to set taxonomy admin flag:', error)
      setTaxonomyAdminEnabled(!enabled)
    }
  }

  // Handle Python package install
  const handleInstallPackage = async () => {
    if (!newPackageName.trim()) return
    const success = await installPackage(newPackageName.trim())
    if (success) {
      setNewPackageName('')
    }
  }

  // Handle Python package uninstall
  const handleUninstallPackage = async (packageName: string) => {
    await uninstallPackage(packageName)
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

  const handleAddProfileFromTemplate = () => {
    const template = PROFILE_TEMPLATES.find(item => item.key === templateKey) || PROFILE_TEMPLATES[0]
    if (!template) return

    const profileName = toUniqueProfileName(template.label, profiles)
    const profileId = createProfileId(template.key)
    const nextProfile: ApiProfile = {
      id: profileId,
      name: profileName,
      apiKey: '',
      enabled: true,
      ...template.profile
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

    if (!selectedProfile.apiKey.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API Key') })
      return
    }

    if (selectedProfile.protocol === 'openai_compat' && !selectedProfile.apiUrl.trim()) {
      setValidationResult({ valid: false, message: t('Please enter API URL') })
      return
    }

    if (selectedProfileUrlInvalid) {
      setValidationResult({ valid: false, message: t('URL must end with /chat/completions or /responses') })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      let response = await api.validateApi(
        selectedProfile.apiKey.trim(),
        selectedProfile.apiUrl.trim(),
        selectedProfile.protocol
      )
      let parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })

      // Backward compatibility: old backends only understand provider=openai for OpenAI-compatible validation.
      if (!parsed.valid && selectedProfile.protocol === 'openai_compat') {
        response = await api.validateApi(
          selectedProfile.apiKey.trim(),
          selectedProfile.apiUrl.trim(),
          'openai'
        )
        parsed = parseValidationResult(response as { success: boolean; data?: unknown; error?: string })
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

    if (selectedProfile.protocol === 'openai_compat' && selectedProfileUrlInvalid) {
      setValidationResult({ valid: false, message: t('URL must end with /chat/completions or /responses') })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const normalizedProfiles = profiles.map((profile) => {
        const normalizedDefaultModel = profile.defaultModel.trim() || DEFAULT_MODEL
        const normalizedCatalog = profile.modelCatalog
          .map(item => item.trim())
          .filter(item => item.length > 0)
        const modelCatalog = normalizedCatalog.includes(normalizedDefaultModel)
          ? normalizedCatalog
          : [normalizedDefaultModel, ...normalizedCatalog]

        return {
          ...profile,
          name: profile.name.trim() || 'Profile',
          apiKey: profile.apiKey.trim(),
          apiUrl: profile.apiUrl.trim(),
          defaultModel: normalizedDefaultModel,
          modelCatalog,
          docUrl: profile.docUrl?.trim() || undefined
        }
      })

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
      setValidationResult({ valid: true, message: t('Saved') })
    } catch (error) {
      setValidationResult({ valid: false, message: t('Save failed') })
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <div className="h-full w-full flex flex-col relative">
      {/* Ambient background */}
      <div className="ambient-bg">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
      </div>

      {/* Header */}
      <Header
        left={
          <>
            <button
              onClick={goBack}
              className="p-1.5 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
            >
              <ArrowLeft className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
            <span className="font-semibold text-sm tracking-tight">{t('Settings')}</span>
          </>
        }
      />

      {/* Content */}
      <main className="flex-1 overflow-auto relative z-10">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
          {/* AI Profiles Section */}
          <section className="settings-section">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-[#da7756]/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#da7756]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4.709 15.955l4.72-2.647.08-.08 2.726-1.529.08-.08 6.206-3.48a.25.25 0 00.125-.216V6.177a.25.25 0 00-.375-.217l-6.206 3.48-.08.08-2.726 1.53-.08.079-4.72 2.647a.25.25 0 00-.125.217v1.746c0 .18.193.294.354.216h.001zm13.937-3.584l-4.72 2.647-.08.08-2.726 1.529-.08.08-6.206 3.48a.25.25 0 00-.125.216v1.746a.25.25 0 00.375.217l6.206-3.48.08-.08 2.726-1.53.08-.079 4.72-2.647a.25.25 0 00.125-.217v-1.746a.25.25 0 00-.375-.216z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">{t('AI Profiles')}</h2>
                <p className="text-xs text-muted-foreground">{t('Manage provider profiles and default profile')}</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Preset Template')}</label>
                  <select
                    value={templateKey}
                    onChange={(event) => setTemplateKey(event.target.value)}
                    className="w-full select-apple text-sm"
                  >
                    {PROFILE_TEMPLATES.map(template => (
                      <option key={template.key} value={template.key}>
                        {t(template.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAddProfileFromTemplate}
                  className="px-4 py-2.5 btn-apple text-sm"
                >
                  {t('Add Profile')}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('Profile List')}</label>
                  <div className="space-y-2">
                    {profiles.map(profile => {
                      const active = profile.id === selectedProfileId
                      const isDefault = profile.id === defaultProfileId
                      return (
                        <div
                          key={profile.id}
                          onClick={() => {
                            setSelectedProfileId(profile.id)
                            setValidationResult(null)
                          }}
                          className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                            active
                              ? 'border-primary/50 bg-primary/10'
                              : 'border-border/50 bg-secondary/20 hover:bg-secondary/40'
                          }`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedProfileId(profile.id)
                              setValidationResult(null)
                            }
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-sm truncate">{profile.name}</p>
                            <span className="text-[11px] text-muted-foreground">{t(PROTOCOL_LABELS[profile.protocol])}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{t(VENDOR_LABELS[profile.vendor])}</span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setValidationResult(null)
                                setDefaultProfileId(profile.id)
                              }}
                              disabled={!isDefault && profile.enabled === false}
                              className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                                isDefault
                                  ? 'bg-green-500/20 text-green-500'
                                  : 'bg-secondary/60 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed'
                              }`}
                            >
                              {isDefault ? t('Default') : t('Set Default')}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  {selectedProfile ? (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('Profile Details')}</label>
                        <button
                          type="button"
                          onClick={handleRemoveSelectedProfile}
                          disabled={profiles.length <= 1}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('Delete')}
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Profile Name')}</label>
                        <input
                          type="text"
                          value={selectedProfile.name}
                          onChange={(event) => updateSelectedProfile({ name: event.target.value })}
                          className="w-full px-4 py-2.5 input-apple text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Vendor')}</label>
                          <select
                            value={selectedProfile.vendor}
                            onChange={(event) => updateSelectedProfile({ vendor: event.target.value as ProviderVendor })}
                            className="w-full select-apple text-sm"
                          >
                            {Object.entries(VENDOR_LABELS).map(([vendor, label]) => (
                              <option key={vendor} value={vendor}>
                                {t(label)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Protocol')}</label>
                          <select
                            value={selectedProfile.protocol}
                            onChange={(event) => updateSelectedProfile({ protocol: event.target.value as ProviderProtocol })}
                            className="w-full select-apple text-sm"
                          >
                            {Object.entries(PROTOCOL_LABELS).map(([protocol, label]) => (
                              <option key={protocol} value={protocol}>
                                {t(label)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">API Key</label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={selectedProfile.apiKey}
                            onChange={(event) => updateSelectedProfile({ apiKey: event.target.value })}
                            placeholder={API_KEY_PLACEHOLDER_BY_PROTOCOL[selectedProfile.protocol]}
                            className="w-full px-4 py-2.5 pr-12 input-apple text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title={showApiKey ? t('Hide API Key') : t('Show API Key')}
                          >
                            {showApiKey ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">API URL</label>
                        <input
                          type="text"
                          value={selectedProfile.apiUrl}
                          onChange={(event) => updateSelectedProfile({ apiUrl: event.target.value })}
                          placeholder={API_URL_PLACEHOLDER_BY_PROTOCOL[selectedProfile.protocol]}
                          className="w-full px-4 py-2.5 input-apple text-sm"
                        />
                        {selectedProfileUrlInvalid && (
                          <p className="mt-1 text-xs text-destructive">
                            {t('URL must end with /chat/completions or /responses')}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Default Model')}</label>
                        <input
                          type="text"
                          value={selectedProfile.defaultModel}
                          onChange={(event) => {
                            const nextDefaultModel = event.target.value
                            const nextCatalog = selectedProfile.modelCatalog.includes(nextDefaultModel)
                              ? selectedProfile.modelCatalog
                              : [nextDefaultModel, ...selectedProfile.modelCatalog.filter(item => item !== nextDefaultModel)]
                            updateSelectedProfile({
                              defaultModel: nextDefaultModel,
                              modelCatalog: nextCatalog.filter(item => item.trim().length > 0)
                            })
                          }}
                          className="w-full px-4 py-2.5 input-apple text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Model Catalog (comma separated)')}</label>
                        <input
                          type="text"
                          value={selectedProfile.modelCatalog.join(', ')}
                          onChange={(event) => {
                            const parsed = event.target.value
                              .split(',')
                              .map(item => item.trim())
                              .filter(item => item.length > 0)
                            const normalized = selectedProfile.defaultModel && !parsed.includes(selectedProfile.defaultModel)
                              ? [selectedProfile.defaultModel, ...parsed]
                              : parsed
                            updateSelectedProfile({ modelCatalog: normalized })
                          }}
                          className="w-full px-4 py-2.5 input-apple text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Doc URL')}</label>
                        <input
                          type="text"
                          value={selectedProfile.docUrl || ''}
                          onChange={(event) => updateSelectedProfile({ docUrl: event.target.value })}
                          className="w-full px-4 py-2.5 input-apple text-sm"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{t('Enabled')}</p>
                          <p className="text-xs text-muted-foreground">{t('Disable to keep profile but skip it')}</p>
                        </div>
                        <AppleToggle
                          checked={selectedProfile.enabled}
                          onChange={handleSelectedProfileEnabledChange}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('Please create or select a profile')}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={handleValidateConnection}
                  disabled={isValidating || !selectedProfile || selectedProfileUrlInvalid}
                  className="px-5 py-2.5 rounded-xl bg-secondary/80 hover:bg-secondary text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isValidating ? t('Testing...') : t('Test Connection')}
                </button>

                <button
                  onClick={handleSave}
                  disabled={isValidating || !selectedProfile || !selectedProfile.apiKey.trim() || selectedProfileUrlInvalid}
                  className="px-5 py-2.5 btn-apple text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isValidating ? t('Saving...') : t('Save')}
                </button>

                {validationResult && (
                  <span
                    className={`text-sm flex items-center gap-1 ${
                      validationResult.valid ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {validationResult.valid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        {validationResult.message || t('Saved')}
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        {validationResult.message}
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Permissions Section */}
          <section className="settings-section">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">{t('Permissions')}</h2>
              <span className="text-xs px-2.5 py-1 rounded-lg bg-kite-success/15 text-kite-success font-medium">
                {t('Full Permission Mode')}
              </span>
            </div>

            {/* Info banner */}
            <div className="settings-info mb-5 text-sm text-muted-foreground">
              {t('Current version defaults to full permission mode, AI can freely perform all operations. Future versions will support fine-grained permission control.')}
            </div>

            <div className="space-y-4 opacity-50">
              {/* File Access */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('File Read/Write')}</p>
                  <p className="text-sm text-muted-foreground">{t('Allow AI to read and create files')}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-kite-success/15 text-kite-success font-medium">
                  {t('Allow')}
                </span>
              </div>

              {/* Command Execution */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Execute Commands')}</p>
                  <p className="text-sm text-muted-foreground">{t('Allow AI to execute terminal commands')}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-kite-success/15 text-kite-success font-medium">
                  {t('Allow')}
                </span>
              </div>

              {/* Trust Mode */}
              <div className="flex items-center justify-between pt-4 border-t border-border/50">
                <div>
                  <p className="font-medium">{t('Trust Mode')}</p>
                  <p className="text-sm text-muted-foreground">{t('Automatically execute all operations')}</p>
                </div>
                <AppleToggle checked={true} onChange={() => {}} disabled={true} />
              </div>
            </div>
          </section>

          {/* Configuration Source Section */}
          <section className="settings-section">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">{t('Configuration Source')}</h2>
                <p className="text-xs text-muted-foreground">{t('Choose which user configuration directory Kite uses')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  {t('Source Mode')}
                </label>
                <select
                  value={configSourceMode}
                  onChange={(event) => handleConfigSourceModeChange(event.target.value as ConfigSourceMode)}
                  className="w-full select-apple text-sm"
                >
                  <option value="kite">{t('Kite (~/.kite)')}</option>
                  <option value="claude">{t('Claude (~/.claude)')}</option>
                </select>
              </div>

              <div className="settings-warning text-sm">
                {t('Changing configuration source requires restart. Current session keeps existing sources until restart.')}
              </div>

              {configSourceNotice && (
                <div className="settings-info text-sm">
                  {configSourceNotice}
                </div>
              )}
            </div>
          </section>

          {/* Scene Taxonomy Section */}
          <section className="settings-section">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l8 4.5v11L12 22 4 17.5v-11L12 2zm0 2.3L6 7.5l6 3.3 6-3.3-6-3.2zm-6 5.5v6.4l5 2.8v-6.4l-5-2.8zm13 0l-5 2.8v6.4l5-2.8V9.8z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">{t('Scene Taxonomy')}</h2>
                <p className="text-xs text-muted-foreground">{t('Developer governance for scene labels and overrides')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Enable Admin Mode')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('Show scene taxonomy management UI and enable mutation APIs')}
                  </p>
                </div>
                <AppleToggle checked={taxonomyAdminEnabled} onChange={handleTaxonomyAdminToggle} />
              </div>

              {taxonomyAdminEnabled && (
                <button
                  type="button"
                  onClick={() => setView('sceneTaxonomyAdmin')}
                  className="px-4 py-2.5 text-sm rounded-xl bg-primary/15 text-primary hover:bg-primary/20 transition-colors"
                >
                  {t('Open Scene Taxonomy Manager')}
                </button>
              )}
            </div>
          </section>

          {/* Python Environment Section */}
          <section className="settings-section">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-[#3776ab]/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#3776ab]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">{t('Python Environment')}</h2>
                <p className="text-xs text-muted-foreground">{t('Built-in Python for code execution')}</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Status */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Status')}</p>
                  <p className="text-sm text-muted-foreground">
                    {pythonDetecting
                      ? t('Detecting...')
                      : pythonAvailable
                      ? `Python ${pythonEnvironment?.version || ''}`
                      : pythonError || t('Not available')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {pythonDetecting ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : pythonAvailable ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
              </div>

              {/* Environment Info */}
              {pythonAvailable && pythonEnvironment && (
                <div className="bg-secondary/50 rounded-lg p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('Type')}</span>
                    <span>{pythonEnvironment.type === 'embedded' ? t('Built-in') : t('Virtual Environment')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('Path')}</span>
                    <span className="text-xs font-mono truncate max-w-[200px]" title={pythonEnvironment.pythonPath}>
                      {pythonEnvironment.pythonPath}
                    </span>
                  </div>
                </div>
              )}

              {/* Packages Section */}
              {pythonAvailable && (
                <div className="pt-4 border-t border-border/50">
                  <button
                    onClick={() => setShowPythonPackages(!showPythonPackages)}
                    className="flex items-center gap-2 w-full text-left"
                  >
                    {showPythonPackages ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <Package className="w-4 h-4" />
                    <span className="font-medium">{t('Installed Packages')}</span>
                    <span className="text-xs text-muted-foreground">
                      ({pythonPackages.length})
                    </span>
                  </button>

                  {showPythonPackages && (
                    <div className="mt-3 space-y-3">
                      {/* Install new package */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newPackageName}
                          onChange={(e) => setNewPackageName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleInstallPackage()}
                          placeholder={t('Package name (e.g., requests)')}
                          className="flex-1 px-3 py-1.5 text-sm input-apple"
                          disabled={isInstallingPackage}
                        />
                        <button
                          onClick={handleInstallPackage}
                          disabled={isInstallingPackage || !newPackageName.trim()}
                          className="px-4 py-1.5 text-sm btn-apple"
                        >
                          {isInstallingPackage ? t('Installing...') : t('Install')}
                        </button>
                      </div>

                      {/* Install progress */}
                      {installProgress && (
                        <div className="bg-secondary/50 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-2">
                            {installProgress.phase === 'error' ? (
                              <XCircle className="w-4 h-4 text-red-500" />
                            ) : installProgress.phase === 'done' ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                            <span>{installProgress.message}</span>
                          </div>
                          {installProgress.error && (
                            <p className="mt-2 text-xs text-red-500">{installProgress.error}</p>
                          )}
                        </div>
                      )}

                      {/* Package list */}
                      {loadingPythonPackages ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : pythonPackages.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {pythonPackages.map((pkg) => (
                            <div
                              key={pkg.name}
                              className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/50 group"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{pkg.name}</span>
                                <span className="text-xs text-muted-foreground">{pkg.version}</span>
                              </div>
                              <button
                                onClick={() => handleUninstallPackage(pkg.name)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-500 transition-opacity"
                                title={t('Uninstall')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          {t('No packages installed')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Appearance Section */}
          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-5">{t('Appearance')}</h2>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Theme')}</label>
              <div className="flex gap-2.5">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((themeMode) => (
                  <button
                    key={themeMode}
                    onClick={() => handleThemeChange(themeMode)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      theme === themeMode
                        ? 'bg-primary/15 text-primary ring-2 ring-primary/30'
                        : 'bg-secondary/50 hover:bg-secondary/80 text-foreground/70'
                    }`}
                  >
                    {t(THEME_LABELS[themeMode])}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Language Section */}
          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-5">{t('Language')}</h2>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Language')}</label>
              <select
                value={getCurrentLanguage()}
                onChange={(e) => setLanguage(e.target.value as LocaleCode)}
                className="w-full px-4 py-2.5 input-apple text-sm"
              >
                {Object.entries(SUPPORTED_LOCALES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* System Section */}
          {!api.isRemoteMode() && (
            <section className="settings-section">
              <h2 className="text-base font-semibold tracking-tight mb-5">{t('System')}</h2>

              <div className="space-y-4">
                {/* Auto Launch */}
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t('Auto Launch on Startup')}</p>
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 text-xs rounded-full bg-muted text-muted-foreground cursor-help"
                        title={t('Automatically run Kite when system starts')}
                      >
                        ?
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('Automatically run Kite when system starts')}
                    </p>
                  </div>
                  <AppleToggle checked={autoLaunch} onChange={handleAutoLaunchChange} />
                </div>

                {/* Minimize to Tray */}
                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t('Background Daemon')}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('Minimize to {{trayType}} when closing window, instead of exiting the program', {
                        trayType: window.platform?.isMac ? t('menu bar') : t('system tray')
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {t('When enabled, you can remotely control anytime, click {{trayType}} icon to awaken', {
                        trayType: window.platform?.isMac ? t('menu bar') : t('tray')
                      })}
                    </p>
                  </div>
                  <AppleToggle checked={minimizeToTray} onChange={handleMinimizeToTrayChange} />
                </div>
              </div>
            </section>
          )}

          {/* MCP Servers Section */}
          <section className="settings-section">
            <McpServerList
              servers={config?.mcpServers || {}}
              onSave={handleMcpServersSave}
            />

            {/* Help text */}
            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('Format compatible with Cursor / Claude Desktop')}</span>
                <a
                  href="https://modelcontextprotocol.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  {t('Learn about MCP')} →
                </a>
              </div>
              <p className="text-xs text-amber-500/80">
                ⚠️ {t('Configuration changes will take effect after starting a new conversation')}
              </p>
            </div>
          </section>

          {/* Remote Access Section */}
          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-5">{t('Remote Access')}</h2>

            {/* Security Warning */}
            <div className="settings-warning mb-5">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-xl">⚠️</span>
                <div className="text-sm">
                  <p className="text-amber-500 font-medium mb-1">{t('Security Warning')}</p>
                  <p className="text-amber-500/80">
                    {t('After enabling remote access, anyone with the password can fully control your computer (read/write files, execute commands). Do not share the access password with untrusted people.')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Enable Remote Access')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('Allow access to Kite from other devices')}
                  </p>
                </div>
                <AppleToggle
                  checked={remoteStatus?.enabled || false}
                  onChange={handleToggleRemote}
                  disabled={isEnablingRemote}
                />
              </div>

              {/* Remote Access Details */}
              {remoteStatus?.enabled && (
                <>
                  {/* Local Access */}
                  <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t('Local Address')}</span>
                      <div className="flex items-center gap-2">
                        <code className="text-sm bg-background px-2 py-1 rounded">
                          {remoteStatus.server.localUrl}
                        </code>
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
                          <code className="text-sm bg-background px-2 py-1 rounded">
                            {remoteStatus.server.lanUrl}
                          </code>
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
                        <code className="text-sm bg-background px-2 py-1 rounded font-mono tracking-wider">
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

                  {/* Tunnel Section */}
                  <div className="pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium">{t('Internet Access')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('Get public address via Cloudflare (wait about 10 seconds for DNS resolution after startup)')}
                        </p>
                      </div>
                      <button
                        onClick={handleToggleTunnel}
                        disabled={isEnablingTunnel}
                        className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                          remoteStatus.tunnel.status === 'running'
                            ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                            : 'bg-primary/20 text-primary hover:bg-primary/30'
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
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-500">{t('Public Address')}</span>
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-background px-2 py-1 rounded text-green-500">
                              {remoteStatus.tunnel.url}
                            </code>
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
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-500">
                          {t('Tunnel connection failed')}: {remoteStatus.tunnel.error}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* QR Code */}
                  {qrCode && (
                    <div className="pt-4 border-t border-border/50">
                      <p className="font-medium mb-3">{t('Scan to Access')}</p>
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-white p-3 rounded-xl">
                          <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                        </div>
                        <div className="text-center text-sm">
                          <p className="text-muted-foreground">
                            {t('Scan the QR code with your phone and enter the password to access')}
                          </p>
                          <p className="text-amber-500 text-xs mt-1">
                            {t('QR code contains password, do not share screenshots with others')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* About Section */}
          <section className="settings-section">
            <h2 className="text-base font-semibold tracking-tight mb-5">{t('About')}</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Version')}</span>
                <span>1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Build')}</span>
                <span> Powered by Claude Code </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
