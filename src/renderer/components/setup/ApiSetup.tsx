/**
 * API Setup - Apple-inspired first-time configuration
 *
 * Design:
 * - Centered layout with ambient background
 * - Large rounded logo with glass glow
 * - Glass card form with refined inputs
 * - Language selector top-right
 */

import { useState } from 'react'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../api'
import { Lightbulb } from '../icons/ToolIcons'
import { Globe, ChevronDown } from 'lucide-react'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../types'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n'

export function ApiSetup() {
  const { t } = useTranslation()
  const { config, setConfig, setView } = useAppStore()

  // Form state
  const [provider, setProvider] = useState(config?.api.provider || 'anthropic')
  const [apiKey, setApiKey] = useState(config?.api.apiKey || '')
  const [apiUrl, setApiUrl] = useState(config?.api.apiUrl || 'https://api.anthropic.com')
  const [model, setModel] = useState(config?.api.model || DEFAULT_MODEL)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const currentModel = config?.api.model || DEFAULT_MODEL
    return !AVAILABLE_MODELS.some(m => m.id === currentModel)
  })

  // Language selector state
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false)
  const [currentLang, setCurrentLang] = useState<LocaleCode>(getCurrentLanguage())

  // Handle language change
  const handleLanguageChange = (lang: LocaleCode) => {
    setLanguage(lang)
    setCurrentLang(lang)
    setIsLangDropdownOpen(false)
  }

  const handleProviderChange = (next: string) => {
    setProvider(next)
    setError(null)

    if (next === 'anthropic') {
      if (!apiUrl || apiUrl.includes('openai')) setApiUrl('https://api.anthropic.com')
      if (!model || !model.startsWith('claude-')) {
        setModel(DEFAULT_MODEL)
        setUseCustomModel(false)
      }
    } else if (next === 'openai') {
      if (!apiUrl || apiUrl.includes('anthropic')) setApiUrl('https://api.openai.com')
      if (!model || model.startsWith('claude-')) setModel('gpt-4o-mini')
    }
  }

  // Handle save and enter
  const handleSaveAndEnter = async () => {
    if (!apiKey.trim()) {
      setError(t('Please enter API Key'))
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const newConfig = {
        ...config,
        api: {
          provider: provider as any,
          apiKey,
          apiUrl: apiUrl || 'https://api.anthropic.com',
          model
        },
        isFirstLaunch: false
      }

      await api.setConfig(newConfig)
      setConfig(newConfig as any)
      setView('home')
    } catch (err) {
      setError(t('Save failed, please try again'))
      setIsSaving(false)
    }
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background p-8 relative overflow-hidden">
      {/* Ambient background */}
      <div className="ambient-bg">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
      </div>

      {/* Language Selector - Top Right */}
      <div className="absolute top-6 right-6 z-20">
        <div className="relative">
          <button
            onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl transition-all duration-200"
          >
            <Globe className="w-4 h-4" />
            <span>{SUPPORTED_LOCALES[currentLang]}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isLangDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsLangDropdownOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 py-1 w-40 glass-dialog !rounded-xl !p-1 z-20">
                {Object.entries(SUPPORTED_LOCALES).map(([code, name]) => (
                  <button
                    key={code}
                    onClick={() => handleLanguageChange(code as LocaleCode)}
                    className={`w-full px-3 py-2 text-left text-sm rounded-lg transition-colors ${
                      currentLang === code ? 'text-primary bg-primary/10 font-medium' : 'text-foreground hover:bg-secondary/50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="w-full max-w-md relative z-10">
        {/* Logo & Header */}
        <div className="flex flex-col items-center mb-10 stagger-item" style={{ animationDelay: '0ms' }}>
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/40 to-primary/10 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-primary/60" />
              </div>
            </div>
            <div className="absolute -inset-4 rounded-[2rem] bg-primary/5 blur-xl -z-10" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Kite</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('Before you start, configure your AI')}</p>
        </div>

        {/* Form card */}
        <div className="glass-dialog p-6 stagger-item" style={{ animationDelay: '80ms' }}>
          {/* Provider */}
          <div className="mb-5 flex items-center gap-3 p-3.5 rounded-xl bg-secondary/30">
            <div className="w-9 h-9 rounded-xl bg-[#da7756]/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[#da7756]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.709 15.955l4.72-2.647.08-.08 2.726-1.529.08-.08 6.206-3.48a.25.25 0 00.125-.216V6.177a.25.25 0 00-.375-.217l-6.206 3.48-.08.08-2.726 1.53-.08.079-4.72 2.647a.25.25 0 00-.125.217v1.746c0 .18.193.294.354.216h.001zm13.937-3.584l-4.72 2.647-.08.08-2.726 1.529-.08.08-6.206 3.48a.25.25 0 00-.125.216v1.746a.25.25 0 00.375.217l6.206-3.48.08-.08 2.726-1.53.08-.079 4.72-2.647a.25.25 0 00.125-.217v-1.746a.25.25 0 00-.375-.216z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {provider === 'anthropic' ? t('Claude (Recommended)') : t('OpenAI Compatible')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {provider === 'openai'
                  ? t('Support OpenAI/compatible models via local protocol conversion')
                  : t('Connect directly to Anthropic official or compatible proxy')}
              </p>
            </div>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="select-apple text-sm w-auto"
            >
              <option value="anthropic">{t('Claude (Recommended)')}</option>
              <option value="openai">{t('OpenAI Compatible')}</option>
            </select>
          </div>

          {/* API Key */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'openai' ? 'sk-xxxxxxxxxxxxx' : 'sk-ant-xxxxxxxxxxxxx'}
              className="w-full px-4 py-2.5 input-apple text-sm"
              autoFocus
            />
          </div>

          {/* API URL */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('API URL (optional)')}</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={provider === 'openai' ? 'https://api.openai.com or https://xx/v1' : 'https://api.anthropic.com'}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
            <p className="mt-1.5 text-xs text-muted-foreground/60">
              {provider === 'openai'
                ? t('Enter OpenAI compatible service URL (supports /v1/chat/completions)')
                : t('Default official URL, modify for custom proxy')}
            </p>
          </div>

          {/* Model */}
          <div className="mb-2">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Model')}</label>
            {provider === 'anthropic' ? (
              <>
                {useCustomModel ? (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="claude-sonnet-4-5-20250929"
                    className="w-full px-4 py-2.5 input-apple text-sm"
                  />
                ) : (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full select-apple text-sm"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60">
                    {useCustomModel
                      ? t('Enter official Claude model name')
                      : AVAILABLE_MODELS.find((m) => m.id === model)?.description}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors">
                    <input
                      type="checkbox"
                      checked={useCustomModel}
                      onChange={(e) => {
                        setUseCustomModel(e.target.checked)
                        if (!e.target.checked && !AVAILABLE_MODELS.some(m => m.id === model)) {
                          setModel(DEFAULT_MODEL)
                        }
                      }}
                      className="w-3 h-3 rounded border-border"
                    />
                    {t('Custom')}
                  </label>
                </div>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini / deepseek-chat"
                  className="w-full px-4 py-2.5 input-apple text-sm"
                />
                <p className="mt-1.5 text-xs text-muted-foreground/60">
                  {t('Enter OpenAI compatible service model name')}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Help link */}
        <p className="text-center mt-5 text-sm text-muted-foreground stagger-item" style={{ animationDelay: '140ms' }}>
          <a
            href="https://console.anthropic.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary cursor-pointer hover:underline inline-flex items-center gap-1.5"
          >
            <Lightbulb className="w-4 h-4 text-yellow-500" />
            {t("Don't know how to get it? View tutorial")}
          </a>
        </p>

        {/* Error message */}
        {error && (
          <p className="text-center mt-4 text-sm text-destructive animate-fade-in">{error}</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSaveAndEnter}
          disabled={isSaving}
          className="w-full mt-6 px-8 py-3 btn-apple text-sm stagger-item"
          style={{ animationDelay: '180ms' }}
        >
          {isSaving ? t('Saving...') : t('Save and enter')}
        </button>
      </div>
    </div>
  )
}
