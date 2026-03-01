/**
 * Skills SDK MCP Server
 *
 * Provides on-demand access to skills without preloading them into context.
 */

import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { listSkills, getSkillContent } from './skills.service'

export const SKILLS_LAZY_SYSTEM_PROMPT = `
## Lazy Skills / Commands / Agents
Skills, commands, and agents are not preloaded.
- If the user includes a line: /name → the system may inject a <skill> or <command> block.
- If the user includes a line: @agent → the system will inject a <task-request> block.

When you see:
- <skill name="X">...</skill> → treat as authoritative skill instructions.
- <command name="X">...</command> → treat as authoritative command instructions.
- <task-request name="X">...</task-request> → YOU MUST call the Task tool with:
  { "description": "X", "prompt": "<content>", "subagent_type": "X" }.
`

function buildSkillsTools(workDir?: string) {
  const skills_list = tool(
    'skills_list',
    'List available skills (name + short description). Use query to filter.',
    {
      query: z.string().optional().describe('Optional case-insensitive filter on skill name/description'),
      limit: z.number().optional().describe('Max results to return (default: 50)')
    },
    async (args) => {
      const skills = listSkills(workDir, 'runtime-direct')
      const query = (args.query || '').trim().toLowerCase()
      const limit = Math.max(1, Math.min(200, args.limit ?? 50))

      const filtered = query.length === 0
        ? skills
        : skills.filter((s) => {
            const name = s.name.toLowerCase()
            const desc = (s.description || '').toLowerCase()
            return name.includes(query) || desc.includes(query)
          })

      const sliced = filtered.slice(0, limit)
      const lines = sliced.map((s) => {
        const desc = s.description ? ` - ${s.description}` : ''
        return `/${s.name}${desc}`
      })

      const header = `Skills (${sliced.length}/${filtered.length} shown)`
      return {
        content: [{ type: 'text' as const, text: [header, ...lines].join('\n') }]
      }
    }
  )

  const skills_get = tool(
    'skills_get',
    'Get full SKILL.md content for a skill by name.',
    {
      name: z.string().describe('Skill name (directory name)'),
      maxChars: z.number().optional().describe('Optional max characters to return')
    },
    async (args) => {
      const content = getSkillContent(args.name, workDir)
      if (!content) {
        return {
          content: [{ type: 'text' as const, text: `Skill not found: ${args.name}` }],
          isError: true
        }
      }

      let text = content.content
      if (args.maxChars && args.maxChars > 0 && text.length > args.maxChars) {
        text = text.slice(0, args.maxChars) + '\n\n[truncated]'
      }

      return {
        content: [{ type: 'text' as const, text }]
      }
    }
  )

  return [skills_list, skills_get]
}

/**
 * Create Skills SDK MCP Server (in-process)
 */
export function createSkillsMcpServer(workDir?: string) {
  return createSdkMcpServer({
    name: 'skills',
    version: '1.0.0',
    tools: buildSkillsTools(workDir)
  })
}
