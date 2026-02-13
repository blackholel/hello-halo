/**
 * SpaceGuide - Elegant collapsible guide
 *
 * Apple-inspired design:
 * - Minimal collapsed state with subtle visual cue
 * - Smooth spring-based expand/collapse animation
 * - Clean typography with generous spacing
 * - Glass card aesthetic when expanded
 */

import { useState, useEffect, useRef } from 'react'
import {
  ChevronRight,
  Zap,
  Folder,
  Lightbulb,
  ShieldAlert
} from 'lucide-react'
import { useTranslation } from '../../i18n'

const GUIDE_STATE_KEY = 'kite-space-guide-expanded'

export function SpaceGuide() {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(GUIDE_STATE_KEY)
      return saved === 'true'
    }
    return false
  })

  useEffect(() => {
    localStorage.setItem(GUIDE_STATE_KEY, String(isExpanded))
  }, [isExpanded])

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [isExpanded])

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const sections = [
    {
      icon: Zap,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
      title: t('What can AI do?'),
      lines: [
        t('Kite is not just chat, it can help you do things'),
        t('Use natural language to have it write documents, create spreadsheets, search the web, write code...'),
      ]
    },
    {
      icon: Folder,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10',
      title: t('What is a space?'),
      lines: [
        t('AI-generated files (we call them "artifacts") need a place to be stored'),
        t('A space is their home, an independent folder'),
      ]
    },
    {
      icon: Lightbulb,
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
      title: t('When do you need to create one?'),
      hints: [
        { label: t('Casual chat, asking questions'), value: t('Use Kite space') },
        { label: t('Projects, long-term tasks'), value: t('Recommend creating a dedicated space') },
      ]
    }
  ]

  return (
    <div className="mb-5">
      {/* Toggle button */}
      <button
        onClick={toggleExpand}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl hover:bg-secondary/50 transition-all duration-200 group"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
        />
        <span className="text-[13px] text-muted-foreground group-hover:text-foreground/80 transition-colors">
          {t('Learn what spaces are')}
        </span>
      </button>

      {/* Expandable content with smooth height animation */}
      <div
        className="overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          maxHeight: isExpanded ? `${contentHeight + 20}px` : '0px',
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div ref={contentRef} className="pt-2 pb-1">
          <div className="space-card p-5 !cursor-default">
            <div className="space-y-5">
              {sections.map((section, i) => {
                const Icon = section.icon
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-xl ${section.iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${section.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h4 className="text-sm font-medium mb-1.5">{section.title}</h4>
                      {section.lines && (
                        <div className="text-[13px] text-muted-foreground leading-relaxed space-y-0.5">
                          {section.lines.map((line, j) => (
                            <p key={j}>{line}</p>
                          ))}
                        </div>
                      )}
                      {section.hints && (
                        <div className="text-[13px] text-muted-foreground space-y-1">
                          {section.hints.map((hint, j) => (
                            <p key={j}>
                              <span className="text-foreground/70">{hint.label}</span>
                              <span className="mx-1.5 text-muted-foreground/40">&rarr;</span>
                              <span>{hint.value}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Warning */}
            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-3.5 h-3.5 text-kite-warning flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="text-kite-warning font-medium">{t('AI has delete permissions')}</span>
                  {t(', be mindful of backing up important files')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
