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
import { Bot, Eye, EyeOff, Info, Network, Palette, ServerCog, Shield, SlidersHorizontal, X } from 'lucide-react'
import { McpServerList } from '../components/settings/McpServerList'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { ensureAiConfig } from '../../shared/types/ai-profile'
import {
  AI_PROFILE_TEMPLATES,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
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

interface SettingsSectionDef {
  id: SettingsSectionId
  labelKey: string
  hintKey: string
  icon: LucideIcon
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'model',
    labelKey: 'Model',
    hintKey: 'Provider and model setup',
    icon: Bot
  },
  {
    id: 'appearance',
    labelKey: 'Appearance',
    hintKey: 'Theme and language',
    icon: Palette
  },
  {
    id: 'general',
    labelKey: 'General',
    hintKey: 'System behavior',
    icon: SlidersHorizontal
  },
  {
    id: 'permissions',
    labelKey: 'Permissions',
    hintKey: 'Execution and trust',
    icon: Shield
  },
  {
    id: 'mcp',
    labelKey: 'MCP',
    hintKey: 'Tool server config',
    icon: ServerCog
  },
  {
    id: 'network',
    labelKey: 'Network',
    hintKey: 'Remote access',
    icon: Network
  },
  {
    id: 'about',
    labelKey: 'About',
    hintKey: 'Version information',
    icon: Info
  }
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

  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId) || null
  const selectedCatalog = selectedProfile
    ? normalizeModelCatalog(selectedProfile.defaultModel, selectedProfile.modelCatalog)
    : []
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
  }, [selectedProfileId])

  useEffect(() => {
    setTheme(config?.appearance?.theme === 'dark' ? 'dark' : 'light')
  }, [config?.appearance?.theme])

  // Load system settings
  useEffect(() => {
    loadSystemSettings()
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

  const renderModelSection = () => (
    <section className="settings-modal-card settings-model-card">
      <div className="settings-model-grid">
        <aside className="settings-model-vendors">
          <div className="mb-2 flex items-center justify-between border-b border-border/70 pb-2">
            <label className="text-xs font-medium text-muted-foreground">{t('供应商')}</label>
            <button
              type="button"
              onClick={handleAddProfileFromTemplate}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-2xl leading-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              title={t('Add Profile')}
            >
              +
            </button>
          </div>
          <div className="space-y-1 pr-1">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedProfileId(profile.id)
                  setValidationResult(null)
                }}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                  profile.id === selectedProfileId
                    ? 'bg-secondary/85 text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg font-medium">
                  {getProfileMonogram(profile.name)}
                </div>
                <span className="flex-1 truncate text-sm md:text-[15px]">
                  {profile.name}
                </span>
                {profile.enabled !== false && (
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2f5c45]" />
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="settings-model-detail">
          {!selectedProfile ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('Please create or select a profile')}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/70 pb-4">
                <div>
                  <h3 className="text-3xl font-semibold tracking-tight">{selectedProfile.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedProfile.enabled ? t('已启用') : t('未启用')}
                  </p>
                </div>
                <AppleToggle
                  checked={selectedProfile.enabled !== false}
                  onChange={handleSelectedProfileEnabledChange}
                />
              </div>

              <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4">
                <p className="text-sm font-medium">{t('Quick setup for beginners')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('Just complete these three items first: protocol, API Key, and default model.')}
                </p>
                <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  <li>1. {t('Choose protocol')}</li>
                  <li>2. {t('Enter API Key')}</li>
                  <li>3. {t('Set default model')}</li>
                </ol>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t('API 协议格式')}</p>
                <p className="mb-3 text-xs text-muted-foreground">{t('多数国内供应商支持 Anthropic 兼容与 OpenAI 兼容')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleProtocolChange('anthropic_compat')}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                      selectedProfile.protocol !== 'openai_compat'
                        ? 'border-[#305a45] bg-[#f1f6f3] text-[#2e5642]'
                        : 'border-border bg-background text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    Anthropic 兼容
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProtocolChange('openai_compat')}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                      selectedProfile.protocol === 'openai_compat'
                        ? 'border-[#305a45] bg-[#f1f6f3] text-[#2e5642]'
                        : 'border-border bg-background text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    OpenAI 兼容
                  </button>
                </div>
              </div>

              {selectedProfile.enabled === false ? (
                <div className="rounded-2xl border border-dashed border-border bg-secondary/35 py-10 text-center">
                  <p className="text-base font-medium">{t('该供应商尚未启用')}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t('先开启右上角开关，再配置 API 密钥和模型')}</p>
                  <button
                    type="button"
                    onClick={() => handleSelectedProfileEnabledChange(true)}
                    className="mt-4 rounded-xl btn-apple px-4 py-2 text-sm"
                  >
                    {t('启用')} {selectedProfile.name}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">API Key</label>
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
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">API URL</label>
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
                      <p className="mt-1 text-xs text-destructive">{t('URL must end with /chat/completions or /responses')}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Default Model')}</label>
                    <input
                      type="text"
                      value={selectedProfile.defaultModel}
                      onChange={(event) => {
                        const nextDefaultModel = event.target.value
                        updateSelectedProfile({
                          defaultModel: nextDefaultModel,
                          modelCatalog: normalizeModelCatalog(nextDefaultModel, selectedCatalog)
                        })
                        setValidationResult(null)
                      }}
                      className="w-full input-apple px-4 py-2.5 text-sm"
                    />
                  </div>

                  <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 p-3">
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
                                    ? 'cursor-default border-[#305a45] bg-[#f1f6f3] text-[#2e5642]'
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

              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                <button
                  type="button"
                  onClick={() => selectedProfile.enabled !== false && setDefaultProfileId(selectedProfile.id)}
                  className={`rounded-xl px-4 py-2 text-sm ${
                    selectedProfile.id === defaultProfileId
                      ? 'bg-secondary text-foreground'
                      : 'bg-secondary/60 text-foreground hover:bg-secondary'
                  }`}
                  disabled={selectedProfile.enabled === false}
                >
                  {selectedProfile.id === defaultProfileId ? t('Default') : t('Set as Default')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleValidateConnection()}
                  className="rounded-xl bg-secondary px-4 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50"
                  disabled={isValidating || selectedProfile.enabled === false || selectedProfileUrlInvalid || !selectedProfile.apiKey.trim()}
                >
                  {isValidating ? t('Testing...') : t('Test Connection')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-xl btn-apple px-4 py-2 text-sm disabled:opacity-50"
                  disabled={isValidating || selectedProfileUrlInvalid || (selectedProfile.enabled !== false && !selectedProfile.apiKey.trim())}
                >
                  {isValidating ? t('Saving...') : t('Save')}
                </button>
                <button
                  type="button"
                  onClick={handleRemoveSelectedProfile}
                  className="rounded-xl bg-red-500/15 px-4 py-2 text-sm text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                  disabled={profiles.length <= 1}
                >
                  {t('Delete')}
                </button>
              </div>

              {validationResult?.message && (
                <p className={`text-sm ${validationResult.valid ? 'text-green-500' : 'text-red-500'}`}>
                  {validationResult.message}
                </p>
              )}
              {validationResult?.valid && (
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex rounded-xl border border-border/70 px-4 py-2 text-sm hover:bg-secondary/50"
                >
                  {t('Return to conversation')}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  )

  const renderAppearanceSection = () => (
    <div className="space-y-4">
      <section className="settings-modal-card">
        <h3 className="mb-4 text-base font-semibold tracking-tight">{t('Theme')}</h3>
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

      <section className="settings-modal-card">
        <h3 className="mb-4 text-base font-semibold tracking-tight">{t('Language')}</h3>
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
    <section className="settings-modal-card">
      <h3 className="mb-4 text-base font-semibold tracking-tight">{t('System')}</h3>
      {api.isRemoteMode() ? (
        <p className="text-sm text-muted-foreground">{t('System settings are unavailable in remote mode')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="font-medium">{t('Auto Launch on Startup')}</p>
              <p className="text-sm text-muted-foreground">{t('Automatically run Kite when system starts')}</p>
            </div>
            <AppleToggle checked={autoLaunch} onChange={handleAutoLaunchChange} />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4">
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
    <section className="settings-modal-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight">{t('Permissions')}</h3>
        <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
          {t('Full Permission Mode')}
        </span>
      </div>

      <div className="settings-info mb-5 text-sm text-muted-foreground">
        {t('Current version defaults to full permission mode, AI can freely perform all operations. Future versions will support fine-grained permission control.')}
      </div>

      <div className="space-y-4 opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{t('File Read/Write')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to read and create files')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{t('Execute Commands')}</p>
            <p className="text-sm text-muted-foreground">{t('Allow AI to execute terminal commands')}</p>
          </div>
          <span className="rounded-lg bg-kite-success/15 px-2.5 py-1 text-xs font-medium text-kite-success">
            {t('Allow')}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border/50 pt-4">
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
    <section className="settings-modal-card">
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
    <section className="settings-modal-card">
      <h3 className="mb-5 text-base font-semibold tracking-tight">{t('Remote Access')}</h3>

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
        <div className="flex items-center justify-between">
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
    <section className="settings-modal-card">
      <h3 className="mb-5 text-base font-semibold tracking-tight">{t('About')}</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('Version')}</span>
          <span>1.0.0</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('Build')}</span>
          <span>Powered by Claude Code</span>
        </div>
      </div>
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
            <p className="mt-1 text-xs text-muted-foreground">{t('Organized by categories')}</p>
          </div>

          <nav className="space-y-1">
            {SETTINGS_SECTIONS.map(section => {
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
          </nav>
        </aside>

        <section className="settings-modal-main">
          <header className="settings-modal-header">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{t(activeSectionMeta.labelKey)}</h2>
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
