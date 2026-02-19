/**
 * Lazy Directive Expander
 *
 * Expands:
 * - "/skill-name" → <skill>SKILL.md</skill>
 * - "/command-name" → <command>command.md</command>
 * - "@agent-name" → <task-request>agent.md</task-request>
 *
 * Only active when skillsLazyLoad is enabled.
 */

import { getSkillContent, getSkillDefinition } from '../skills.service'
import { getCommand, getCommandContent } from '../commands.service'
import { getAgent, getAgentContent } from '../agents.service'
import { toolkitContains } from '../toolkit.service'
import type { SpaceToolkit } from '../space-config.service'

const SLASH_LINE_RE = /^\/([A-Za-z0-9._:-]+)(?:\s+(.+))?$/
const AT_LINE_RE = /^@([A-Za-z0-9._:-]+)(?:\s+(.+))?$/
const TOKEN_CHAR_RE = /[A-Za-z0-9._:-]/

interface ParsedDirectiveToken {
  raw: string
  name: string
  namespace?: string
}

interface ExpansionState {
  expanded: LazyExpansionResult['expanded']
  missing: LazyExpansionResult['missing']
  expandedSeen: {
    skills: Set<string>
    commands: Set<string>
    agents: Set<string>
  }
  missingSeen: {
    skills: Set<string>
    commands: Set<string>
    agents: Set<string>
  }
}

interface InlineTokenMatch {
  type: 'slash' | 'at'
  token: ParsedDirectiveToken
}

interface CodeRange {
  start: number
  end: number
}

interface ExpandLazyDirectiveOptions {
  skip?: Set<string>
  allowSources?: string[]
}

export interface LazyExpansionResult {
  text: string
  expanded: {
    skills: string[]
    commands: string[]
    agents: string[]
  }
  missing: {
    skills: string[]
    commands: string[]
    agents: string[]
  }
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
function escapeHtml(str: string): string {
  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;'
  }

  return str.replace(/[&<>"']/g, (char) => htmlEscapeMap[char])
}

function buildArgsAttr(args?: string): string {
  if (!args) return ''
  return ` args="${escapeHtml(args)}"`
}

/**
 * Parse token using first ":" separator (split(':', 2)).
 * This MUST stay aligned with skills/commands/agents service lookup behavior.
 */
export function parseDirectiveToken(raw: string): ParsedDirectiveToken | null {
  const value = raw.trim()
  if (!value) return null

  if (!value.includes(':')) {
    return { raw: value, name: value }
  }

  const [namespace, name] = value.split(':', 2)
  if (!namespace || !name) return null

  return {
    raw: value,
    namespace,
    name
  }
}

function pushUnique(
  list: string[],
  seen: Set<string>,
  value: string
): void {
  if (seen.has(value)) return
  seen.add(value)
  list.push(value)
}

function pushExpanded(
  state: ExpansionState,
  type: 'skills' | 'commands' | 'agents',
  value: string
): void {
  pushUnique(state.expanded[type], state.expandedSeen[type], value)
}

function pushMissing(
  state: ExpansionState,
  type: 'skills' | 'commands' | 'agents',
  value: string
): void {
  pushUnique(state.missing[type], state.missingSeen[type], value)
}

/**
 * Removes YAML frontmatter from content.
 * Protects against ReDoS by using simple string operations and size limits.
 */
export function stripFrontmatter(content: string): string {
  const MAX_SIZE = 1024 * 1024 // 1MB
  if (content.length > MAX_SIZE) {
    throw new Error(`Input too large: ${content.length} bytes exceeds ${MAX_SIZE} byte limit`)
  }

  if (!content.startsWith('---')) {
    return content
  }

  const lines = content.split('\n')
  if (lines[0].trim() !== '---') {
    return content
  }

  const maxLinesToCheck = Math.min(lines.length, 1000)
  for (let i = 1; i < maxLinesToCheck; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n')
    }
  }

  return content
}

function findReferencedSkill(commandContent: string): string | null {
  const body = stripFrontmatter(commandContent)
  const match = body.match(/\b(?:invoke|use|run)\s+(?:the\s+)?([A-Za-z0-9._:-]+)\s+skill\b/i)
  if (!match) return null
  return match[1]
}

function canUseFromToolkit(
  toolkit: SpaceToolkit | null | undefined,
  type: 'skill' | 'command' | 'agent',
  token: ParsedDirectiveToken
): boolean {
  if (!toolkit) return true
  return toolkitContains(toolkit, type, {
    name: token.name,
    namespace: token.namespace
  })
}

function isAllowedSource(allowedSources: string[] | undefined, source: string | undefined): boolean {
  if (!allowedSources || allowedSources.length === 0) return true
  if (!source) return false
  return allowedSources.includes(source)
}

function shouldSkipToken(token: ParsedDirectiveToken, options?: ExpandLazyDirectiveOptions): boolean {
  if (!options?.skip) return false
  return options.skip.has(token.raw) || options.skip.has(token.name)
}

function expandAgentDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  toolkit?: SpaceToolkit | null,
  args?: string,
  options?: ExpandLazyDirectiveOptions
): string | null {
  if (shouldSkipToken(token, options)) {
    return null
  }

  if (!canUseFromToolkit(toolkit, 'agent', token)) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  const agentDefinition = getAgent(token.raw, workDir)
  if (!agentDefinition || !isAllowedSource(options?.allowSources, agentDefinition.source)) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  const agentContent = getAgentContent(token.raw, workDir)
  if (!agentContent) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  pushExpanded(state, 'agents', token.raw)
  const argsAttr = buildArgsAttr(args)
  return [
    '<!-- injected: agent -->',
    `<task-request name="${token.raw}"${argsAttr}>`,
    agentContent.trimEnd(),
    '</task-request>'
  ].join('\n')
}

function expandSlashDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  toolkit?: SpaceToolkit | null,
  args?: string,
  options?: ExpandLazyDirectiveOptions
): string | null {
  if (shouldSkipToken(token, options)) {
    return null
  }

  const argsAttr = buildArgsAttr(args)
  const commandDefinition = getCommand(token.raw, workDir)
  const command = commandDefinition ? getCommandContent(token.raw, workDir, { silent: true }) : null

  if (command) {
    if (!isAllowedSource(options?.allowSources, commandDefinition?.source)) {
      pushMissing(state, 'commands', token.raw)
      return null
    }

    if (!canUseFromToolkit(toolkit, 'command', token)) {
      pushMissing(state, 'commands', token.raw)
      return null
    }

    const referencedSkillRaw = findReferencedSkill(command)
    if (referencedSkillRaw) {
      const referencedSkillToken = parseDirectiveToken(referencedSkillRaw)
      if (referencedSkillToken) {
        if (!canUseFromToolkit(toolkit, 'skill', referencedSkillToken)) {
          pushMissing(state, 'skills', referencedSkillToken.raw)
          return null
        }

        const skillDefinition = getSkillDefinition(referencedSkillToken.raw, workDir)
        if (!skillDefinition || !isAllowedSource(options?.allowSources, skillDefinition.source)) {
          pushMissing(state, 'skills', referencedSkillToken.raw)
          return null
        }

        const skill = getSkillContent(referencedSkillToken.raw, workDir)
        if (skill) {
          pushExpanded(state, 'skills', referencedSkillToken.raw)
          return [
            '<!-- injected: command-skill -->',
            `<skill name="${referencedSkillToken.raw}"${argsAttr}>`,
            skill.content.trimEnd(),
            '</skill>'
          ].join('\n')
        }
      }
    }

    pushExpanded(state, 'commands', token.raw)
    return [
      '<!-- injected: command -->',
      `<command name="${token.raw}"${argsAttr}>`,
      command.trimEnd(),
      '</command>'
    ].join('\n')
  }

  if (!canUseFromToolkit(toolkit, 'skill', token)) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  const skillDefinition = getSkillDefinition(token.raw, workDir)
  if (!skillDefinition || !isAllowedSource(options?.allowSources, skillDefinition.source)) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  const skill = getSkillContent(token.raw, workDir)
  if (!skill) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  pushExpanded(state, 'skills', token.raw)
  return [
    '<!-- injected: skill -->',
    `<skill name="${token.raw}"${argsAttr}>`,
    skill.content.trimEnd(),
    '</skill>'
  ].join('\n')
}

function isSlashBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_/:.@-]/.test(prev)
}

function isAtBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_.+-]/.test(prev)
}

function getInlineCodeRanges(line: string): CodeRange[] {
  const ranges: CodeRange[] = []
  let i = 0

  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1
      continue
    }

    let tickCount = 1
    while (i + tickCount < line.length && line[i + tickCount] === '`') {
      tickCount += 1
    }

    const marker = '`'.repeat(tickCount)
    const closeIndex = line.indexOf(marker, i + tickCount)
    if (closeIndex === -1) {
      break
    }

    ranges.push({
      start: i,
      end: closeIndex + tickCount
    })

    i = closeIndex + tickCount
  }

  return ranges
}

