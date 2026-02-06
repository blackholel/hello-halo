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

import { getSkillContent } from '../skills.service'
import { getCommandContent } from '../commands.service'
import { getAgentContent } from '../agents.service'

const SLASH_LINE_RE = /^\/([A-Za-z0-9._:-]+)(?:\s+(.+))?$/
const AT_LINE_RE = /^@([A-Za-z0-9._:-]+)(?:\s+(.+))?$/

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

export function expandLazyDirectives(input: string, workDir?: string): LazyExpansionResult {
  const lines = input.split(/\r?\n/)
  const expanded = { skills: [] as string[], commands: [] as string[], agents: [] as string[] }
  const missing = { skills: [] as string[], commands: [] as string[], agents: [] as string[] }
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
      const name = agentMatch[1]
      const args = agentMatch[2]
      const agentContent = getAgentContent(name, workDir)
      if (!agentContent) {
        missing.agents.push(name)
        return line
      }
      expanded.agents.push(name)
      const argsAttr = buildArgsAttr(args)
      return [
        '<!-- injected: agent -->',
        `<task-request name="${name}"${argsAttr}>`,
        agentContent.trimEnd(),
        '</task-request>'
      ].join('\n')
    }

    const slashMatch = trimmed.match(SLASH_LINE_RE)
    if (!slashMatch) return line

    const name = slashMatch[1]
    const args = slashMatch[2]
    const argsAttr = buildArgsAttr(args)

    const command = getCommandContent(name, workDir, { silent: true })
    if (command) {
      const referencedSkill = findReferencedSkill(command)
      if (referencedSkill) {
        const skill = getSkillContent(referencedSkill, workDir)
        if (skill) {
          expanded.skills.push(referencedSkill)
          return [
            '<!-- injected: command-skill -->',
            `<skill name="${referencedSkill}"${argsAttr}>`,
            skill.content.trimEnd(),
            '</skill>'
          ].join('\n')
        }
      }

      expanded.commands.push(name)
      return [
        '<!-- injected: command -->',
        `<command name="${name}"${argsAttr}>`,
        command.trimEnd(),
        '</command>'
      ].join('\n')
    }

    const skill = getSkillContent(name, workDir)
    if (!skill) {
      missing.skills.push(name)
      return line
    }

    expanded.skills.push(name)
    return [
      '<!-- injected: skill -->',
      `<skill name="${name}"${argsAttr}>`,
      skill.content.trimEnd(),
      '</skill>'
    ].join('\n')
  })

  return { text: outLines.join('\n'), expanded, missing }
}
