import { useEffect, useState, useCallback } from 'react'
import { Eye, Code, Copy, Save, Check, Hammer } from 'lucide-react'
import Editor, { type OnMount, type OnChange, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCodeSync } from '../../../lib/highlight-loader'
import type { CanvasTab } from '../../../stores/canvas.store'
import { useTranslation } from '../../../i18n'

loader.config({ monaco })

interface PlanEditorProps {
  tab: CanvasTab
  onContentChange?: (content: string) => void
  onBuild?: (content: string) => void | Promise<void>
}

export function PlanEditor({ tab, onContentChange, onBuild }: PlanEditorProps) {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  const [isDarkTheme, setIsDarkTheme] = useState(() => !document.documentElement.classList.contains('light'))
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [building, setBuilding] = useState(false)
  const content = tab.content || ''

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkTheme(!document.documentElement.classList.contains('light'))
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => observer.disconnect()
  }, [])

  const handleEditorMount: OnMount = useCallback((editor) => {
    editor.focus()
  }, [])

  const handleChange: OnChange = useCallback((value) => {
    if (value !== undefined && onContentChange) {
      onContentChange(value)
    }
  }, [onContentChange])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy plan:', error)
    }
  }, [content])

  const handleSave = useCallback(() => {
    try {
      const timestamp = new Date().toISOString().slice(0, 10)
      const filename = `plan-${timestamp}-${Date.now()}.md`
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save plan:', error)
    }
  }, [content])

  const handleBuild = useCallback(async () => {
    if (!onBuild || !content.trim()) return

    const confirmed = window.confirm(
      t('Confirm execute this plan? It will be sent in execution mode.')
    )
    if (!confirmed) {
      return
    }

    try {
      setBuilding(true)
      await onBuild(content)
    } finally {
      setBuilding(false)
    }
  }, [content, onBuild, t])

  return (
    <div className="relative flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-secondary/50 p-0.5">
            <button
              onClick={() => setViewMode('edit')}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'edit'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <Code className="w-3.5 h-3.5" />
              {t('Edit')}
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                ${viewMode === 'preview'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              <Eye className="w-3.5 h-3.5" />
              {t('Preview')}
            </button>
          </div>
          {tab.isDirty && <span className="text-xs text-amber-500">{t('Modified')}</span>}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            title={t('Copy')}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          <button
            onClick={handleSave}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            title={t('Save')}
          >
            {saved ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Save className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          <button
            onClick={handleBuild}
            disabled={!content.trim() || building || !onBuild}
            className="h-8 px-3 flex items-center gap-1.5 rounded-md text-xs font-medium bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t('Build')}
          >
            <Hammer className="w-3.5 h-3.5" />
            {building ? t('Building...') : t('Build')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {viewMode === 'edit' ? (
          <Editor
            height="100%"
            language="markdown"
            value={content}
            theme={isDarkTheme ? 'vs-dark' : 'light'}
            onMount={handleEditorMount}
            onChange={handleChange}
            options={{
              fontSize: 13,
              lineNumbers: 'on',
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              padding: {
                top: 16,
                bottom: 16,
              },
            }}
            loading={<div className="flex items-center justify-center h-full text-muted-foreground">{t('Loading editor...')}</div>}
          />
        ) : (
          <div className="h-full overflow-auto">
            <div className={`prose prose-sm max-w-none p-6 ${isDarkTheme ? 'prose-invert' : ''}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    const language = match ? match[1] : ''
                    const code = String(children).replace(/\n$/, '')

                    if (inline) {
                      return (
                        <code className="bg-muted px-1.5 py-0.5 rounded text-sm" {...props}>
                          {children}
                        </code>
                      )
                    }

                    const highlighted = highlightCodeSync(code, language)

                    return (
                      <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
                        <code
                          className={`hljs ${language ? `language-${language}` : ''}`}
                          dangerouslySetInnerHTML={{ __html: highlighted }}
                        />
                      </pre>
                    )
                  },
                  table({ children }) {
                    return (
                      <div className="overflow-x-auto">
                        <table className="min-w-full">{children}</table>
                      </div>
                    )
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

