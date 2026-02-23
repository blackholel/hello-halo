import { useMemo, useState } from 'react'
import { Eye, EyeOff, Plus } from 'lucide-react'
import type { ApiProfile, ProviderProtocol, ProviderVendor } from '../../types'
import { useTranslation } from '../../i18n'
import {
  API_KEY_PLACEHOLDER_BY_PROTOCOL,
  API_URL_PLACEHOLDER_BY_PROTOCOL,
  isValidOpenAICompatEndpoint,
  normalizeModelCatalog,
  PROTOCOL_LABELS,
  VENDOR_LABELS
} from './aiProfileDomain'
import { ModelChip } from './ModelChip'

interface ProfileEditorProps {
  profile: ApiProfile | null
  isDefault: boolean
  canDelete: boolean
  isBusy?: boolean
  validationResult?: {
    valid: boolean
    message?: string
  } | null
  onUpdate: (patch: Partial<ApiProfile>) => void
  onDelete: () => void
  onSetDefault: () => void
  onValidate: () => Promise<void>
  onSave: () => Promise<void>
  onEnabledChange: (enabled: boolean) => void
  disabled?: boolean
}

export function ProfileEditor({
  profile,
  isDefault,
  canDelete,
  isBusy = false,
  validationResult,
  onUpdate,
  onDelete,
  onSetDefault,
  onValidate,
  onSave,
  onEnabledChange,
  disabled = false
}: ProfileEditorProps) {
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState('')

  const catalog = useMemo(() => {
    if (!profile) return []
    return normalizeModelCatalog(profile.defaultModel, profile.modelCatalog)
  }, [profile])

  if (!profile) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-border/50 bg-secondary/20 text-sm text-muted-foreground">
        {t('Please create or select a profile')}
      </div>
    )
  }

  const urlInvalid = profile.protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(profile.apiUrl)

  const addModel = () => {
    const normalized = modelInput.trim()
    if (!normalized) return
    onUpdate({ modelCatalog: normalizeModelCatalog(profile.defaultModel, [...catalog, normalized]) })
    setModelInput('')
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-4 lg:p-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Profile Name')}</label>
          <input
            type="text"
            value={profile.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
            className="w-full px-4 py-2.5 input-apple text-sm"
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Vendor')}</label>
            <select
              value={profile.vendor}
              onChange={(event) => onUpdate({ vendor: event.target.value as ProviderVendor })}
              className="w-full select-apple text-sm"
              disabled={disabled}
            >
              {Object.entries(VENDOR_LABELS).map(([vendor, label]) => (
                <option key={vendor} value={vendor}>{t(label)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Protocol')}</label>
            <select
              value={profile.protocol}
              onChange={(event) => onUpdate({ protocol: event.target.value as ProviderProtocol })}
              className="w-full select-apple text-sm"
              disabled={disabled}
            >
              {Object.entries(PROTOCOL_LABELS).map(([protocol, label]) => (
                <option key={protocol} value={protocol}>{t(label)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">API Key</label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={profile.apiKey}
              onChange={(event) => onUpdate({ apiKey: event.target.value })}
              placeholder={API_KEY_PLACEHOLDER_BY_PROTOCOL[profile.protocol]}
              className="w-full px-4 py-2.5 pr-12 input-apple text-sm"
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(prev => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title={showApiKey ? t('Hide API Key') : t('Show API Key')}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">API URL</label>
          <input
            type="text"
            value={profile.apiUrl}
            onChange={(event) => onUpdate({ apiUrl: event.target.value })}
            placeholder={API_URL_PLACEHOLDER_BY_PROTOCOL[profile.protocol]}
            className="w-full px-4 py-2.5 input-apple text-sm"
            disabled={disabled}
          />
          {urlInvalid && (
            <p className="mt-1 text-xs text-destructive">{t('URL must end with /chat/completions or /responses')}</p>
          )}
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Default Model')}</label>
          <input
            type="text"
            value={profile.defaultModel}
            onChange={(event) => {
              const nextDefaultModel = event.target.value
              onUpdate({
                defaultModel: nextDefaultModel,
                modelCatalog: normalizeModelCatalog(nextDefaultModel, catalog)
              })
            }}
            className="w-full px-4 py-2.5 input-apple text-sm"
            disabled={disabled}
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Doc URL')}</label>
          <input
            type="text"
            value={profile.docUrl || ''}
            onChange={(event) => onUpdate({ docUrl: event.target.value })}
            className="w-full px-4 py-2.5 input-apple text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Model Catalog')}</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {catalog.map((modelId) => (
            <ModelChip
              key={modelId}
              modelId={modelId}
              disabled={disabled || modelId === profile.defaultModel}
              onRemove={() => {
                if (modelId === profile.defaultModel) return
                onUpdate({ modelCatalog: catalog.filter(item => item !== modelId) })
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={modelInput}
            onChange={(event) => setModelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addModel()
              }
            }}
            className="flex-1 px-4 py-2.5 input-apple text-sm"
            placeholder={t('Add model id')}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={addModel}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl bg-secondary/80 px-3 py-2 text-sm hover:bg-secondary"
            disabled={disabled}
          >
            <Plus className="h-4 w-4" />
            {t('Add')}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            {t('Enabled')}
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={() => onSetDefault()}
              disabled={!profile.enabled}
            />
            {t('Set as Default')}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <button
            type="button"
            onClick={() => void onValidate()}
            className="rounded-xl bg-secondary/80 px-4 py-2 text-sm hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isBusy || urlInvalid || !profile.apiKey.trim() || disabled}
          >
            {isBusy ? t('Testing...') : t('Test Connection')}
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="rounded-xl btn-apple px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isBusy || urlInvalid || !profile.apiKey.trim() || disabled}
          >
            {isBusy ? t('Saving...') : t('Save')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-500 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canDelete || disabled}
          >
            {t('Delete')}
          </button>
        </div>
      </div>

      {validationResult && (
        <p className={`mt-3 text-sm ${validationResult.valid ? 'text-green-500' : 'text-red-500'}`}>
          {validationResult.message}
        </p>
      )}
    </div>
  )
}
