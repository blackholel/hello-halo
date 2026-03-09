/**
 * Renderer Communication
 *
 * Unified communication with renderer process and WebSocket clients.
 * Manages the mainWindow reference for IPC communication.
 */

import { BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { resolve, sep } from 'path'
import { broadcastToWebSocket } from '../../http/websocket'
import { getConfig } from '../config.service'
import { isAIBrowserTool } from '../ai-browser'
import { extractToolPath } from './resource-dir-guard.service'
import { buildSessionKey } from '../../../shared/session-key'
import { ASK_USER_QUESTION_ERROR_CODES } from './types'
import { getSpaceResourcePolicy, isStrictSpaceOnlyPolicy } from './space-resource-policy.service'
import type {
  ToolCall,
  SessionState,
  AskUserQuestionAnswerInput,
  AskUserQuestionMode,
  CanUseToolDecision,
  ChatMode
} from './types'

// Current main window reference for IPC communication
let currentMainWindow: BrowserWindow | null = null

function normalizePathForCompare(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isPathWithinWorkDir(candidatePath: string, absoluteWorkDir: string): boolean {
  const normalizedWorkDir = normalizePathForCompare(absoluteWorkDir)
  const normalizedCandidate = normalizePathForCompare(candidatePath)
  const normalizedPrefix = `${normalizedWorkDir}${sep}`
  return normalizedCandidate === normalizedWorkDir || normalizedCandidate.startsWith(normalizedPrefix)
}

function extractQuotedOrBareToken(command: string, start: number): string {
  const remain = command.slice(start).trimStart()
  if (!remain) return ''
  if (remain.startsWith('"') || remain.startsWith('\'')) {
    const quote = remain[0]
    const end = remain.indexOf(quote, 1)
    return end > 1 ? remain.slice(1, end) : remain.slice(1)
  }
  return remain.split(/\s+/)[0] || ''
}

function getBashCommandPathCandidates(command: string): string[] {
  const candidates = new Set<string>()
  const absolutePathRegex = /(^|[\s;|&])((?:\/|~\/)[^\s;|&]+)/g
  let absoluteMatch: RegExpExecArray | null
  while ((absoluteMatch = absolutePathRegex.exec(command)) !== null) {
    const token = absoluteMatch[2]?.trim()
    if (token) candidates.add(token)
  }

  const cdRegex = /\bcd\s+/g
  let cdMatch: RegExpExecArray | null
  while ((cdMatch = cdRegex.exec(command)) !== null) {
    const token = extractQuotedOrBareToken(command, cdMatch.index + cdMatch[0].length)
    if (token) candidates.add(token)
  }

  const openRegex = /\bopen\s+/g
  let openMatch: RegExpExecArray | null
  while ((openMatch = openRegex.exec(command)) !== null) {
    const token = extractQuotedOrBareToken(command, openMatch.index + openMatch[0].length)
    if (token) candidates.add(token)
  }

  return Array.from(candidates)
}

function resolveShellPathToken(token: string, absoluteWorkDir: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return resolve(process.env.HOME || '', trimmed.slice(2))
  }
  return resolve(absoluteWorkDir, trimmed)
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildQuestionId(seed: string, index: number): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)

  return normalized ? `q_${normalized}` : `q_${index + 1}`
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = toNonEmptyString(value)
    if (normalized) {
      unique.add(normalized)
    }
  }
  return Array.from(unique)
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true) return true
  if (value === false) return false
  return undefined
}

