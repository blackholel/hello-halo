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
    <aside className={`w-64 border-r border-border/80 bg-secondary/55 backdrop-blur-md ${className}`}>
      <div className="h-full flex flex-col px-3 py-4">
        <div className="flex items-center gap-3 px-2 pb-4 border-b border-border/70">
          <div className="w-9 h-9 rounded-xl bg-card/80 border border-border/80 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-foreground/80" />
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
                    ? 'bg-card/90 text-foreground border border-border/85'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/55 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm">
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-background/90 text-foreground/80' : 'bg-secondary/80 text-muted-foreground'
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
          className="mt-3 w-full h-10 rounded-xl px-3 flex items-center justify-center gap-2 text-sm font-medium border border-border/85 bg-card/92 text-foreground hover:bg-card transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('New')}
        </button>

        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full h-10 rounded-xl px-3 flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all duration-200"
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