function collectInlineDirectiveTokens(line: string): InlineTokenMatch[] {
  const ranges = getInlineCodeRanges(line)
  const matches: InlineTokenMatch[] = []
  let i = 0
  let rangeIdx = 0

  while (i < line.length) {
    const currentRange = ranges[rangeIdx]
    if (currentRange && i >= currentRange.start && i < currentRange.end) {
      i = currentRange.end
      rangeIdx += 1
      continue
    }

    const ch = line[i]
    if (ch !== '/' && ch !== '@') {
      i += 1
      continue
    }

    if (i > 0 && line[i - 1] === '\\') {
      i += 1
      continue
    }

    const prev = i > 0 ? line[i - 1] : undefined
    if (ch === '/' && !isSlashBoundary(prev)) {
      i += 1
      continue
    }
    if (ch === '@' && !isAtBoundary(prev)) {
      i += 1
      continue
    }

    let j = i + 1
    while (j < line.length && TOKEN_CHAR_RE.test(line[j])) {
      j += 1
    }

    if (j === i + 1) {
      i += 1
      continue
    }

    // Skip path-like fragments such as "/alpha/log.txt".
    if (ch === '/' && j < line.length && line[j] === '/') {
      i = j
      continue
    }

    const token = parseDirectiveToken(line.slice(i + 1, j))
    if (token) {
      matches.push({
        type: ch === '/' ? 'slash' : 'at',
        token
      })
    }

    i = j
  }

  return matches
}

export function expandLazyDirectives(
  input: string,
  workDir?: string,
  toolkitOrOptions?: SpaceToolkit | null | ExpandLazyDirectiveOptions,
  maybeOptions?: ExpandLazyDirectiveOptions
): LazyExpansionResult {
  const toolkit = (
    toolkitOrOptions &&
    typeof toolkitOrOptions === 'object' &&
    ('skills' in toolkitOrOptions || 'commands' in toolkitOrOptions || 'agents' in toolkitOrOptions)
  ) ? (toolkitOrOptions as SpaceToolkit | null) : undefined

  const options = (
    toolkitOrOptions &&
    typeof toolkitOrOptions === 'object' &&
    !('skills' in toolkitOrOptions || 'commands' in toolkitOrOptions || 'agents' in toolkitOrOptions)
  ) ? (toolkitOrOptions as ExpandLazyDirectiveOptions) : maybeOptions

  const state: ExpansionState = {
    expanded: { skills: [], commands: [], agents: [] },
    missing: { skills: [], commands: [], agents: [] },
    expandedSeen: {
      skills: new Set<string>(),
      commands: new Set<string>(),
      agents: new Set<string>()
    },
    missingSeen: {
      skills: new Set<string>(),
      commands: new Set<string>(),
      agents: new Set<string>()
    }
  }

  const lines = input.split(/\r?\n/)
  const inlineInjectionBlocks: string[] = []
  const seenInlineTokenKeys = new Set<string>()
  let inFence = false

  const outLines = lines.map((line) => {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inFence = !inFence
      return line
    }

    if (inFence) return line

    const agentMatch = trimmed.match(AT_LINE_RE)
    if (agentMatch) {
      const token = parseDirectiveToken(agentMatch[1])
      if (!token) return line
      const expanded = expandAgentDirective(token, state, workDir, toolkit, agentMatch[2], options)
      return expanded ?? line
    }

    const slashMatch = trimmed.match(SLASH_LINE_RE)
    if (slashMatch) {
      const token = parseDirectiveToken(slashMatch[1])
      if (!token) return line
      const expanded = expandSlashDirective(token, state, workDir, toolkit, slashMatch[2], options)
      return expanded ?? line
    }

    const inlineTokens = collectInlineDirectiveTokens(line)
    for (const match of inlineTokens) {
      const tokenKey = `${match.type}:${match.token.raw}`
      if (seenInlineTokenKeys.has(tokenKey)) continue

      const block = match.type === 'at'
        ? expandAgentDirective(match.token, state, workDir, toolkit, undefined, options)
        : expandSlashDirective(match.token, state, workDir, toolkit, undefined, options)

      if (!block) continue
      seenInlineTokenKeys.add(tokenKey)
      inlineInjectionBlocks.push(block)
    }

    return line
  })

  const outText = outLines.join('\n')
  const prefixedText = inlineInjectionBlocks.length > 0
    ? (outText.trim().length > 0
      ? `${inlineInjectionBlocks.join('\n\n')}\n\n${outText}`
      : inlineInjectionBlocks.join('\n\n'))
    : outText

  return {
    text: prefixedText,
    expanded: state.expanded,
    missing: state.missing
  }
}
