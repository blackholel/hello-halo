/**
 * SkillCard - Independent card for Skill tool display
 * Renders as a separate card at the same level as ThoughtProcess
 * Shows skill name, args, status, and result
 */

import { useState, useMemo, memo } from 'react'
import {
  Zap,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSkillsStore } from '../../stores/skills.store'
import { toResourceKey } from '../../utils/resource-key'
import {
  truncateText,
  stripErrorTags,
  getSkillStatusColor,
  getSkillLeftBorderColor,
  getSkillSummaryText
} from '../../utils/thought-utils'

interface SkillCardProps {
  skillId: string
  skillName: string
  skillArgs?: string
  isRunning: boolean
  hasError: boolean
  result?: string
}

export const SkillCard = memo(function SkillCard({
  skillId,
  skillName,
  skillArgs,
  isRunning,
  hasError,
  result
}: SkillCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { t } = useTranslation()
  const skills = useSkillsStore((state) => state.skills)

  const localizedSkillName = useMemo(() => {
    const direct = skills.find((skill) => toResourceKey(skill) === skillName || skill.name === skillName)
    if (!direct) return skillName
    const base = direct.displayName || direct.name
    return direct.namespace ? `${direct.namespace}:${base}` : base
  }, [skillName, skills])

  // Use extracted pure functions for status colors
  const statusColor = getSkillStatusColor(isRunning, hasError)
  const leftBorderColor = getSkillLeftBorderColor(isRunning, hasError)

  // Format skill display: /skill-name args
  const skillDisplay = skillArgs
    ? `/${localizedSkillName} ${truncateText(skillArgs, 40)}`
    : `/${localizedSkillName}`

  // Memoize summary text to avoid recalculation on every render
  const summaryText = useMemo(
    () => getSkillSummaryText(isRunning, hasError, result, t),
    [isRunning, hasError, result, t]
  )

  return (
    <div className={`
      animate-fade-in mb-3 rounded-2xl border overflow-hidden transition-all duration-300
      ${statusColor}
    `}>
      {/* Left color indicator + content */}
      <div className="flex">
        {/* Left color bar */}
        <div className={`w-0.5 ${leftBorderColor} flex-shrink-0`} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/15 transition-colors duration-200"
          >
            {/* Expand icon */}
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            )}

            {/* Zap icon for skill */}
            <Zap
              size={16}
              className={`flex-shrink-0 ${isRunning ? 'text-blue-500 animate-pulse' : 'text-muted-foreground'}`}
            />

            {/* Skill name and args */}
            <span className="text-sm font-medium font-mono truncate flex-1">
              {skillDisplay}
            </span>

            {/* Status indicator */}
            {isRunning && (
              <Loader2 size={14} className="animate-spin text-blue-500 flex-shrink-0" />
            )}
            {!isRunning && !hasError && (
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            )}
            {hasError && (
              <XCircle size={14} className="text-destructive flex-shrink-0" />
            )}
          </button>

          {/* Collapsed summary - single line text */}
          {!isExpanded && (
            <div className="px-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
              {isRunning ? (
                <>
                  <Loader2 size={12} className="animate-spin flex-shrink-0" />
                  <span>{summaryText}</span>
                </>
              ) : hasError ? (
                <>
                  <XCircle size={12} className="text-destructive flex-shrink-0" />
                  <span className="text-destructive truncate">{summaryText}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                  <span className="truncate">{summaryText}</span>
                </>
              )}
            </div>
          )}

       {/* Expanded content */}
          {isExpanded && (
            <div className="px-3.5 pb-3 border-t border-border/10">
              {result ? (
                <div className="mt-2.5 text-[11px] text-muted-foreground/70 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
                  {stripErrorTags(result)}
                </div>
              ) : isRunning ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <Loader2 size={12} className="animate-spin" />
                  {t('Executing skill...')}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground/50">
                  {t('No output')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
