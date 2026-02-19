import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, MoreHorizontal, Plus, Search, SquarePen, Terminal, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useCommandsStore, type CommandDefinition } from '../../stores/commands.store'
import { commandKey } from '../../../shared/command-utils'

interface CommandsPanelProps {
  workDir?: string
  onInsertCommand?: (commandName: string) => void
  onCreateCommand?: () => void
  onOpenTemplateLibrary?: () => void
  preferInsertOnClick?: boolean
}

export function CommandsPanel({
  workDir,
  onInsertCommand,
  onCreateCommand,
  onOpenTemplateLibrary,
  preferInsertOnClick = false
}: CommandsPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPath, setMenuPath] = useState<string | null>(null)

  const { commands, loadedWorkDir, isLoading, loadCommands, deleteCommand } = useCommandsStore()

  useEffect(() => {
    if (!expanded) return
    if (commands.length === 0 || loadedWorkDir !== (workDir ?? null)) {
      void loadCommands(workDir)
    }
  }, [expanded, commands.length, loadedWorkDir, loadCommands, workDir])

  const visibleCommands = useMemo(() => {
    const spaceCommands = commands.filter(command => command.source === 'space')
    const q = query.trim().toLowerCase()
    if (!q) return spaceCommands

    return spaceCommands.filter(command => (
      commandKey(command).toLowerCase().includes(q) ||
      command.description?.toLowerCase().includes(q)
    ))
  }, [commands, query])

  return (
    <div className="rounded-lg border border-border/40 bg-card/20">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="inline-flex items-center gap-1"><Terminal size={12} />{t('Commands')}</span>
        <ChevronDown size={14} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-md hover:bg-secondary/70" title={t('Create command')} onClick={() => onCreateCommand?.()}>
              <SquarePen size={14} />
            </button>
            <button className="p-1.5 rounded-md hover:bg-secondary/70" title={t('Template Library')} onClick={onOpenTemplateLibrary}>
              <Plus size={14} />
            </button>
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search commands...')}
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-border/40"
            />
          </div>

          <div className="max-h-56 overflow-auto space-y-1">
            {isLoading ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">{t('Loading...')}</div>
            ) : visibleCommands.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2 py-2">
                {t('Agent can suggest creating Commands in chat. You can also click ➕ to import from Template Library.')}
              </div>
            ) : (
              visibleCommands.map((command) => {
                const key = commandKey(command)
                return (
                  <div
                    key={command.path}
                    className="relative rounded-md px-2 py-1.5 hover:bg-secondary/50 group"
                    onClick={() => {
                      if (preferInsertOnClick && onInsertCommand) {
                        onInsertCommand(key)
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">/{key}</div>
                        {command.description && <div className="text-[11px] text-muted-foreground truncate">{command.description}</div>}
                      </div>
                      <button
                        className="p-1 rounded hover:bg-secondary opacity-0 group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          setMenuPath(prev => prev === command.path ? null : command.path)
                        }}
                      >
                        <MoreHorizontal size={12} />
                      </button>
                    </div>

                    {menuPath === command.path && (
                      <div className="absolute right-1 top-8 z-20 rounded-md border border-border bg-popover shadow-lg p-1 min-w-[120px]">
                        {onInsertCommand && (
                          <button className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded" onClick={() => onInsertCommand(key)}>{t('Insert')}</button>
                        )}
                        <button
                          className="w-full text-left text-xs px-2 py-1 hover:bg-secondary rounded"
                          onClick={() => {
                            void navigator.clipboard.writeText(key)
                            setMenuPath(null)
                          }}
                        >
                          {t('Copy name')}
                        </button>
                        <button
                          className="w-full text-left text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded"
                          onClick={() => void deleteCommand(command.path)}
                        >
                          <span className="inline-flex items-center gap-1"><Trash2 size={12} />{t('Delete')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