function resolveQuestionMultiSelect(
  questionRecord: Record<string, unknown>,
  inherited: boolean | undefined,
  inferred: boolean
): boolean {
  const questionLevelCamel = toOptionalBoolean(questionRecord.multiSelect)
  if (questionLevelCamel !== undefined) return questionLevelCamel

  const questionLevelSnake = toOptionalBoolean(questionRecord.multi_select)
  if (questionLevelSnake !== undefined) return questionLevelSnake

  if (inherited !== undefined) return inherited
  return inferred
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function getAskUserQuestionInputFingerprint(
  input: Record<string, unknown>
): string {
  const encoded = stableStringify(input)
  const digest = createHash('sha1').update(encoded).digest('hex')
  return `aqf_${digest}`
}

function getAskUserQuestionFingerprintKey(runId: string, fingerprint: string): string {
  return `${runId}:${fingerprint}`
}

const PLAN_MODE_ALLOWED_TOOLS = new Set<string>([
  'AskUserQuestion',
  'Task',
  'Read',
  'Grep',
  'Glob'
])

const PLAN_MODE_TASK_PROMPT_GUARD = [
  'PLAN MODE sub-agent policy:',
  '- This task is read-only exploration.',
  '- Allowed actions: inspect files, search code, summarize findings.',
  '- Forbidden actions: modifying files, running commands, executing implementation steps.',
  '- Output format: Findings, File references, Open questions.'
].join('\n')

function buildPlanModeTaskInput(input: Record<string, unknown>): Record<string, unknown> {
  const originalPrompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const guardedPrompt = originalPrompt.length > 0
    ? `${PLAN_MODE_TASK_PROMPT_GUARD}\n\n${originalPrompt}`
    : `${PLAN_MODE_TASK_PROMPT_GUARD}\n\nExplore relevant code paths and report actionable findings.`

  return {
    ...input,
    prompt: guardedPrompt,
    subagent_type: typeof input.subagent_type === 'string' && input.subagent_type.trim().length > 0
      ? input.subagent_type
      : 'explorer'
  }
}

interface AskUserQuestionNormalizedQuestion {
  id: string
  question: string
}

interface AskUserQuestionOption {
  label: string
  description: string
}

interface AskUserQuestionNormalizationDiagnostics {
  adjusted: boolean
  originalQuestionCount: number
  normalizedQuestionCount: number
  trimmedQuestionCount: number
  trimmedOptionCount: number
  removedOtherOptionCount: number
  dedupedOptionCount: number
  paddedOptionCount: number
}

interface AskUserQuestionNormalizationResult {
  normalizedInput: Record<string, unknown>
  diagnostics: AskUserQuestionNormalizationDiagnostics
}

const ASK_USER_QUESTION_MAX_QUESTIONS = 3
const ASK_USER_QUESTION_MAX_OPTIONS = 4
const ASK_USER_QUESTION_MIN_OPTIONS = 2
const ASK_USER_QUESTION_FALLBACK_OPTIONS: AskUserQuestionOption[] = [
  { label: 'Yes', description: 'Select Yes' },
  { label: 'No', description: 'Select No' },
  { label: 'Continue', description: 'Proceed with this option' },
  { label: 'Cancel', description: 'Stop and reconsider' }
]

function normalizeOptionKey(label: string): string {
  return label.trim().toLowerCase()
}

function isOtherOptionLabel(label: string): boolean {
  const normalized = normalizeOptionKey(label).replace(/\s+/g, '')
  return normalized === 'other' || normalized === 'other...' || normalized === 'other…'
}

function applyAskUserQuestionOptionConstraints(
  options: AskUserQuestionOption[],
  diagnostics: AskUserQuestionNormalizationDiagnostics
): AskUserQuestionOption[] {
  const deduped: AskUserQuestionOption[] = []
  const seenKeys = new Set<string>()

  for (const option of options) {
    if (isOtherOptionLabel(option.label)) {
      diagnostics.removedOtherOptionCount += 1
      continue
    }

    const optionKey = normalizeOptionKey(option.label)
    if (seenKeys.has(optionKey)) {
      diagnostics.dedupedOptionCount += 1
      continue
    }

    seenKeys.add(optionKey)
    deduped.push(option)
  }

  let constrained = deduped
  if (constrained.length > ASK_USER_QUESTION_MAX_OPTIONS) {
    diagnostics.trimmedOptionCount += constrained.length - ASK_USER_QUESTION_MAX_OPTIONS
    constrained = constrained.slice(0, ASK_USER_QUESTION_MAX_OPTIONS)
  }

  if (constrained.length < ASK_USER_QUESTION_MIN_OPTIONS) {
    for (const fallbackOption of ASK_USER_QUESTION_FALLBACK_OPTIONS) {
      if (constrained.length >= ASK_USER_QUESTION_MIN_OPTIONS) {
        break
      }
      const fallbackKey = normalizeOptionKey(fallbackOption.label)
      if (seenKeys.has(fallbackKey) || isOtherOptionLabel(fallbackOption.label)) {
        continue
      }
      constrained.push(fallbackOption)
      seenKeys.add(fallbackKey)
      diagnostics.paddedOptionCount += 1
    }
  }

  return constrained
}

function getAskUserQuestionNormalizedQuestions(
  inputSnapshot: Record<string, unknown>
): AskUserQuestionNormalizedQuestion[] {
  const normalizedInput = normalizeAskUserQuestionInput(inputSnapshot)
  const rawQuestions = normalizedInput.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return []
  }

  return rawQuestions
    .map((rawQuestion, questionIndex): AskUserQuestionNormalizedQuestion | null => {
      if (!rawQuestion || typeof rawQuestion !== 'object') return null
      const record = rawQuestion as Record<string, unknown>
      const id = toNonEmptyString(record.id) || `q_${questionIndex + 1}`
      const question =
        toNonEmptyString(record.question) ||
        toNonEmptyString(record.prompt) ||
        toNonEmptyString(record.message) ||
        toNonEmptyString(record.text)
      if (!question) return null
      return { id, question }
    })
    .filter((question): question is AskUserQuestionNormalizedQuestion => question !== null)
}

