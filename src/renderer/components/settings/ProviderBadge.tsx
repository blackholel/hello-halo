import { useTranslation } from '../../i18n'
import type { ProviderProtocol, ProviderVendor } from '../../types'
import { PROTOCOL_LABELS, VENDOR_LABELS } from './aiProfileDomain'

interface ProviderBadgeProps {
  vendor: ProviderVendor
  protocol?: ProviderProtocol
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const PROVIDER_COLORS: Record<ProviderVendor, { bg: string; text: string; border: string }> = {
  anthropic: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/25' },
  openai: { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/25' },
  minimax: { bg: 'bg-cyan-500/10', text: 'text-cyan-500', border: 'border-cyan-500/25' },
  moonshot: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/25' },
  zhipu: { bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/25' },
  custom: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/25' }
}

export function ProviderBadge({
  vendor,
  protocol,
  size = 'md',
  showLabel = true
}: ProviderBadgeProps) {
  const { t } = useTranslation()
  const color = PROVIDER_COLORS[vendor]
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  if (!showLabel) {
    return (
      <span
        className={`inline-flex h-2.5 w-2.5 rounded-full border ${color.bg} ${color.border}`}
        title={t(VENDOR_LABELS[vendor])}
      />
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-medium ${sizeClass} ${color.bg} ${color.text} ${color.border}`}
      title={protocol ? t(PROTOCOL_LABELS[protocol]) : undefined}
    >
      <span className="truncate">{t(VENDOR_LABELS[vendor])}</span>
      {protocol && size === 'md' && (
        <span className="opacity-70">{t(PROTOCOL_LABELS[protocol])}</span>
      )}
    </span>
  )
}
