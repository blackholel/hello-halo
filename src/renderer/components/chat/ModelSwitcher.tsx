import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu } from 'lucide-react'
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

interface ModelOption {
  profileId: string
  profileName: string
  model: string
  displayName: string
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
  const panelRef = useRef<HTMLDivElement>(null)

  const allProfiles = config?.ai?.profiles || []
  const profiles = useMemo(
    () => allProfiles.filter(profile => profile.enabled !== false),
    [allProfiles]
  )

  const modelOptions = useMemo(() => {
    const options: ModelOption[] = []
    profiles.forEach(profile => {
      const models = [profile.defaultModel, ...profile.modelCatalog]
      const uniqueModels = Array.from(new Set(models.map(m => m.trim()).filter(Boolean)))
      uniqueModels.forEach(model => {
        options.push({
          profileId: profile.id,
          profileName: profile.name,
          model,
          displayName: `${profile.name} · ${model}`
        })
      })
    })
    return options
  }, [profiles])

  const fallbackProfileId = config?.ai?.defaultProfileId || profiles[0]?.id || ''
  const profileId = conversation?.ai?.profileId || fallbackProfileId
  const activeProfile = profiles.find(p => p.id === profileId) || profiles[0] || null
  const modelOverride = conversation?.ai?.modelOverride?.trim() || ''
  const effectiveModel = modelOverride || activeProfile?.defaultModel || ''

  const currentOption = modelOptions.find(
    opt => opt.profileId === profileId && opt.model === effectiveModel
  )
  const displayLabel = currentOption?.displayName || (activeProfile?.name || t('No profile'))

  const disableReason = useMemo(() => {
    if (isGenerating) return t('Stop generation before switching model')
    if (!spaceId || !conversation?.id) return t('No active conversation')
    if (modelOptions.length === 0) return t('No available API profile')
    if (isSaving) return t('Updating model...')
    return ''
  }, [conversation?.id, isGenerating, isSaving, modelOptions.length, spaceId, t])

  const isDisabled = Boolean(disableReason)

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

  const handleModelSelect = useCallback(async (option: ModelOption) => {
    if (isDisabled || !spaceId || !conversation?.id) return
    setIsSaving(true)
    try {
      const override = option.model === profiles.find(p => p.id === option.profileId)?.defaultModel ? '' : option.model
      const success = await updateConversationAi(spaceId, conversation.id, {
        profileId: option.profileId,
        modelOverride: override
      })
      if (success) {
        setIsOpen(false)
      }
    } finally {
      setIsSaving(false)
    }
  }, [conversation?.id, isDisabled, profiles, spaceId, updateConversationAi])

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

      {isOpen && !isDisabled && (
        <div className="absolute bottom-full left-0 mb-2 w-[340px] max-w-[80vw] bg-popover border border-border rounded-xl shadow-xl z-30 p-3">
          <div className="space-y-1 max-h-64 overflow-auto">
            {modelOptions.map((option, index) => {
              const selected = option.profileId === profileId && option.model === effectiveModel
              return (
                <button
                  key={`${option.profileId}-${option.model}-${index}`}
                  onClick={() => handleModelSelect(option)}
                  className={`
                    w-full px-2 py-1.5 rounded-md text-left text-xs transition-colors
                    flex items-center justify-between gap-2
                    ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'}
                  `}
                >
                  <span className="truncate">{option.displayName}</span>
                  {selected && <Check size={13} className="flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
