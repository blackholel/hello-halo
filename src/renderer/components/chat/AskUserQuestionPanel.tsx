import { useMemo, useState } from 'react'
import {
  Loader2,
  MessageSquare,
  Send,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  SkipForward
} from 'lucide-react'
import type { AskUserQuestionAnswerPayload, ToolCall } from '../../types'
import { useTranslation } from '../../i18n'

interface AskUserQuestionPanelProps {
  toolCall: ToolCall
  onSubmit: (answer: AskUserQuestionAnswerPayload | string) => Promise<void> | void
  isCompact?: boolean
  failureReason?: string
  submitLabel?: string
  submitAsText?: boolean
}

interface QuestionOption {
  label: string
  description: string
}

interface NormalizedQuestion {
  id: string
  header: string
  question: string
  options: QuestionOption[]
  multiSelect?: boolean
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractQuestions(input: Record<string, unknown>): NormalizedQuestion[] {
  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return [
      {
        id: 'q_1',
        header: 'Question',
        question: toNonEmptyString(input.question) || 'Please provide your choice.',
        options: [
          { label: 'Continue', description: 'Proceed with this option' },
          { label: 'Cancel', description: 'Stop and reconsider' }
        ],
        multiSelect: false
      }
    ]
  }

  return rawQuestions
    .map((rawQuestion, questionIndex): NormalizedQuestion | null => {
      if (!rawQuestion || typeof rawQuestion !== 'object') return null
      const record = rawQuestion as Record<string, unknown>

      const questionText =
        toNonEmptyString(record.question) ||
        toNonEmptyString(record.prompt) ||
        toNonEmptyString(record.message) ||
        toNonEmptyString(record.text) ||
        `Question ${questionIndex + 1}`

      const header = toNonEmptyString(record.header) || `Question ${questionIndex + 1}`
      const id = toNonEmptyString(record.id) || `q_${questionIndex + 1}`

      const rawOptions = record.options || record.choices || record.selectOptions
      const options: QuestionOption[] = Array.isArray(rawOptions)
        ? rawOptions
            .map((rawOption): QuestionOption | null => {
              if (typeof rawOption === 'string') {
                const label = rawOption.trim()
                if (!label) return null
                return { label, description: `Select ${label}` }
              }
              if (!rawOption || typeof rawOption !== 'object') return null
              const optRecord = rawOption as Record<string, unknown>
              const label =
                toNonEmptyString(optRecord.label) ||
                toNonEmptyString(optRecord.text) ||
                toNonEmptyString(optRecord.title) ||
                toNonEmptyString(optRecord.value)
              if (!label) return null
              const description =
                toNonEmptyString(optRecord.description) ||
                toNonEmptyString(optRecord.desc) ||
                `Select ${label}`
              return { label, description }
            })
            .filter((opt): opt is QuestionOption => opt !== null)
        : []

      if (options.length === 0) {
        options.push(
          { label: 'Yes', description: 'Select Yes' },
          { label: 'No', description: 'Select No' }
        )
      }

      const multiSelect = record.multiSelect === true || record.multi_select === true

      return { id, header, question: questionText, options, multiSelect }
    })
    .filter((q): q is NormalizedQuestion => q !== null)
}