export function buildAskUserQuestionUpdatedInput(
  inputSnapshot: Record<string, unknown>,
  answerInput: AskUserQuestionAnswerInput
): Record<string, unknown> {
  const normalizedInput = normalizeAskUserQuestionInput(inputSnapshot)
  const questions = getAskUserQuestionNormalizedQuestions(normalizedInput)
  if (questions.length === 0) {
    throw new Error('AskUserQuestion input has no valid questions')
  }

  const seenQuestionText = new Set<string>()
  for (const question of questions) {
    if (seenQuestionText.has(question.question)) {
      throw new Error('Duplicate AskUserQuestion question text is not allowed')
    }
    seenQuestionText.add(question.question)
  }

  if (typeof answerInput === 'string') {
    const trimmed = answerInput.trim()
    if (!trimmed) {
      throw new Error('Answer cannot be empty')
    }
    if (questions.length > 1) {
      throw new Error(
        'Legacy answer string does not support multi-question AskUserQuestion. Please upgrade client.'
      )
    }

    return {
      ...normalizedInput,
      answers: {
        [questions[0].question]: trimmed
      }
    }
  }

  const answersByQuestionId: Record<string, string[]> = {}
  if (
    answerInput.answersByQuestionId &&
    typeof answerInput.answersByQuestionId === 'object' &&
    !Array.isArray(answerInput.answersByQuestionId)
  ) {
    for (const [questionId, selectedValues] of Object.entries(answerInput.answersByQuestionId)) {
      answersByQuestionId[questionId] = normalizeStringArray(selectedValues)
    }
  }

  const skippedQuestionIds = normalizeStringArray(answerInput.skippedQuestionIds || [])
  const skippedSet = new Set(skippedQuestionIds)
  const sdkAnswers: Record<string, string> = {}

  for (const question of questions) {
    const selectedValues = answersByQuestionId[question.id] || []
    if (selectedValues.length > 0) {
      sdkAnswers[question.question] = selectedValues.join(', ')
      continue
    }

    skippedSet.add(question.id)
  }

  return {
    ...normalizedInput,
    answers: sdkAnswers,
    skippedQuestionIds: Array.from(skippedSet)
  }
}

