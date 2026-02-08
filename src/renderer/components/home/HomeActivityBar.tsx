import { LayoutGrid, Puzzle } from 'lucide-react'
import { useTranslation } from '../../i18n'

type HomeTab = 'spaces' | 'extensions'

interface HomeActivityBarProps {
  activeTab: HomeTab
  onTabChange: (tab: HomeTab) => void
  className?: string
}

interface TabItem {
  tab: HomeTab
  label: string
  icon: typeof LayoutGrid
}

export function HomeActivityBar({ activeTab, onTabChange, className = '' }: HomeActivityBarProps): JSX.Element {
  const { t } = useTranslation()

  const tabs: TabItem[] = [
    { tab: 'spaces', label: t('Spaces'), icon: LayoutGrid },
    { tab: 'extensions', label: t('Extensions'), icon: Puzzle }
  ]

  return (
    <aside className={`w-12 bg-background/60 backdrop-blur-md border-r border-border/50 ${className}`}>
      <div className="h-full flex flex-col items-center py-3 gap-1">
        {tabs.map(({ tab, label, icon: Icon }) => {
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              aria-label={label}
              title={label}
              className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
              }`}
            >
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
              <Icon className="w-[18px] h-[18px]" />
            </button>
          )
        })}
      </div>
    </aside>
  )
}

export type { HomeTab }

