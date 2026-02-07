/**
 * CommandsDropdown - Quick access dropdown for commands in chat input toolbar
 * Shows available commands for quick insertion as directive chips
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Terminal, ChevronDown } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useCommandsStore, type CommandDefinition } from '../../stores/commands.store'

interface CommandsDropdownProps {
  workDir?: string
  onInsertCommand: (command: CommandDefinition) => void
}

export function CommandsDropdown({ workDir, onInsertCommand }: CommandsDropdownProps): JSX.Element {
  const { t } = useTranslation()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { commands, loadedWorkDir, isLoading, loadCommands } = useCommandsStore()

  const closeDropdown = useCallback((): void => {
    setIsOpen(false)
    setSearch('')
  }, [])

  // Load commands when dropdown opens
  useEffect(() => {
    if (isOpen && (commands.length === 0 || loadedWorkDir !== (workDir ?? null))) {
      loadCommands(workDir)
    }
  }, [isOpen, workDir, commands.length, loadedWorkDir, loadCommands])

  // Filter commands by search
  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands
    const q = search.toLowerCase()
    return commands.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q)
    )
  }, [commands, search])

  // Close on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown()
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeDropdown()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, closeDropdown])

  function handleCommandClick(command: CommandDefinition): void {
    onInsertCommand(command)
    closeDropdown()
  }

  const toggleBtnClass = isOpen
    ? 'bg-primary/10 text-primary'
    : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'

  const chevronClass = `transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg transition-colors duration-200 ${toggleBtnClass}`}
        title={t('Commands')}
      >
        <Terminal size={15} />
        <span className="text-xs">/</span>
        <ChevronDown size={12} className={chevronClass} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-popover border border-border rounded-xl shadow-lg min-w-[220px] max-w-[300px] z-20 animate-fade-in">
          {commands.length > 5 && (
            <div className="px-3 pb-1.5">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('Search commands...')}
                className="w-full px-2 py-1.5 text-xs bg-input border border-border/40 rounded-md focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
              />
            </div>
          )}

          {isLoading ? (
            <div className="px-3 py-4 text-center">
              <div className="w-5 h-5 mx-auto border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <Terminal size={20} className="mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                {search ? t('No commands found') : t('No commands available')}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {t('Add .md files in ~/.halo/commands/')}
              </p>
            </div>
          ) : (
            <div className="max-h-[240px] overflow-auto">
              {filteredCommands.map((command) => (
                <button
                  key={command.path}
                  onClick={() => handleCommandClick(command)}
                  className="w-full px-3 py-2 flex flex-col gap-0.5 text-left text-foreground hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-mono truncate">/{command.name}</span>
                  {command.description && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {command.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
