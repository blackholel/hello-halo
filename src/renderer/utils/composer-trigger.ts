export type ComposerTriggerType = 'slash' | 'mention'

export interface TriggerContext {
  type: ComposerTriggerType
  start: number
  end: number
  query: string
}

const TOKEN_CHAR_RE = /[A-Za-z0-9._:-]/

function isSlashBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_/:.@-]/.test(prev)
}

function isMentionBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_.+-]/.test(prev)
}

function isTokenChar(ch: string | undefined): boolean {
  if (!ch) return false
  return TOKEN_CHAR_RE.test(ch)
}

export function getTriggerContext(value: string, caret: number): TriggerContext | null {
  const clampedCaret = Math.max(0, Math.min(caret, value.length))

  let left = clampedCaret
  while (left > 0 && isTokenChar(value[left - 1])) {
    left -= 1
  }

  const triggerIndex = left - 1
  if (triggerIndex < 0) return null

  const triggerChar = value[triggerIndex]
  if (triggerChar !== '/' && triggerChar !== '@') return null
  if (triggerIndex > 0 && value[triggerIndex - 1] === '\\') return null

  const prev = triggerIndex > 0 ? value[triggerIndex - 1] : undefined
  if (triggerChar === '/' && !isSlashBoundary(prev)) return null
  if (triggerChar === '@' && !isMentionBoundary(prev)) return null

  let right = clampedCaret
  while (right < value.length && isTokenChar(value[right])) {
    right += 1
  }

  const query = value.slice(left, right)

  return {
    type: triggerChar === '/' ? 'slash' : 'mention',
    start: triggerIndex,
    end: right,
    query
  }
}

export function replaceTriggerToken(
  value: string,
  context: TriggerContext,
  replacement: string
): { value: string; caret: number } {
  const before = value.slice(0, context.start)
  const after = value.slice(context.end)

  const needsSpace = after.length === 0 || !/^\s|^[,.;:!?，。；：！？、)\]}]/.test(after)
  const suffix = needsSpace ? ' ' : ''

  const nextValue = `${before}${replacement}${suffix}${after}`
  const nextCaret = `${before}${replacement}${suffix}`.length

  return {
    value: nextValue,
    caret: nextCaret
  }
}
