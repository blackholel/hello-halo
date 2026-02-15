/**
 * CommandsPanel - Collapsible panel for browsing and inserting commands
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Terminal, Search, ChevronDown, Plus } from 'lucide-react'
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
  preferInsertOnClick?: boolean
}

/** Animation duration for panel expand/collapse (ms) */
const PANEL_ANIMATION_MS = 200

/** Per-item stagger delay (ms), capped to avoid excessive delay with many commands */
const ITEM_STAGGER_MS = 30
const MAX_STAGGER_MS = 300

const SOURCE_LABELS: Record<CommandDefinition['source'], string> = {
  app: 'App',
  space: 'Space',
  plugin: 'Plugin'
}

const SOURCE_COLORS: Record<CommandDefinition['source'], string> = {
  app: 'bg-blue-500/10 text-blue-500',
  space: 'bg-green-500/10 text-green-500',
  plugin: 'bg-orange-500/10 text-orange-500'
}

export function CommandsPanel({
  workDir,
  onInsertCommand,
  onCreateCommand,
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

  const { commands, loadedWorkDir, isLoading, loadCommands } = useCommandsStore()
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const {
    loadToolkit,
    getToolkit,
    isInToolkit,
    addResource,
    removeResource,
    isToolkitLoaded
  } = useToolkitStore()

  useEffect(() => {
    if (isExpanded && (commands.length === 0 || loadedWorkDir !== (workDir ?? null))) {
      loadCommands(workDir)
    }
  }, [isExpanded, workDir, commands.length, loadedWorkDir, loadCommands])

  const isToolkitManageableSpace = !!currentSpace && !currentSpace.isTemp
  const toolkitLoaded = !!currentSpace && isToolkitLoaded(currentSpace.id)
  const toolkit = currentSpace ? getToolkit(currentSpace.id) : null
  const isToolkitMode = isToolkitManageableSpace && toolkitLoaded && toolkit !== null

  useEffect(() => {
    if (!isExpanded || !currentSpace || currentSpace.isTemp || toolkitLoaded) return
    void loadToolkit(currentSpace.id)
  }, [isExpanded, currentSpace, toolkitLoaded, loadToolkit])

  useEffect(() => {
    setShowAllInToolkitMode(false)
  }, [currentSpace?.id])

  const toolkitCommands = useMemo(() => {
    if (!isToolkitMode || !currentSpace) return [] as CommandDefinition[]
    return commands.filter(command => isInToolkit(currentSpace.id, buildDirective('command', command)))
  }, [commands, isToolkitMode, currentSpace, toolkit, isInToolkit])

  const totalCommandsCount = commands.length
  const toolkitCommandsCount = toolkitCommands.length
  const displayCommandsCount = isToolkitMode && !showAllInToolkitMode ? toolkitCommandsCount : totalCommandsCount

  const filteredCommands = useMemo(() => {
    const baseCommands = isToolkitMode && !showAllInToolkitMode
      ? toolkitCommands
      : commands

    if (!localSearchQuery.trim()) return baseCommands
    const query = localSearchQuery.toLowerCase()
    return baseCommands.filter(command =>
      commandKey(command).toLowerCase().includes(query) ||
      command.description?.toLowerCase().includes(query)
    )
  }, [commands, localSearchQuery, isToolkitMode, showAllInToolkitMode, toolkitCommands])

  const groupedCommands = useMemo(() => {
    const groups: Record<CommandDefinition['source'], CommandDefinition[]> = {
      app: [],
      space: [],
      plugin: []
    }
    for (const command of filteredCommands) {
      groups[command.source].push(command)
    }
    return groups
  }, [filteredCommands])

  const handleClose = useCallback((): void => {
    setIsAnimatingOut(true)
    setTimeout(() => {
      setIsExpanded(false)
      setIsAnimatingOut(false)
    }, PANEL_ANIMATION_MS)
  }, [])

  const handleToggle = useCallback((): void => {
    if (isExpanded) {
      handleClose()
    } else {
      setIsExpanded(true)
    }
  }, [isExpanded, handleClose])

  const insertAndClose = useCallback((command: CommandDefinition): void => {
    onInsertCommand?.(commandKey(command))
    handleClose()
  }, [onInsertCommand, handleClose])

  const handleCommandClick = useCallback((command: CommandDefinition): void => {
    if (!preferInsertOnClick || !onInsertCommand) return
    insertAndClose(command)
  }, [preferInsertOnClick, onInsertCommand, insertAndClose])

  const handleInsertButton = useCallback((command: CommandDefinition, e: React.MouseEvent): void => {
    e.stopPropagation()
    insertAndClose(command)
  }, [insertAndClose])

  const handleToggleToolkit = useCallback(async (command: CommandDefinition, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!currentSpace || currentSpace.isTemp) return

    const directive = buildDirective('command', command)
    const currentlyInToolkit = isInToolkit(currentSpace.id, directive)

    try {
      setUpdatingToolkitCommand(command.path)
      if (currentlyInToolkit) {
        await removeResource(currentSpace.id, directive)
      } else {
        await addResource(currentSpace.id, directive)
      }
    } finally {
      setUpdatingToolkitCommand(null)
    }
  }, [currentSpace, isInToolkit, addResource, removeResource])

  function renderCommandItem(command: CommandDefinition, index: number): JSX.Element {
    const key = commandKey(command)
    const staggerDelay = Math.min(index * ITEM_STAGGER_MS, MAX_STAGGER_MS)
    const commandInToolkit = isToolkitManageableSpace && currentSpace
      ? isInToolkit(currentSpace.id, buildDirective('command', command))
      : false
    const toolkitActionLabel = isToolkitMode
      ? (commandInToolkit ? t('Remove from toolkit') : t('Add to toolkit'))
      : t('Activate in space')
    return (
      <div
        key={command.path}
        onClick={() => handleCommandClick(command)}
        className="w-full px-3 py-2 text-left rounded-md transition-all duration-150
          hover:bg-muted/40 group relative cursor-pointer"
        style={{
          animation: !isAnimatingOut
            ? `fade-in 0.2s ease-out ${staggerDelay}ms forwards`
            : undefined
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-foreground truncate">
                /{key}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[command.source]}`}>
                {SOURCE_LABELS[command.source]}
              </span>
            </div>
            {command.description && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                {command.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
            {isToolkitManageableSpace && (
              <button
                onClick={(e) => handleToggleToolkit(command, e)}
                disabled={updatingToolkitCommand === command.path}
                className="px-2 py-1 text-[10px] font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                title={toolkitActionLabel}
              >
                {updatingToolkitCommand === command.path ? t('Loading...') : toolkitActionLabel}
              </button>
            )}
            {onInsertCommand && (
              <button
                onClick={(e) => handleInsertButton(command, e)}
                className="px-2 py-1 text-[10px] font-medium rounded-md
                  bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title={t('Insert to input')}
              >
                {t('Insert')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  function renderCommandGroup(source: CommandDefinition['source'], commandList: CommandDefinition[]): JSX.Element | null {
    if (commandList.length === 0) return null

    return (
      <div key={source} className="mb-2">
        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {SOURCE_LABELS[source]} ({commandList.length})
        </div>
        {commandList.map((command, index) => renderCommandItem(command, index))}
      </div>
    )
  }

  return (
    <div className="w-full">
      <button
        onClick={handleToggle}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-200
          ${isExpanded
            ? 'bg-muted/60 text-foreground border border-border/60'
            : 'hover:bg-muted/50 text-muted-foreground'
          }
        `}
        title={t('Commands')}
      >
        <span className="flex items-center gap-2">
          <Terminal size={16} className={isExpanded ? 'text-primary' : ''} />
          <span className="text-sm font-semibold">{t('Commands')}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {displayCommandsCount}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </span>
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

          <div className="px-3 py-2 border-b border-border/30">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                placeholder={t('Search commands...')}
                className="w-full pl-9 pr-3 py-2 text-xs bg-input border border-border/40
                  rounded-md focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="mt-1 flex items-center gap-2">
              {isToolkitMode && (
                <button
                  onClick={() => setShowAllInToolkitMode(prev => !prev)}
                  className="px-2 py-0.5 text-[10px] rounded text-muted-foreground hover:text-foreground"
                >
                  {showAllInToolkitMode ? t('Toolkit resources only') : t('Browse all resources')}
                </button>
              )}
              <p className="text-[10px] text-muted-foreground/60">
                {isToolkitMode && !showAllInToolkitMode
                  ? t('Toolkit mode enabled')
                  : t('Click a command to insert /name')}
              </p>
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto px-1 py-1">
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
              <div className="py-1">
                {renderCommandGroup('space', groupedCommands.space)}
                {renderCommandGroup('plugin', groupedCommands.plugin)}
                {renderCommandGroup('app', groupedCommands.app)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