export function AskUserQuestionPanel({
  toolCall,
  onSubmit,
  isCompact = false,
  failureReason,
  submitLabel,
  submitAsText = false
}: AskUserQuestionPanelProps) {
  const { t } = useTranslation()
  const input = toolCall.input as Record<string, unknown>
  const questions = useMemo(() => extractQuestions(input), [input])

  // State for multi-question navigation
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOptions, setSelectedOptions] = useState<Map<string, Set<string>>>(new Map())
  const [skippedQuestionIds, setSkippedQuestionIds] = useState<Set<string>>(new Set())
  const [expandedOther, setExpandedOther] = useState<string | null>(null)
  const [otherInputs, setOtherInputs] = useState<Map<string, string>>(new Map())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentQuestion = questions[currentIndex]
  const isMultiSelect = currentQuestion?.multiSelect === true
  const hasMultipleQuestions = questions.length > 1
  const isLastQuestion = currentIndex === questions.length - 1

  const shortFailureReason = useMemo(() => {
    if (!failureReason) return null
    return failureReason.length > 180 ? `${failureReason.slice(0, 180)}...` : failureReason
  }, [failureReason])

  // Get selected options for current question
  const currentSelected = selectedOptions.get(currentQuestion?.id) || new Set()
  const isOtherExpanded = expandedOther === currentQuestion?.id
  const otherInputValue = otherInputs.get(currentQuestion?.id) || ''

  const clearSkippedForQuestion = (questionId: string) => {
    setSkippedQuestionIds((prev) => {
      if (!prev.has(questionId)) return prev
      const next = new Set(prev)
      next.delete(questionId)
      return next
    })
  }

  const normalizeAnswersForQuestion = (questionId: string): string[] => {
    const selected = selectedOptions.get(questionId)
    if (!selected || selected.size === 0) {
      return []
    }

    const otherInput = (otherInputs.get(questionId) || '').trim()
    const normalized: string[] = []
    for (const value of Array.from(selected)) {
      if (value === 'Other') {
        if (otherInput) {
          normalized.push(otherInput)
        }
        continue
      }
      const trimmedValue = value.trim()
      if (trimmedValue) {
        normalized.push(trimmedValue)
      }
    }
    return Array.from(new Set(normalized))
  }

  const hasCurrentAnswer = currentQuestion
    ? normalizeAnswersForQuestion(currentQuestion.id).length > 0
    : false

  // Handle option click
  const handleOptionClick = (optionLabel: string) => {
    clearSkippedForQuestion(currentQuestion.id)
    if (isMultiSelect) {
      // Toggle for multi-select
      setSelectedOptions((prev) => {
        const newMap = new Map(prev)
        const current = new Set(newMap.get(currentQuestion.id) || [])
        if (current.has(optionLabel)) {
          current.delete(optionLabel)
        } else {
          current.add(optionLabel)
        }
        newMap.set(currentQuestion.id, current)
        return newMap
      })
    } else {
      // Single select - immediately select
      setSelectedOptions((prev) => {
        const newMap = new Map(prev)
        newMap.set(currentQuestion.id, new Set([optionLabel]))
        return newMap
      })
    }
    // Close "Other" input if selecting a regular option
    if (isOtherExpanded && optionLabel !== 'Other') {
      setExpandedOther(null)
    }
  }

  // Handle "Other" option click
  const handleOtherClick = () => {
    if (isOtherExpanded) {
      // Collapse and clear input
      setExpandedOther(null)
      setOtherInputs((prev) => {
        const newMap = new Map(prev)
        newMap.delete(currentQuestion.id)
        return newMap
      })
    } else {
      setExpandedOther(currentQuestion.id)
      clearSkippedForQuestion(currentQuestion.id)
      // Add "Other" to selected if multi-select
      if (isMultiSelect) {
        setSelectedOptions((prev) => {
          const newMap = new Map(prev)
          const current = new Set(newMap.get(currentQuestion.id) || [])
          current.add('Other')
          newMap.set(currentQuestion.id, current)
          return newMap
        })
      } else {
        setSelectedOptions((prev) => {
          const newMap = new Map(prev)
          newMap.set(currentQuestion.id, new Set(['Other']))
          return newMap
        })
      }
    }
  }

  // Handle other input change
  const handleOtherInputChange = (value: string) => {
    clearSkippedForQuestion(currentQuestion.id)
    setOtherInputs((prev) => {
      const newMap = new Map(prev)
      newMap.set(currentQuestion.id, value)
      return newMap
    })
  }

  // Navigate to previous question
  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setExpandedOther(null)
    }
  }

  // Navigate to next question
  const goToNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setExpandedOther(null)
    }
  }

  const buildSubmissionPayload = (): AskUserQuestionAnswerPayload => {
    const answersByQuestionId: Record<string, string[]> = {}
    const skipped = new Set(skippedQuestionIds)

    for (const question of questions) {
      const answers = normalizeAnswersForQuestion(question.id)
      if (answers.length > 0) {
        answersByQuestionId[question.id] = answers
        skipped.delete(question.id)
      } else {
        skipped.add(question.id)
      }
    }

    return {
      toolCallId: toolCall.id,
      answersByQuestionId,
      skippedQuestionIds: Array.from(skipped)
    }
  }

  const buildManualAnswerText = (payload: AskUserQuestionAnswerPayload): string => {
    const lines: string[] = []
    for (const question of questions) {
      const answers = payload.answersByQuestionId[question.id]
      if (answers && answers.length > 0) {
        lines.push(`${question.question}: ${answers.join(', ')}`)
      } else if (payload.skippedQuestionIds.includes(question.id)) {
        lines.push(`${question.question}: [Skipped]`)
      }
    }
    return lines.join('\n')
  }

  // Submit all answers
  const submit = async (extraSkippedQuestionIds: string[] = []) => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const payload = buildSubmissionPayload()
      if (extraSkippedQuestionIds.length > 0) {
        const mergedSkipped = new Set([
          ...payload.skippedQuestionIds,
          ...extraSkippedQuestionIds
        ])
        for (const skippedQuestionId of extraSkippedQuestionIds) {
          delete payload.answersByQuestionId[skippedQuestionId]
        }
        payload.skippedQuestionIds = Array.from(mergedSkipped)
      }
      if (submitAsText) {
        const manualAnswer = buildManualAnswerText(payload).trim() || 'Skipped all questions.'
        await onSubmit(manualAnswer)
      } else {
        await onSubmit(payload)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit answer'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Skip current question or all
  const handleSkip = async () => {
    setSkippedQuestionIds((prev) => {
      const next = new Set(prev)
      next.add(currentQuestion.id)
      return next
    })
    setSelectedOptions((prev) => {
      const next = new Map(prev)
      next.delete(currentQuestion.id)
      return next
    })
    setOtherInputs((prev) => {
      const next = new Map(prev)
      next.delete(currentQuestion.id)
      return next
    })
    if (expandedOther === currentQuestion.id) {
      setExpandedOther(null)
    }

    if (hasMultipleQuestions && !isLastQuestion) {
      goToNext()
    } else {
      await submit([currentQuestion.id])
    }
  }

  // Continue to next or submit
  const handleContinue = async () => {
    if (hasMultipleQuestions && !isLastQuestion) {
      goToNext()
    } else {
      await submit()
    }
  }

  // Check if can continue
  const canContinue = hasCurrentAnswer

  // Submit other input
  const submitOtherInput = async () => {
    if (!otherInputValue.trim()) return
    await handleContinue()
  }

  return (
    <div
      className={`
      mx-4 mb-2 animate-slide-up
      transition-[padding] duration-300 ease-out
      ${isCompact ? '' : ''}
    `}
    >
      <div className={isCompact ? '' : ''}>
        <div className="rounded-2xl border border-border/25 bg-secondary/10 overflow-hidden">
          {/* Header with pagination */}
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/20 border-b border-border/20">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-primary" />
              <span className="text-xs font-medium text-primary/80">
                {t('Agent asks a question')}
              </span>
            </div>

            {/* Question pagination */}
            {hasMultipleQuestions && (
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevious}
                  disabled={currentIndex === 0}
                  className="p-1 rounded hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-muted-foreground px-1.5">
                  {currentIndex + 1} / {questions.length}
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="p-3">
            {/* Failure reason */}
            {shortFailureReason && (
              <p className="mb-2 text-xs text-amber-500/90 whitespace-pre-wrap break-words">
                {t('Tool call failed, switched to manual reply mode')}: {shortFailureReason}
              </p>
            )}

            {/* Question header */}
            {currentQuestion && (
              <>
                <div className="text-xs font-medium text-muted-foreground mb-0.5">
                  {currentQuestion.header}
                </div>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words mb-3">
                  {currentQuestion.question}
                </p>

                {/* Options */}
                <div className="space-y-1.5">
                  {currentQuestion.options.map((option) => {
                    const isSelected = currentSelected.has(option.label)
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => handleOptionClick(option.label)}
                        disabled={isSubmitting}
                        className={`
                          w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left
                          transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed
                          ${
                            isSelected
                              ? 'border-primary/50 bg-primary/10 text-foreground'
                              : 'border-border/40 bg-background/50 hover:bg-secondary/30 text-foreground/80'
                          }
                        `}
                      >
                        {/* Selection indicator */}
                        <div
                          className={`
                          mt-0.5 flex-shrink-0 w-4 h-4 rounded
                          flex items-center justify-center
                          ${
                            isMultiSelect
                              ? 'border border-border/60'
                              : 'rounded-full border border-border/60'
                          }
                          ${isSelected ? 'bg-primary border-primary' : ''}
                        `}
                        >
                          {isSelected && <Check size={12} className="text-primary-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{option.label}</div>
                          {option.description && option.description !== `Select ${option.label}` && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {option.description}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}

                  {/* "Other..." option */}
                  <button
                    type="button"
                    onClick={handleOtherClick}
                    disabled={isSubmitting}
                    className={`
                      w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left
                      transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed
                      ${
                        isOtherExpanded
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border/40 bg-background/50 hover:bg-secondary/30 text-foreground/80'
                      }
                    `}
                  >
                    <div
                      className={`
                      mt-0.5 flex-shrink-0 w-4 h-4 rounded
                      flex items-center justify-center border border-border/60
                      ${isOtherExpanded ? 'bg-primary border-primary' : ''}
                    `}
                    >
                      {isOtherExpanded && <Check size={12} className="text-primary-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{t('Other...')}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t('Provide a custom answer')}
                      </div>
                    </div>
                  </button>

                  {/* Expanded input for "Other" */}
                  {isOtherExpanded && (
                    <div className="ml-6 mt-2 animate-fade-in">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          submitOtherInput()
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          value={otherInputValue}
                          onChange={(e) => handleOtherInputChange(e.target.value)}
                          placeholder={t('Enter your answer...')}
                          disabled={isSubmitting}
                          autoFocus
                          className="flex-1 h-9 px-3 rounded-lg border border-border/60 bg-background
                            text-sm focus:outline-none focus:ring-1 focus:ring-primary/40
                            disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <button
                          type="submit"
                          disabled={!otherInputValue.trim() || isSubmitting}
                          className="h-9 px-3 rounded-lg bg-primary text-primary-foreground
                            hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                            inline-flex items-center gap-1.5 text-xs font-medium"
                        >
                          {isSubmitting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Send size={14} />
                          )}
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20">
                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                      text-muted-foreground hover:text-foreground
                      hover:bg-secondary/30 rounded-lg transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <SkipForward size={14} />
                    {hasMultipleQuestions && !isLastQuestion ? t('Skip') : t('Skip all')}
                  </button>

                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!canContinue || isSubmitting}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg
                      bg-primary text-primary-foreground hover:bg-primary/90
                      disabled:opacity-50 disabled:cursor-not-allowed
                      text-xs font-medium transition-colors"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t('Submitting...')}
                      </>
                    ) : (
                      <>
                        {hasMultipleQuestions && !isLastQuestion ? (
                          <>
                            {t('Continue')}
                            <ChevronRight size={14} />
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            {submitLabel || t('Submit')}
                          </>
                        )}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Error message */}
            {error && (
              <p className="mt-2 text-xs text-destructive/90 flex items-center gap-1">
                <X size={12} />
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
