/**
 * CommandEditorModal - Modal for creating and editing commands
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Save, Terminal } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useCommandsStore, type CommandDefinition } from '../../stores/commands.store'

interface CommandEditorModalProps {
  command?: CommandDefinition
  workDir: string
  onClose: () => void
  onSaved?: (command: CommandDefinition) => void
}

const DEFAULT_COMMAND_TEMPLATE = `# My Command

Describe what this command does.

## Usage

Explain how and when to use this command.
`

export function CommandEditorModal({ command, workDir, onClose, onSaved }: CommandEditorModalProps): JSX.Element {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [name, setName] = useState(command?.name || '')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditMode = !!command
  const { getCommandContent, createCommand, updateCommand } = useCommandsStore()

  useEffect(() => {
    if (isEditMode && command) {
      const loadContent = async (): Promise<void> => {
        setIsLoading(true)
        const result = await getCommandContent(command.name, workDir)
        if (result) {
          setContent(result)
        }
        setIsLoading(false)
      }
      void loadContent()
    } else {
      setContent(DEFAULT_COMMAND_TEMPLATE)
    }
  }, [isEditMode, command, workDir, getCommandContent])

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading])

  // Use a ref to always hold the latest handleSave, avoiding stale closures in keydown listener
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        void handleSaveRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const validateName = (value: string): string | null => {
    if (!value.trim()) {
      return t('Command name is required')
    }
    if (!/^[a-z0-9-]+$/.test(value)) {
      return t('Command name can only contain lowercase letters, numbers, and hyphens')
    }
    if (value.length > 50) {
      return t('Command name must be 50 characters or less')
    }
    return null
  }

  const handleSave = useCallback(async (): Promise<void> => {
    if (!isEditMode) {
      const nameError = validateName(name)
      if (nameError) {
        setError(nameError)
        return
      }
    }

    if (!content.trim()) {
      setError(t('Command content is required'))
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      if (isEditMode && command) {
        const success = await updateCommand(command.path, content)
        if (success) {
          onClose()
        } else {
          setError(t('Failed to update command'))
        }
      } else {
        const newCommand = await createCommand(workDir, name, content)
        if (newCommand) {
          onSaved?.(newCommand)
          onClose()
        } else {
          setError(t('Failed to create command'))
        }
      }
    } catch (err) {
      console.error('Failed to save command:', err)
      setError(t('An error occurred while saving'))
    } finally {
      setIsSaving(false)
    }
  }, [isEditMode, name, content, command, workDir, onClose, onSaved, createCommand, updateCommand, t])

  // Keep the ref in sync with the latest handleSave
  useEffect(() => {
    handleSaveRef.current = handleSave
  }, [handleSave])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 glass-overlay animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 glass-dialog
        border border-border/50 shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Terminal size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('Edit Command') : t('Create New Command')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isEditMode
                  ? t('Modify the command content below')
                  : t('Create a new command for your workspace')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t('Command Name')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">/</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder="my-command-name"
                      className="flex-1 px-3 py-2 bg-input border border-border rounded-lg
                        focus:outline-none focus:border-primary text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('Command Content')}
                </label>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full min-h-[360px] px-3 py-2 bg-input border border-border rounded-lg
                    focus:outline-none focus:border-primary text-sm font-mono resize-none"
                  placeholder={t('Enter command content in Markdown format...')}
                />
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/30 flex-shrink-0">
          <div />
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg
              bg-primary text-primary-foreground hover:bg-primary/90 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span className="text-sm">{t('Save')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

