import { Bot, Terminal, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n'

export type ComposerSuggestionTab = 'skills' | 'commands' | 'agents'

export interface ComposerSuggestionItem {
  id: string
  type: 'skill' | 'command' | 'agent'
  displayName: string
  insertText: string
  description?: string
}

interface ComposerTriggerPanelProps {
  triggerType: 'slash' | 'mention'
  activeTab: ComposerSuggestionTab
  onTabChange: (tab: ComposerSuggestionTab) => void
  tabCounts: Record<ComposerSuggestionTab, number>
  items: ComposerSuggestionItem[]
  activeIndex: number
  onHoverIndex: (index: number) => void
  onSelect: (item: ComposerSuggestionItem) => void
}

function ItemIcon({ type }: { type: ComposerSuggestionItem['type'] }): JSX.Element {
  if (type === 'agent') return <Bot size={14} className="text-blue-500" />
  if (type === 'command') return <Terminal size={14} className="text-orange-500" />
  return <Zap size={14} className="text-primary" />
}

export function ComposerTriggerPanel({
  triggerType,
  activeTab,
  onTabChange,
  tabCounts,
  items,
  activeIndex,
  onHoverIndex,
  onSelect
}: ComposerTriggerPanelProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="absolute left-2 right-2 bottom-full mb-2 z-30 rounded-xl border border-border bg-popover shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      {triggerType === 'slash' && (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-2">
          <button
            onClick={() => onTabChange('skills')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'skills'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t('Skills')} ({tabCounts.skills})
          </button>
          <button
            onClick={() => onTabChange('commands')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'commands'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t('Commands')} ({tabCounts.commands})
          </button>
          <button
            onClick={() => onTabChange('agents')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'agents'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t('Agents')} ({tabCounts.agents})
          </button>
        </div>
      )}

      <div className="max-h-64 overflow-auto py-1">
        {items.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs text-muted-foreground">
            {triggerType === 'mention' ? t('No agents found') : t('No resources found')}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              onMouseEnter={() => onHoverIndex(index)}
              onClick={() => onSelect(item)}
              className={`w-full px-3 py-2 text-left transition-colors ${
                index === activeIndex
                  ? 'bg-primary/10'
                  : 'hover:bg-muted/50'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex-shrink-0">
                  <ItemIcon type={item.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-mono text-foreground">
                    {item.type === 'agent' ? '@' : '/'}{item.displayName}
                  </p>
                  {item.description && (
                    <p className="truncate text-[11px] text-muted-foreground">{item.description}</p>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
