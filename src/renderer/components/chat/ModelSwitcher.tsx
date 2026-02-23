import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Info, Repeat2 } from 'lucide-react'
import { useChatStore } from '../../stores/chat.store'
import { useTranslation } from '../../i18n'
import type { ApiProfile, ConversationAiConfig, KiteConfig } from '../../types'

interface ModelSwitcherConversation {
  id: string
  ai?: ConversationAiConfig
}

interface ModelSwitcherProps {
  conversation: ModelSwitcherConversation | null
  config: KiteConfig | null
  spaceId: string | null
  isGenerating: boolean
}

function buildModelCatalog(profile: ApiProfile | null): string[] {
  if (!profile) return []
  const values = [profile.defaultModel, ...profile.modelCatalog]
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

export function ModelSwitcher({
  conversation,
  config,
  spaceId,
  isGenerating
}: ModelSwitcherProps) {
  const { t } = useTranslation()
  const updateConversationAi = useChatStore(state => state.updateConversationAi)
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const allProfiles = config?.ai?.profiles || []
  const boundProfileId = conversation?.ai?.profileId
  const profiles = useMemo(() => {
    const enabledProfiles = allProfiles.filter(profile => profile.enabled !== false)
    const visibleProfiles = enabledProfiles.length > 0 ? enabledProfiles : allProfiles
    const boundProfile = boundProfileId
      ? allProfiles.find(profile => profile.id === boundProfileId)
      : null

    if (boundProfile && !visibleProfiles.some(profile => profile.id === boundProfile.id)) {
      return [boundProfile, ...visibleProfiles]
    }

    return visibleProfiles
  }, [allProfiles, boundProfileId])

  const fallbackProfileId = config?.ai?.defaultProfileId || profiles[0]?.id || ''
  const profileId = conversation?.ai?.profileId || fallbackProfileId
  const activeProfile =
    allProfiles.find(profile => profile.id === profileId) ||
    profiles.find(profile => profile.id === profileId) ||
    profiles[0] ||
    null
  const activeProfileName = activeProfile?.name || t('No profile')
  const modelOverride = conversation?.ai?.modelOverride?.trim() || ''
  const effectiveModel = modelOverride || activeProfile?.defaultModel || ''
  const modelCatalog = useMemo(() => buildModelCatalog(activeProfile), [activeProfile])

  const disableReason = useMemo(() => {
    if (isGenerating) return t('Stop generation before switching model')
    if (!spaceId || !conversation?.id) return t('No active conversation')
    if (profiles.length === 0) return t('No available API profile')
    if (isSaving) return t('Updating model...')
    return ''
  }, [conversation?.id, isGenerating, isSaving, profiles.length, spaceId, t])

  const isDisabled = Boolean(disableReason)
  const displayLabel = effectiveModel
    ? `${activeProfileName} · ${effectiveModel}`
    : activeProfileName

  useEffect(() => {
    setCustomModelInput(modelOverride)
  }, [modelOverride, profileId])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (isGenerating && isOpen) {
      setIsOpen(false)
    }
  }, [isGenerating, isOpen])

  const persistConversationAi = useCallback(async (nextProfileId: string, nextModelOverride: string) => {
    if (!spaceId || !conversation?.id) return false

    setIsSaving(true)
    try {
      const success = await updateConversationAi(spaceId, conversation.id, {
        profileId: nextProfileId,
        modelOverride: nextModelOverride.trim()
      })

      if (!success) {
        console.error('[ModelSwitcher] Failed to update conversation ai config')
      }
      return success
    } finally {
      setIsSaving(false)
    }
  }, [conversation?.id, spaceId, updateConversationAi])

  const handleProfileSelect = useCallback(async (nextProfileId: string) => {
    if (isDisabled) return
    const success = await persistConversationAi(nextProfileId, '')
    if (success) {
      setCustomModelInput('')
      setIsOpen(false)
    }
  }, [isDisabled, persistConversationAi])

  const handleModelSelect = useCallback(async (model: string) => {
    if (isDisabled || !activeProfile) return
    const override = model === activeProfile.defaultModel ? '' : model
    const success = await persistConversationAi(activeProfile.id, override)
    if (success) {
      setCustomModelInput(override)
      setIsOpen(false)
    }
  }, [activeProfile, isDisabled, persistConversationAi])

  const handleApplyCustomModel = useCallback(async () => {
    if (isDisabled || !activeProfile) return
    const normalizedModel = customModelInput.trim()
    const override = normalizedModel && normalizedModel !== activeProfile.defaultModel
      ? normalizedModel
      : ''
    const success = await persistConversationAi(activeProfile.id, override)
    if (success) {
      setIsOpen(false)
    }
  }, [activeProfile, customModelInput, isDisabled, persistConversationAi])

  if (!conversation || !spaceId) {
    return null
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => !isDisabled && setIsOpen(prev => !prev)}
        disabled={isDisabled}
        className={`
          h-8 max-w-[260px] flex items-center gap-1.5 px-2.5 rounded-lg border text-xs
          transition-colors duration-200
          ${isDisabled
            ? 'text-muted-foreground/50 bg-muted/30 border-border/50 cursor-not-allowed'
            : 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/15'
          }
        `}
        title={disableReason || t('Switch profile and model')}
      >
        <Cpu size={13} className="flex-shrink-0" />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isGenerating && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-500">
          <Info size={12} />
          <span>{t('Model switching is disabled while generating a response')}</span>
        </div>
      )}

      {isOpen && !isDisabled && (
        <div className="absolute bottom-full left-0 mb-2 w-[340px] max-w-[80vw] bg-popover border border-border rounded-xl shadow-xl z-30 p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Repeat2 size={12} />
            <span>{t('Switch model for this session')}</span>
          </div>

          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1.5">{t('Profile')}</div>
            <div className="space-y-1 max-h-28 overflow-auto pr-1">
              {profiles.map(profile => {
                const selected = profile.id === activeProfile?.id
                return (
                  <button
                    key={profile.id}
                    onClick={() => handleProfileSelect(profile.id)}
                    className={`
                      w-full px-2 py-1.5 rounded-md text-left text-xs transition-colors
                      flex items-center justify-between gap-2
                      ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'}
                    `}
                  >
                    <span className="truncate">
                      {profile.name}
                      {profile.enabled === false && <span className="ml-1 text-amber-500">({t('Disabled')})</span>}
                    </span>
                    {selected && <Check size={13} className="flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {activeProfile && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1.5">{t('Model Catalog')}</div>
              <div className="space-y-1 max-h-32 overflow-auto pr-1">
                {modelCatalog.map(model => {
                  const selected = model === effectiveModel
                  return (
                    <button
                      key={model}
                      onClick={() => handleModelSelect(model)}
                      className={`
                        w-full px-2 py-1.5 rounded-md text-left text-xs transition-colors
                        flex items-center justify-between gap-2
                        ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'}
                      `}
                    >
                      <span className="truncate">{model}</span>
                      {selected && <Check size={13} className="flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {activeProfile && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1.5">{t('Custom Model')}</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customModelInput}
                  onChange={(event) => setCustomModelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleApplyCustomModel()
                    }
                  }}
                  className="flex-1 h-8 px-2 rounded-md bg-input border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
                  placeholder={t('Enter model id')}
                />
                <button
                  onClick={() => void handleApplyCustomModel()}
                  className="h-8 px-2.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {t('Apply')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
