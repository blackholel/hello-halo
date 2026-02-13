/**
 * PlanCard - Structured plan card for Plan mode responses
 *
 * Renders plan messages with a distinct visual style:
 * - Header with plan icon and label
 * - Structured markdown content with enhanced styling
 * - Action buttons: Open in Canvas, Copy, Save
 *
 * Layout:
 * ┌─────────────────────────────────────────┐
 * │ 📋 Plan                    [折叠/展开] │
 * ├─────────────────────────────────────────┤
 * │ (Structured plan content via Markdown)  │
 * ├─────────────────────────────────────────┤
 * │ [↗ Open in Canvas] [📋 Copy] [💾 Save] │
 * └─────────────────────────────────────────┘
 */

import { useState, useCallback } from 'react'
import { ClipboardList, ExternalLink, Copy, Save, ChevronDown, Check } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useTranslation } from '../../i18n'

interface PlanCardProps {
  content: string
  onOpenInCanvas?: (planContent: string) => void
  workDir?: string
}

// Shared action button for plan card footer
function PlanActionButton({
  onClick,
  title,
  variant = 'ghost',
  children,
}: {
  onClick: () => void
  title: string
  variant?: 'primary' | 'ghost'
  children: React.ReactNode
}) {
  const baseClass = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all duration-200'
  const variantClass = variant === 'primary'
    ? 'bg-kite-warning/10 text-kite-warning hover:bg-kite-warning/20 active:bg-kite-warning/30'
    : 'text-muted-foreground/50 hover:bg-secondary/30 hover:text-muted-foreground'

  return (
    <button onClick={onClick} className={`${baseClass} ${variantClass}`} title={title}>
      {children}
    </button>
  )
}

export function PlanCard({ content, onOpenInCanvas, workDir }: PlanCardProps) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Copy plan content to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy plan:', err)
    }
  }, [content])

  // Save plan as markdown file
  const handleSave = useCallback(async () => {
    try {
      const timestamp = new Date().toISOString().slice(0, 10)
      const filename = `plan-${timestamp}-${Date.now()}.md`
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (err) {
      console.error('Failed to save plan:', err)
    }
  }, [content])

  const handleOpenInCanvas = useCallback(() => {
    if (onOpenInCanvas) {
      onOpenInCanvas(content)
    }
  }, [content, onOpenInCanvas])

  return (
    <div className="rounded-2xl border border-kite-warning/15 bg-kite-warning/[0.03] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer
          bg-kite-warning/[0.05] border-b border-kite-warning/10
          hover:bg-kite-warning/[0.08] transition-colors duration-200"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-kite-warning/15 flex items-center justify-center">
            <ClipboardList size={13} className="text-kite-warning" />
          </div>
          <span className="text-[13px] font-medium text-foreground/80">
            {t('Plan')}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-muted-foreground/40 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
        />
      </div>

      {/* Content */}
      {!isCollapsed && (
        <>
          <div className="px-4 py-3.5">
            <div className="break-words leading-relaxed plan-content">
              <MarkdownRenderer content={content} workDir={workDir} />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-t border-kite-warning/10">
            {onOpenInCanvas && (
              <PlanActionButton onClick={handleOpenInCanvas} title={t('Open in Canvas')} variant="primary">
                <ExternalLink size={12} />
                <span>{t('Open in Canvas')}</span>
              </PlanActionButton>
            )}
            <PlanActionButton onClick={handleCopy} title={t('Copy plan to clipboard')}>
              {copySuccess ? <Check size={12} className="text-kite-success" /> : <Copy size={12} />}
              <span>{copySuccess ? t('Copied') : t('Copy')}</span>
            </PlanActionButton>
            <PlanActionButton onClick={handleSave} title={t('Save plan as file')}>
              {saveSuccess ? <Check size={12} className="text-kite-success" /> : <Save size={12} />}
              <span>{saveSuccess ? t('Saved') : t('Save')}</span>
            </PlanActionButton>
          </div>
        </>
      )}
    </div>
  )
}
