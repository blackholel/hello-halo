/**
 * Change tracking helpers for file mutations triggered by tool calls.
 *
 * The parser for Bash is intentionally conservative:
 * - only tracks high-confidence file path patterns
 * - de-duplicates results
 * - limits tracked files per command
 */

const BASH_TRACKING_MAX_PATHS = 20
const READ_ONLY_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob'])

type ToolInputLike = {
  file_path?: unknown
  command?: unknown
}

const CONTROL_OPERATORS = new Set(['|', '||', '&&', ';'])
const FILE_REDIRECTION_OPERATORS = new Set(['>', '>>'])

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCandidatePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed === '-' || trimmed === '--') return null
  if (trimmed === '>' || trimmed === '>>' || trimmed === '<' || trimmed === '<<') return null
  if (trimmed === '/dev/null') return null
  if (trimmed.startsWith('>') || trimmed.startsWith('<')) return null
  if (trimmed.startsWith('(') || trimmed.endsWith(')')) return null
  if (trimmed.startsWith('$(') || trimmed.startsWith('<(') || trimmed.startsWith('>(')) return null
  if (trimmed.includes('`')) return null
  if (trimmed.includes('*') || trimmed.includes('?') || trimmed.includes('[')) return null
  return trimmed
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current)
      current = ''
    }
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && quote !== '\'') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }

    if (
      (char === '&' && next === '&') ||
      (char === '|' && next === '|') ||
      (char === '>' && next === '>') ||
      (char === '<' && next === '<')
    ) {
      pushCurrent()
      tokens.push(char + next)
      index += 1
      continue
    }

    if (char === '|' || char === ';' || char === '&' || char === '>' || char === '<') {
      pushCurrent()
      tokens.push(char)
      continue
    }

    current += char
  }

  pushCurrent()
  return tokens
}

function collectRedirectionPaths(tokens: string[], addPath: (path: string) => void): void {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    if (!FILE_REDIRECTION_OPERATORS.has(token)) continue
    const next = normalizeCandidatePath(tokens[index + 1])
    if (next) addPath(next)
  }
}

function collectTeePaths(tokens: string[], startIndex: number, addPath: (path: string) => void): number {
  let index = startIndex + 1
  while (index < tokens.length && !CONTROL_OPERATORS.has(tokens[index])) {
    const token = tokens[index]
    if (!token.startsWith('-')) {
      const candidate = normalizeCandidatePath(token)
      if (candidate) addPath(candidate)
    }
    index += 1
  }
  return index
}

function collectTouchOrRmPaths(tokens: string[], startIndex: number, addPath: (path: string) => void): number {
  let index = startIndex + 1
  while (index < tokens.length && !CONTROL_OPERATORS.has(tokens[index])) {
    const token = tokens[index]
    if (!token.startsWith('-')) {
      const candidate = normalizeCandidatePath(token)
      if (candidate && !candidate.endsWith('/') && !candidate.endsWith('\\')) {
        addPath(candidate)
      }
    }
    index += 1
  }
  return index
}