export function normalizeAskUserQuestionInputWithDiagnostics(
  input: Record<string, unknown>
): AskUserQuestionNormalizationResult {
  const diagnostics: AskUserQuestionNormalizationDiagnostics = {
    adjusted: false,
    originalQuestionCount: Array.isArray(input.questions) ? input.questions.length : 0,
    normalizedQuestionCount: 0,
    trimmedQuestionCount: 0,
    trimmedOptionCount: 0,
    removedOtherOptionCount: 0,
    dedupedOptionCount: 0,
    paddedOptionCount: 0
  }

  const topLevelMultiSelect =
    toOptionalBoolean(input.multiSelect) ??
    toOptionalBoolean(input.multi_select)

  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    const question = toNonEmptyString(input.question) || 'Please provide your choice.'
    diagnostics.normalizedQuestionCount = 1
    return {
      normalizedInput: {
        questions: [
          {
            id: 'q_1',
            header: 'Question',
            question,
            options: [
              { label: 'Continue', description: 'Proceed with this option' },
              { label: 'Cancel', description: 'Stop and reconsider' }
            ],
            multiSelect: topLevelMultiSelect ?? false
          }
        ]
      },
      diagnostics
    }
  }

  const normalizedQuestions = rawQuestions
    .map((rawQuestion, questionIndex) => {
      if (!rawQuestion || typeof rawQuestion !== 'object') return null
      const record = rawQuestion as Record<string, unknown>

      const questionText =
        toNonEmptyString(record.question) ||
        toNonEmptyString(record.prompt) ||
        toNonEmptyString(record.message) ||
        toNonEmptyString(record.text) ||
        `Question ${questionIndex + 1}`

      const header = toNonEmptyString(record.header) || `Question ${questionIndex + 1}`
      const id =
        toNonEmptyString(record.id) ||
        buildQuestionId(toNonEmptyString(record.header) || questionText, questionIndex)

      const rawOptions = record.options || record.choices || record.selectOptions
      const parsedOptions = Array.isArray(rawOptions)
        ? rawOptions
            .map((rawOption) => {
              if (typeof rawOption === 'string') {
                const label = rawOption.trim()
                if (!label) return null
                return {
                  label,
                  description: `Select ${label}`
                }
              }

              if (!rawOption || typeof rawOption !== 'object') return null
              const optionRecord = rawOption as Record<string, unknown>
              const label =
                toNonEmptyString(optionRecord.label) ||
                toNonEmptyString(optionRecord.text) ||
                toNonEmptyString(optionRecord.title) ||
                toNonEmptyString(optionRecord.value)
              if (!label) return null
              const description =
                toNonEmptyString(optionRecord.description) ||
                toNonEmptyString(optionRecord.desc) ||
                `Select ${label}`

              return { label, description }
            })
            .filter((option): option is AskUserQuestionOption => option !== null)
        : []

      const options = applyAskUserQuestionOptionConstraints(parsedOptions, diagnostics)

      return {
        id,
        header,
        question: questionText,
        options,
        sourceRecord: record
      }
    })
    .filter((item): item is {
      id: string
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      sourceRecord: Record<string, unknown>
    } => item !== null)

  if (normalizedQuestions.length === 0) {
    diagnostics.normalizedQuestionCount = 1
    return {
      normalizedInput: {
        questions: [
          {
            id: 'q_1',
            header: 'Question',
            question: 'Please provide your choice.',
            options: [
              { label: 'Continue', description: 'Proceed with this option' },
              { label: 'Cancel', description: 'Stop and reconsider' }
            ],
            multiSelect: topLevelMultiSelect ?? false
          }
        ]
      },
      diagnostics
    }
  }

  const constrainedQuestions = normalizedQuestions.slice(0, ASK_USER_QUESTION_MAX_QUESTIONS)
  if (normalizedQuestions.length > ASK_USER_QUESTION_MAX_QUESTIONS) {
    diagnostics.trimmedQuestionCount = normalizedQuestions.length - ASK_USER_QUESTION_MAX_QUESTIONS
  }
  diagnostics.normalizedQuestionCount = constrainedQuestions.length

  const inferredMultiSelect = constrainedQuestions.length >= 2
  const questions = constrainedQuestions.map((item) => ({
    id: item.id,
    header: item.header,
    question: item.question,
    options: item.options,
    multiSelect: resolveQuestionMultiSelect(
      item.sourceRecord,
      topLevelMultiSelect,
      inferredMultiSelect
    )
  }))

  diagnostics.adjusted =
    diagnostics.trimmedQuestionCount > 0 ||
    diagnostics.trimmedOptionCount > 0 ||
    diagnostics.removedOtherOptionCount > 0 ||
    diagnostics.dedupedOptionCount > 0 ||
    diagnostics.paddedOptionCount > 0

  return {
    normalizedInput: { questions },
    diagnostics
  }
}

export function normalizeAskUserQuestionInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  return normalizeAskUserQuestionInputWithDiagnostics(input).normalizedInput
}

/**
 * Set the main window reference
 */
export function setMainWindow(window: BrowserWindow | null): void {
  currentMainWindow = window
}

/**
 * Get the current main window reference
 */
export function getMainWindow(): BrowserWindow | null {
  return currentMainWindow
}

/**
 * Send event to renderer with session identifiers
 * Also broadcasts to WebSocket for remote clients
 */
