import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, MoreHorizontal, Plus, Search, SquarePen, Terminal, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useCommandsStore, type CommandDefinition } from '../../stores/commands.store'
import { commandKey } from '../../../shared/command-utils'
import { useSpaceStore } from '../../stores/space.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { buildDirective } from '../../utils/directive-helpers'
import { useAppStore } from '../../stores/app.store'

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
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [showAllInToolkitMode, setShowAllInToolkitMode] = useState(false)
  const [updatingToolkitCommand, setUpdatingToolkitCommand] = useState<string | null>(null)
  const configSourceMode = useAppStore((state) => state.config?.configSourceMode || 'kite')
  const userConfigRoot = configSourceMode === 'claude' ? '~/.claude' : '~/.kite'

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

      {isExpanded && (
        <div
          className={`
            mt-2 w-full
            bg-card/90 backdrop-blur-xl rounded-xl border border-border/60
            shadow-sm overflow-hidden
            ${isAnimatingOut ? 'animate-fade-out' : 'animate-fade-in'}
          `}
          style={{ animationDuration: `${PANEL_ANIMATION_MS}ms` }}
        >
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-foreground">{t('Commands')}</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isToolkitMode && !showAllInToolkitMode
                  ? t('{{toolkit}} / {{total}} commands in toolkit', {
                    toolkit: toolkitCommandsCount,
                    total: totalCommandsCount
                  })
                  : t('{{count}} commands available', { count: totalCommandsCount })}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                {workDir
                  ? t('Manage files in {{root}}/commands/ and {{path}}/.claude/commands/', { root: userConfigRoot, path: workDir })
                  : t('Manage files in {{root}}/commands/', { root: userConfigRoot })}
              </p>
            </div>
            {workDir && onCreateCommand && (
              <button
                onClick={onCreateCommand}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium
                  bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
              >
                <Plus size={14} />
                {t('New command')}
              </button>
            )}
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
              <div className="px-4 py-6 text-center">
                <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">{t('Loading commands...')}</p>
              </div>
            ) : filteredCommands.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 flex items-center justify-center">
                  <Terminal size={24} className="text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {localSearchQuery
                    ? t('No commands found')
                    : (isToolkitMode && !showAllInToolkitMode ? t('No toolkit resources available') : t('No commands available'))}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {localSearchQuery
                    ? t('Try a different search term')
                    : t('Add .md files in {{root}}/commands or .claude/commands', { root: userConfigRoot })}
                </p>
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
