/**
 * Agents Service - 管理自定义子代理
 */

// SDK AgentDefinition 类型 (匹配 @anthropic-ai/claude-agent-sdk)
export interface AgentDefinition {
  description: string
  tools?: string[]
  disallowedTools?: string[]
  prompt: string
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  mcpServers?: (string | Record<string, any>)[]
  criticalSystemReminder_EXPERIMENTAL?: string
}

// 用户配置的代理格式
export interface AgentConfig {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  mcpServers?: string[]
}

// ============================================
// 内置代理定义
// ============================================

const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
  'quick-task': {
    description: 'Fast agent for simple, straightforward tasks that need quick execution',
    prompt: `You are a fast, efficient assistant for quick tasks.
Focus on speed and directness. Complete tasks with minimal back-and-forth.
Prefer simple solutions over complex ones.
Do not over-explain or add unnecessary context.`,
    model: 'haiku',
    tools: ['Read', 'Grep', 'Glob', 'Bash']
  },

  'code-reviewer': {
    description: 'Specialized agent for reviewing code quality, security, and best practices',
    prompt: `You are an expert code reviewer.
Focus on:
- Code quality and readability
- Security vulnerabilities (OWASP Top 10)
- Performance issues and bottlenecks
- Best practices and design patterns
- Potential bugs and edge cases

Provide constructive feedback with specific suggestions and code examples.
Be thorough but concise.`,
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob']
  },

  'researcher': {
    description: 'Agent for researching codebases, gathering information, and exploring',
    prompt: `You are a research specialist.
Your job is to thoroughly explore and understand codebases.
Search comprehensively, follow references, and provide detailed findings.
Document your discoveries clearly with file paths and line numbers.
Create summaries that help others understand the codebase structure.`,
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash']
  },

  'test-runner': {
    description: 'Agent specialized in running and analyzing tests',
    prompt: `You are a test execution specialist.
Run tests, analyze failures, and provide clear reports.
Focus on:
- Identifying root causes of test failures
- Suggesting fixes for failing tests
- Recommending additional test coverage
- Explaining test results clearly`,
    model: 'sonnet',
    tools: ['Read', 'Bash', 'Grep']
  },

  'refactor': {
    description: 'Agent for refactoring code while maintaining functionality',
    prompt: `You are a refactoring specialist.
Your job is to improve code structure without changing behavior.
Focus on:
- Reducing code duplication
- Improving naming and readability
- Simplifying complex logic
- Following SOLID principles
- Maintaining backward compatibility

Always verify changes don't break existing functionality.`,
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash']
  }
}

// ============================================
// 获取代理定义
// ============================================

/**
 * 获取合并后的代理定义
 * 优先级: 空间 > 全局 > 内置
 */
export function getAgentDefinitions(
  globalAgents: Record<string, AgentConfig> = {},
  spaceAgents: Record<string, AgentConfig> = {}
): Record<string, AgentDefinition> {
  // 合并: 内置 < 全局 < 空间
  return {
    ...BUILTIN_AGENTS,
    ...convertToAgentDefinitions(globalAgents),
    ...convertToAgentDefinitions(spaceAgents)
  }
}

/**
 * 转换用户配置格式到 SDK AgentDefinition 格式
 */
function convertToAgentDefinitions(
  userAgents: Record<string, AgentConfig>
): Record<string, AgentDefinition> {
  const result: Record<string, AgentDefinition> = {}

  for (const [name, config] of Object.entries(userAgents)) {
    if (!config.description || !config.prompt) {
      console.warn(`[Agents] Invalid agent config for "${name}": missing description or prompt`)
      continue
    }

    result[name] = {
      description: config.description,
      prompt: config.prompt,
      tools: config.tools,
      disallowedTools: config.disallowedTools,
      model: config.model || 'inherit',
      mcpServers: config.mcpServers
    }
  }

  return result
}

/**
 * 获取内置代理列表
 */
export function getBuiltinAgents(): Record<string, AgentDefinition> {
  return { ...BUILTIN_AGENTS }
}

// Agent list item for frontend display
export interface AgentListItem {
  name: string
  description: string
  model: string
  isBuiltin: boolean
  source: 'builtin' | 'global' | 'space'
}

/**
 * 获取代理列表（用于前端显示）
 */
export function listAgents(
  globalAgents: Record<string, AgentConfig> = {},
  spaceAgents: Record<string, AgentConfig> = {}
): AgentListItem[] {
  const result: AgentListItem[] = []

  // 内置代理
  for (const [name, def] of Object.entries(BUILTIN_AGENTS)) {
    result.push({
      name,
      description: def.description,
      model: def.model || 'inherit',
      isBuiltin: true,
      source: 'builtin'
    })
  }

  // 全局代理（排除与内置同名的）
  for (const [name, config] of Object.entries(globalAgents)) {
    if (!BUILTIN_AGENTS[name]) {
      result.push({
        name,
        description: config.description || '',
        model: config.model || 'inherit',
        isBuiltin: false,
        source: 'global'
      })
    }
  }

  // 空间代理（排除与内置和全局同名的）
  for (const [name, config] of Object.entries(spaceAgents)) {
    if (!BUILTIN_AGENTS[name] && !globalAgents[name]) {
      result.push({
        name,
        description: config.description || '',
        model: config.model || 'inherit',
        isBuiltin: false,
        source: 'space'
      })
    }
  }

  return result
}