export function sendToRenderer(
  channel: string,
  spaceId: string,
  conversationId: string,
  data: Record<string, unknown>
): void {
  // Always include spaceId and conversationId in event data
  const eventData = {
    ...data,
    spaceId,
    conversationId,
    sessionKey: buildSessionKey(spaceId, conversationId)
  }

  // 1. Send to Electron renderer via IPC
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.send(channel, eventData)
    console.log(`[Agent] Sent to renderer: ${channel}`, JSON.stringify(eventData).substring(0, 200))
  }

  // 2. Broadcast to remote WebSocket clients
  try {
    broadcastToWebSocket(channel, eventData)
  } catch (error) {
    // WebSocket module might not be initialized yet, ignore
  }
}

/**
 * Create tool permission handler for a specific session
 */
export function createCanUseTool(
  workDir: string,
  spaceId: string,
  conversationId: string,
  getActiveSession: (spaceId: string, conversationId: string) => SessionState | undefined,
  options?: {
    mode?: ChatMode
    onToolUse?: (toolName: string, input: Record<string, unknown>) => void
  }
): (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<CanUseToolDecision> {
  const config = getConfig()
  const absoluteWorkDir = resolve(workDir)
  const strictSpaceOnly = isStrictSpaceOnlyPolicy(getSpaceResourcePolicy(workDir))
  console.log(`[Agent] Creating canUseTool with workDir: ${absoluteWorkDir}`)

  return async (
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal }
  ) => {
    const notifyToolUse = () => {
      if (!options?.onToolUse) return
      options.onToolUse(toolName, input)
    }
    const runtimeMode = getActiveSession(spaceId, conversationId)?.mode
    const effectiveMode = runtimeMode || options?.mode
    if (effectiveMode === 'ask') {
      return {
        behavior: 'deny' as const,
        message: 'ASK mode is text-only; tool execution is disabled'
      }
    }

    if (effectiveMode === 'plan') {
      if (!PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
        return {
          behavior: 'deny' as const,
          message: `PLAN mode only allows AskUserQuestion, Task, Read, Grep and Glob. Tool blocked: ${toolName}`
        }
      }

      if (toolName === 'Task') {
        return {
          behavior: 'allow' as const,
          updatedInput: buildPlanModeTaskInput(input)
        }
      }
    }

    console.log(
      `[Agent] canUseTool called - Tool: ${toolName}, Input:`,
      JSON.stringify(input).substring(0, 200)
    )

    if (toolName === 'AskUserQuestion') {
      // Wait for user response using session-specific resolver.
      // Tool-call UI is sent from message-flow with the real tool_use.id.
      const session = getActiveSession(spaceId, conversationId)
      if (!session) {
        return { behavior: 'deny' as const, message: 'Session not found' }
      }

      const { normalizedInput, diagnostics } = normalizeAskUserQuestionInputWithDiagnostics(input)
      if (diagnostics.adjusted) {
        console.warn(
          `[Agent][${conversationId}] AskUserQuestion input normalized: ${JSON.stringify(
            diagnostics
          )}`
        )
      }
      const fingerprint = getAskUserQuestionInputFingerprint(normalizedInput)
      const hasDuplicatePending = session.pendingAskUserQuestionOrder.some((pendingId) => {
        const context = session.pendingAskUserQuestionsById.get(pendingId)
        if (!context) return false
        if (context.runId !== session.runId) return false
        if (context.inputFingerprint !== fingerprint) return false
        return context.status === 'awaiting_bind' || context.status === 'awaiting_answer'
      })
      if (hasDuplicatePending) {
        return {
          behavior: 'deny' as const,
          message: `${ASK_USER_QUESTION_ERROR_CODES.DUPLICATE_PENDING_SIGNATURE}: Duplicate AskUserQuestion fingerprint in current run`
        }
      }

      const pendingId = `aq_${session.runId}_${++session.askUserQuestionSeq}`
      session.askUserQuestionUsedInRun = true
      const mode: AskUserQuestionMode = 'sdk_allow_updated_input'
      return new Promise((resolveDecision) => {
        const context = {
          pendingId,
          resolve: resolveDecision,
          inputSnapshot: normalizedInput,
          inputFingerprint: fingerprint,
          sessionId: conversationId,
          expectedToolCallId: null,
          runId: session.runId,
          createdAt: Date.now(),
          status: 'awaiting_bind' as const,
          mode
        }
        const fingerprintKey = getAskUserQuestionFingerprintKey(session.runId, fingerprint)
        const queuedToolCalls = session.unmatchedAskUserQuestionToolCalls.get(fingerprintKey) || []
        if (queuedToolCalls.length > 0) {
          const [toolCallId, ...remaining] = queuedToolCalls
          context.expectedToolCallId = toolCallId
          context.status = 'awaiting_answer'
          session.pendingAskUserQuestionIdByToolCallId.set(toolCallId, pendingId)
          session.askUserQuestionModeByToolCallId.set(toolCallId, mode)
          if (remaining.length > 0) {
            session.unmatchedAskUserQuestionToolCalls.set(fingerprintKey, remaining)
          } else {
            session.unmatchedAskUserQuestionToolCalls.delete(fingerprintKey)
          }
        }
        session.pendingAskUserQuestionsById.set(pendingId, context)
        session.pendingAskUserQuestionOrder.push(pendingId)
      })
    }

    const fileTools = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob'])
    if (fileTools.has(toolName)) {
      const pathParam = extractToolPath(input)
      if (pathParam) {
        const absolutePath = resolve(absoluteWorkDir, pathParam)
        if (!isPathWithinWorkDir(absolutePath, absoluteWorkDir)) {
          console.log(`[Agent] Security: Blocked access to: ${pathParam}`)
          return {
            behavior: 'deny' as const,
            message: `Can only access files within the current space: ${workDir}`
          }
        }
      }
    }

    // Check Bash commands based on permission settings
    if (toolName === 'Bash') {
      const permission = config.permissions.commandExecution

      if (permission === 'deny') {
        return {
          behavior: 'deny' as const,
          message: 'Command execution is disabled'
        }
      }

      if (permission === 'ask' && !config.permissions.trustMode) {
        const session = getActiveSession(spaceId, conversationId)
        if (!session) {
          return { behavior: 'deny' as const, message: 'Session not found' }
        }

        // Send permission request to renderer with session IDs
        const toolCallId = `tool-${session.runId}-${Date.now()}`
        const toolCall: ToolCall = {
          id: toolCallId,
          name: toolName,
          status: 'waiting_approval',
          input,
          requiresApproval: true,
          description: `Execute command: ${input.command}`
        }

        sendToRenderer(
          'agent:tool-call',
          spaceId,
          conversationId,
          {
            runId: session.runId,
            toolCallId,
            ...(toolCall as unknown as Record<string, unknown>)
          }
        )

        return new Promise((resolve) => {
          session.pendingPermissionResolve = (approved: boolean) => {
            if (approved) {
              notifyToolUse()
              resolve({ behavior: 'allow' as const })
            } else {
              resolve({
                behavior: 'deny' as const,
                message: 'User rejected command execution'
              })
            }
          }
        })
      }

      if (strictSpaceOnly) {
        const command = typeof input.command === 'string' ? input.command : ''
        if (!command.trim()) {
          return {
            behavior: 'deny' as const,
            message: 'Command is required in strict space mode'
          }
        }

        if (/(^|[\s;|&])cd\s+\.\.(?=\/|\\|\s|$)/.test(command)) {
          return {
            behavior: 'deny' as const,
            message: `Strict space mode: directory traversal is blocked outside ${workDir}`
          }
        }

        const pathCandidates = getBashCommandPathCandidates(command)
        for (const token of pathCandidates) {
          if (token === '.' || token === './') continue
          const resolvedTokenPath = resolveShellPathToken(token, absoluteWorkDir)
          if (!resolvedTokenPath) continue
          if (!isPathWithinWorkDir(resolvedTokenPath, absoluteWorkDir)) {
            console.warn('[Agent] Security: Blocked Bash command path outside workDir', {
              spaceId,
              conversationId,
              token,
              resolvedTokenPath,
              workDir: absoluteWorkDir
            })
            return {
              behavior: 'deny' as const,
              message: `Strict space mode: Bash cannot access paths outside current space (${workDir})`
            }
          }
        }
      }
    }

    // AI Browser tools are always allowed (they run in sandboxed browser context)
    if (isAIBrowserTool(toolName)) {
      console.log(`[Agent] AI Browser tool allowed: ${toolName}`)
      return { behavior: 'allow' as const }
    }

    // Default: allow
    notifyToolUse()
    return { behavior: 'allow' as const }
  }
}
