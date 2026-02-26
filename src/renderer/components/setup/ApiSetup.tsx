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
import type { ApiProfile, ProviderProtocol, ProviderVendor } from '../../types'
import { ensureAiConfig } from '../../../shared/types/ai-profile'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n'
import {
  AI_PROFILE_TEMPLATES,
  API_KEY_PLACEHOLDER_BY_PROTOCOL,
  API_URL_PLACEHOLDER_BY_PROTOCOL,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  PROTOCOL_LABELS,
  VENDOR_LABELS,
  type AiProfileTemplate
} from '../settings/aiProfileDomain'

function matchTemplate(profile: ApiProfile | null): AiProfileTemplate {
  if (!profile) return AI_PROFILE_TEMPLATES[0]
  return (
    AI_PROFILE_TEMPLATES.find(template => template.vendor === profile.vendor && template.protocol === profile.protocol) ||
    AI_PROFILE_TEMPLATES[0]
  )
}

export function ApiSetup() {
  const { t } = useTranslation()
  const { config, setConfig, setView } = useAppStore()

  const aiConfig = ensureAiConfig(config?.ai, config?.api)
  const currentProfile =
    aiConfig.profiles.find(profile => profile.id === aiConfig.defaultProfileId) ||
    aiConfig.profiles[0] ||
    null
  const initialTemplate = matchTemplate(currentProfile)

  const [templateKey, setTemplateKey] = useState(initialTemplate.key)
  const [profileName, setProfileName] = useState(currentProfile?.name || 'Default Profile')
  const [vendor, setVendor] = useState<ProviderVendor>(currentProfile?.vendor || initialTemplate.vendor)
  const [protocol, setProtocol] = useState<ProviderProtocol>(currentProfile?.protocol || initialTemplate.protocol)
  const [apiKey, setApiKey] = useState(currentProfile?.apiKey || '')
  const [apiUrl, setApiUrl] = useState(currentProfile?.apiUrl || initialTemplate.apiUrl)
  const [defaultModel, setDefaultModel] = useState(currentProfile?.defaultModel || initialTemplate.defaultModel)
  const [modelCatalogInput, setModelCatalogInput] = useState(
    normalizeModelCatalog(
      currentProfile?.defaultModel || initialTemplate.defaultModel,
      currentProfile?.modelCatalog?.length ? currentProfile.modelCatalog : initialTemplate.modelCatalog
    ).join(', ')
  )
  const [docUrl, setDocUrl] = useState(currentProfile?.docUrl || initialTemplate.docUrl)

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Language selector state
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false)
  const [currentLang, setCurrentLang] = useState<LocaleCode>(getCurrentLanguage())

  // Handle language change
  const handleLanguageChange = (lang: LocaleCode) => {
    setLanguage(lang)
    setCurrentLang(lang)
    setIsLangDropdownOpen(false)
  }

  const handleTemplateChange = (nextTemplateKey: string) => {
    const template = AI_PROFILE_TEMPLATES.find(item => item.key === nextTemplateKey)
    if (!template) return

    setTemplateKey(nextTemplateKey)
    setVendor(template.vendor)
    setProtocol(template.protocol)
    setApiUrl(template.apiUrl)
    setDefaultModel(template.defaultModel)
    setModelCatalogInput(normalizeModelCatalog(template.defaultModel, template.modelCatalog).join(', '))
    setDocUrl(template.docUrl)
    setError(null)
  }

  // Handle save and enter
  const handleSaveAndEnter = async () => {
    if (!apiKey.trim()) {
      setError(t('Please enter API Key'))
      return
    }

    if (protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(apiUrl)) {
      setError(t('URL must end with /chat/completions or /responses'))
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const normalizedModel = defaultModel.trim() || initialTemplate.defaultModel
      const modelCatalog = normalizeModelCatalog(normalizedModel, modelCatalogInput)

      const profileId = currentProfile?.id || 'default-profile'
      const profile: ApiProfile = {
        id: profileId,
        name: profileName.trim() || 'Default Profile',
        vendor,
        protocol,
        apiKey: apiKey.trim(),
        apiUrl: apiUrl.trim(),
        defaultModel: normalizedModel,
        modelCatalog,
        docUrl: docUrl.trim() || undefined,
        enabled: true
      }

      const ai = {
        profiles: [profile],
        defaultProfileId: profile.id
      }

      await api.setConfig({
        ai,
        isFirstLaunch: false
      })

      const newConfig = {
        ...config,
        ai,
        isFirstLaunch: false
      }

      setConfig(newConfig as any)
      setView('home')
    } catch (err) {
      setError(t('Save failed, please try again'))
      setIsSaving(false)
    }
  }

  const currentStep = apiKey.trim() ? 3 : 2

  return (
    <div className="h-full w-full flex flex-col items-center justify-start sm:justify-center bg-background px-6 py-8 sm:p-8 relative overflow-y-auto overflow-x-hidden">
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
          <p className="mt-1.5 text-sm text-muted-foreground">{t('Before you start, create your default AI profile')}</p>
        </div>

        {/* Form card */}
        <div className="glass-dialog p-6 stagger-item" style={{ animationDelay: '80ms' }}>
          <div className="mb-4">
            <div className="mb-3 flex items-center justify-center gap-2">
              {[1, 2, 3].map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                  <span
                    className={[
                      'inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                      currentStep >= step
                        ? 'border-primary/50 bg-primary/20 text-primary'
                        : 'border-border/50 bg-secondary/40 text-muted-foreground'
                    ].join(' ')}
                  >
                    {step}
                  </span>
                  {index < 2 && (
                    <span className={`h-px w-8 ${currentStep > step ? 'bg-primary/50' : 'bg-border/60'}`} />
                  )}
                </div>
              ))}
            </div>

            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Choose Provider')}</label>
            <div className="grid grid-cols-3 gap-2">
              {AI_PROFILE_TEMPLATES.map(template => {
                const selected = templateKey === template.key
                return (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => handleTemplateChange(template.key)}
                    className={[
                      'rounded-xl border px-2 py-2 text-xs transition-colors',
                      selected
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/50 bg-secondary/30 text-foreground/80 hover:bg-secondary/45'
                    ].join(' ')}
                  >
                    {t(template.label)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Profile Name')}</label>
            <input
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="px-3 py-2.5 rounded-xl bg-secondary/40 text-sm">
              <span className="text-muted-foreground mr-1">{t('Vendor')}:</span>
              <span>{t(VENDOR_LABELS[vendor])}</span>
            </div>
            <div className="px-3 py-2.5 rounded-xl bg-secondary/40 text-sm">
              <span className="text-muted-foreground mr-1">{t('Protocol')}:</span>
              <span>{t(PROTOCOL_LABELS[protocol])}</span>
            </div>
          </div>

          {/* API Key */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={API_KEY_PLACEHOLDER_BY_PROTOCOL[protocol]}
              className="w-full px-4 py-2.5 input-apple text-sm"
              autoFocus
            />
          </div>

          {/* API URL */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder={API_URL_PLACEHOLDER_BY_PROTOCOL[protocol]}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
            {protocol === 'openai_compat' && apiUrl && !isValidOpenAICompatEndpoint(apiUrl) && (
              <p className="mt-1.5 text-xs text-destructive">
                {t('URL must end with /chat/completions or /responses')}
              </p>
            )}
          </div>

          {/* Default Model */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Default Model')}</label>
            <input
              type="text"
              value={defaultModel}
              onChange={(event) => {
                const nextDefaultModel = event.target.value
                setDefaultModel(nextDefaultModel)
                setModelCatalogInput(normalizeModelCatalog(nextDefaultModel, modelCatalogInput).join(', '))
              }}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Model Catalog (comma separated)')}</label>
            <input
              type="text"
              value={modelCatalogInput}
              onChange={(event) => setModelCatalogInput(event.target.value)}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
          </div>

          <div className="mb-2">
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t('Doc URL')}</label>
            <input
              type="text"
              value={docUrl}
              onChange={(event) => setDocUrl(event.target.value)}
              className="w-full px-4 py-2.5 input-apple text-sm"
            />
          </div>
        </div>

        {/* Help link */}
        <p className="text-center mt-5 text-sm text-muted-foreground stagger-item" style={{ animationDelay: '140ms' }}>
          <a
            href={docUrl || 'https://console.anthropic.com/'}
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
          {isSaving ? t('Saving...') : t('Create default profile and enter')}
        </button>
      </div>
    </div>
  )
}
