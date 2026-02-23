import type { ApiProfile } from '../../types'
import { useTranslation } from '../../i18n'
import { PROTOCOL_LABELS } from './aiProfileDomain'
import { ProviderBadge } from './ProviderBadge'

interface ProfileCardProps {
  profile: ApiProfile
  isActive: boolean
  isDefault: boolean
  onClick: () => void
}

export function ProfileCard({ profile, isActive, isDefault, onClick }: ProfileCardProps) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-xl border p-3 text-left transition-colors',
        isActive ? 'border-primary/60 bg-primary/10' : 'border-border/50 bg-secondary/20 hover:bg-secondary/35',
        profile.enabled === false ? 'opacity-60' : ''
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
        {isDefault && (
          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-500">
            {t('Default')}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ProviderBadge vendor={profile.vendor} protocol={profile.protocol} size="sm" />
        <span className="text-[11px] text-muted-foreground">{t(PROTOCOL_LABELS[profile.protocol])}</span>
      </div>
      <div className="mt-2 truncate text-xs text-muted-foreground">{profile.defaultModel}</div>
    </button>
  )
}
