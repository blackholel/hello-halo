/**
 * Code Editor - Monaco-based code editing component
 *
 * Features:
 * - Syntax highlighting via Monaco Editor
 * - Dark/Light theme support (follows system theme)
 * - Cmd+S / Ctrl+S save shortcut
 * - Content change callback
 * - Toolbar with language, line count, save button
 * - Optional minimap
 * - Word wrap support
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { Save, Check, Map } from 'lucide-react'
import Editor, { type OnMount, type OnChange, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useTranslation } from '../../../i18n'

// Configure Monaco to use local files instead of CDN (CSP blocks CDN)
loader.config({ monaco })

interface CodeEditorProps {
  tab: CanvasTab
  onContentChange?: (content: string) => void
  onSave?: () => void
}

export function CodeEditor({ tab, onContentChange, onSave }: CodeEditorProps) {
  const { t } = useTranslation()
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    // Check if document has 'light' class (our app uses 'light' class for light mode)
    return !document.documentElement.classList.contains('light')
  })
  const [showMinimap, setShowMinimap] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lineCount, setLineCount] = useState(1)

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkTheme(!document.documentElement.classList.contains('light'))
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    // Also listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = () => {
      // Only update if we're in system mode (no explicit light/dark class)
      const root = document.documentElement
      if (!root.classList.contains('light') && !root.classList.contains('dark')) {
        setIsDarkTheme(mediaQuery.matches)
      }
    }
    mediaQuery.addEventListener('change', handleMediaChange)

    return () => {
      observer.disconnect()
      mediaQuery.removeEventListener('change', handleMediaChange)
    }
  }, [])

  // Handle editor mount
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Update line count
    setLineCount(editor.getModel()?.getLineCount() || 1)

    // Add Cmd+S / Ctrl+S save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (onSave) {
        onSave()
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    })

    // Focus editor
    editor.focus()
  }, [onSave])

  // Handle content change
  const handleChange: OnChange = useCallback((value) => {
    if (value !== undefined && onContentChange) {
      onContentChange(value)
    }
    // Update line count
    if (editorRef.current) {
      setLineCount(editorRef.current.getModel()?.getLineCount() || 1)
    }
  }, [onContentChange])

  // Handle save button click
  const handleSaveClick = useCallback(() => {
    if (onSave) {
      onSave()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }, [onSave])

  // Toggle minimap
  const toggleMinimap = useCallback(() => {
    setShowMinimap(prev => !prev)
  }, [])

  // Map language to Monaco language ID
  const getMonacoLanguage = (language?: string): string => {
    if (!language) return 'plaintext'

    // Map common language names to Monaco language IDs
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'ps1': 'powershell',
      'sql': 'sql',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'markdown': 'markdown',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'graphql': 'graphql',
      'vue': 'vue',
      'svelte': 'svelte',
    }

    const lower = language.toLowerCase()
    return languageMap[lower] || lower
  }

  return (
    <div className="relative flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{tab.language || 'text'}</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{t('{{count}} lines', { count: lineCount })}</span>
          {tab.isDirty && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-yellow-500">{t('Modified')}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Minimap toggle */}
          <button
            onClick={toggleMinimap}
            className={`p-1.5 rounded hover:bg-secondary transition-colors ${showMinimap ? 'bg-secondary' : ''}`}
            title={showMinimap ? t('Hide minimap') : t('Show minimap')}
          >
            <Map className={`w-4 h-4 ${showMinimap ? 'text-primary' : 'text-muted-foreground'}`} />
          </button>

          {/* Save button */}
          {onSave && (
            <button
              onClick={handleSaveClick}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              title={t('Save (Cmd+S)')}
            >
              {saved ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Save className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={getMonacoLanguage(tab.language)}
          value={tab.content || ''}
          theme={isDarkTheme ? 'vs-dark' : 'light'}
          onMount={handleEditorMount}
          onChange={handleChange}
          options={{
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            lineNumbers: 'on',
            minimap: {
              enabled: showMinimap,
            },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            bracketPairColorization: {
              enabled: true,
            },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            padding: {
              top: 16,
              bottom: 16,
            },
          }}
          loading={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {t('Loading editor...')}
            </div>
          }
        />
      </div>
    </div>
  )
}
