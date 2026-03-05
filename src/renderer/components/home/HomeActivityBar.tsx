import { LayoutGrid, Plus, Puzzle, Settings, Sparkles } from 'lucide-react'
import { useTranslation } from '../../i18n'

type HomeTab = 'spaces' | 'extensions'

interface HomeActivityBarProps {
  activeTab: HomeTab
  onTabChange: (tab: HomeTab) => void
  onCreateSpace: () => void
  onOpenSettings: () => void
  spacesCount?: number
  extensionsCount?: number
  className?: string
}

interface TabItem {
  tab: HomeTab
  label: string
  icon: typeof LayoutGrid
  count: number
}

export function HomeActivityBar({
  activeTab,
  onTabChange,
  onCreateSpace,
  onOpenSettings,
  spacesCount = 0,
  extensionsCount = 0,
  className = ''
}: HomeActivityBarProps): JSX.Element {
  const { t } = useTranslation()

  const tabs: TabItem[] = [
    { tab: 'spaces', label: t('Spaces'), icon: LayoutGrid, count: spacesCount },
    { tab: 'extensions', label: t('Extensions'), icon: Puzzle, count: extensionsCount }
  ]

  return (
    <aside className={`w-64 border-r border-border/70 bg-card/75 backdrop-blur-xl ${className}`}>
      <div className="h-full flex flex-col px-3 py-4">
        <div className="flex items-center gap-3 px-2 pb-4 border-b border-border/60">
          <div className="w-9 h-9 rounded-xl bg-secondary/85 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-foreground/85" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-foreground">Kite</p>
            <p className="text-[11px] text-muted-foreground">{t('Home')}</p>
          </div>
        </div>

        <div className="pt-3 space-y-1.5">
          {tabs.map(({ tab, label, icon: Icon, count }) => {
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={`w-full h-10 rounded-xl px-3 flex items-center justify-between transition-all duration-200 ${
                  isActive
                    ? 'bg-primary/12 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/65 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm">
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-primary/15 text-primary/85' : 'bg-secondary/70 text-muted-foreground'
                }`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onCreateSpace}
          className="mt-3 w-full h-10 rounded-xl px-3 flex items-center justify-center gap-2 text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          {t('New')}
        </button>

        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full h-10 rounded-xl px-3 flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-all duration-200"
          >
            <Settings className="w-4 h-4" />
            <span>{t('Settings')}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

export type { HomeTab }