function getPathBaseName(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

function buildDirectoryTargetPath(directoryPath: string, sourcePath: string): string | null {
  const sourceBaseName = getPathBaseName(sourcePath)
  if (!sourceBaseName || sourceBaseName === '.' || sourceBaseName === '..') {
    return null
  }
  if (directoryPath.endsWith('/') || directoryPath.endsWith('\\')) {
    return `${directoryPath}${sourceBaseName}`
  }
  return `${directoryPath}/${sourceBaseName}`
}

function collectMvOrCpPaths(tokens: string[], startIndex: number, addPath: (path: string) => void): number {
  const command = tokens[startIndex]
  let index = startIndex + 1
  const positional: string[] = []

  while (index < tokens.length && !CONTROL_OPERATORS.has(tokens[index])) {
    const token = tokens[index]
    if (!token.startsWith('-')) {
      positional.push(token)
    }
    index += 1
  }

  if (positional.length >= 2) {
    const destination = normalizeCandidatePath(positional[positional.length - 1])
    const sourcePaths = positional
      .slice(0, -1)
      .map((pathValue) => normalizeCandidatePath(pathValue))
      .filter((pathValue): pathValue is string => Boolean(pathValue))
    const destinationIsDirectoryTarget =
      Boolean(destination) &&
      (destination.endsWith('/') || destination.endsWith('\\') || sourcePaths.length > 1)

    if (destination) {
      if (destinationIsDirectoryTarget) {
        for (const sourcePath of sourcePaths) {
          const expandedPath = buildDirectoryTargetPath(destination, sourcePath)
          const candidate = expandedPath ? normalizeCandidatePath(expandedPath) : null
          if (candidate) addPath(candidate)
        }
      } else {
        addPath(destination)
        if (sourcePaths.length === 1) {
          const inferredDirectoryTargetPath = buildDirectoryTargetPath(destination, sourcePaths[0])
          const inferredCandidate = inferredDirectoryTargetPath
            ? normalizeCandidatePath(inferredDirectoryTargetPath)
            : null
          if (inferredCandidate) addPath(inferredCandidate)
        }
      }
    }

    if (command === 'mv') {
      for (const sourcePath of sourcePaths) {
        addPath(sourcePath)
      }
    }
  }

  return index
}

function collectSedInPlacePaths(tokens: string[], startIndex: number, addPath: (path: string) => void): number {
  let index = startIndex + 1
  const args: string[] = []

  while (index < tokens.length && !CONTROL_OPERATORS.has(tokens[index])) {
    args.push(tokens[index])
    index += 1
  }

  let hasInPlace = false
  let scriptProvidedByOption = false
  const optionAdjusted: string[] = []
  for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
    const arg = args[argIndex]
    if (arg === '-e' || arg === '-f') {
      scriptProvidedByOption = true
      argIndex += 1
      continue
    }
    if (arg.startsWith('-')) {
      if (arg === '-i' || arg.startsWith('-i')) {
        hasInPlace = true
      }
      continue
    }
    optionAdjusted.push(arg)
  }

  if (!hasInPlace) {
    return index
  }

  const fileArgs = scriptProvidedByOption ? optionAdjusted : optionAdjusted.slice(1)
  for (const fileArg of fileArgs) {
    const candidate = normalizeCandidatePath(fileArg)
    if (candidate) addPath(candidate)
  }

  return index
}

export function extractTrackedPathsFromBashCommand(
  command: string,
  maxPaths: number = BASH_TRACKING_MAX_PATHS
): string[] {
  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) return []

  const deduped = new Set<string>()
  const addPath = (path: string) => {
    if (deduped.size >= maxPaths) return
    deduped.add(path)
  }

  collectRedirectionPaths(tokens, addPath)

  for (let index = 0; index < tokens.length; index += 1) {
    if (deduped.size >= maxPaths) break
    const token = tokens[index]

    if (token === 'tee') {
      index = collectTeePaths(tokens, index, addPath) - 1
      continue
    }

    if (token === 'sed') {
      index = collectSedInPlacePaths(tokens, index, addPath) - 1
      continue
    }

    if (token === 'touch' || token === 'rm') {
      index = collectTouchOrRmPaths(tokens, index, addPath) - 1
      continue
    }

    if (token === 'mv' || token === 'cp') {
      index = collectMvOrCpPaths(tokens, index, addPath) - 1
    }
  }

  return Array.from(deduped)
}

export function collectTrackedPathsFromToolUse(
  toolName: string | undefined,
  toolInput: ToolInputLike | undefined,
  maxPaths: number = BASH_TRACKING_MAX_PATHS
): string[] {
  const paths: string[] = []
  const deduped = new Set<string>()
  const pushPath = (pathValue: string | null) => {
    if (!pathValue) return
    if (deduped.has(pathValue)) return
    if (deduped.size >= maxPaths) return
    deduped.add(pathValue)
    paths.push(pathValue)
  }

  const shouldTrackDirectPath =
    toolName !== 'Bash' && (toolName == null || !READ_ONLY_TOOL_NAMES.has(toolName))
  const directFilePath = shouldTrackDirectPath ? toNonEmptyString(toolInput?.file_path) : null
  pushPath(directFilePath)

  if (toolName === 'Bash') {
    const command = toNonEmptyString(toolInput?.command)
    if (command) {
      for (const extractedPath of extractTrackedPathsFromBashCommand(command, maxPaths)) {
        pushPath(extractedPath)
      }
    }
  }

  return paths
}

export function trackChangeFileFromToolUse(
  spaceId: string,
  conversationId: string,
  toolName: string | undefined,
  toolInput: ToolInputLike | undefined,
  trackChangeFileFn: (spaceId: string, conversationId: string, filePath?: string) => void
): void {
  const trackedPaths = collectTrackedPathsFromToolUse(toolName, toolInput)
  for (const path of trackedPaths) {
    trackChangeFileFn(spaceId, conversationId, path)
  }
}
