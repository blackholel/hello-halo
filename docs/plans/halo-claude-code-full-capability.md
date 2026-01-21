# Halo 系统级 Claude Code 完整能力改造计划

## 目标

将 Halo 改造为完全支持系统级 Claude Code 所有能力，包括：
- 子代理 (Subagents)
- 技能 (Skills)
- 记忆功能 (Memory)
- 钩子系统 (Hooks)
- 斜杠命令 (Slash Commands)
- MCP Servers
- Plugins 插件

## 当前状态分析

| 功能 | Claude Code CLI | Halo 当前 | 差距 |
|-----|----------------|----------|------|
| 子代理 | ✅ Task tool + agents | ❌ 未使用 | 需添加 agents 参数 |
| Skills | ✅ ~/.claude/skills | ⚠️ ~/.halo/skills | 需添加系统级路径 |
| 记忆 | ✅ CLAUDE.md | ❌ 不支持 | 需实现记忆注入 |
| Hooks | ✅ 12种事件 | ❌ 未使用 | 需添加 hooks 参数 |
| 斜杠命令 | ✅ /command | ✅ 部分 | 需启用 settingSources |
| MCP | ✅ | ✅ | 已实现 |
| Plugins | ✅ | ✅ 部分 | 需添加系统级路径 |
| 系统配置 | ✅ ~/.claude/ | ❌ ~/.halo/ | 需启用 settingSources |

## 实现步骤

---

### Phase 1: 配置层扩展

#### 1.1 扩展 HaloConfig 类型

**文件**: `src/main/services/config.service.ts`

```typescript
interface HaloConfig {
  // ... 现有配置

  // 新增: Claude Code 兼容性配置
  claudeCodeCompat: {
    // 是否启用系统级 Claude Code 配置加载
    enableSystemSettings: boolean
    // 是否加载 ~/.claude/skills/
    enableSystemSkills: boolean
    // 是否启用记忆功能 (CLAUDE.md)
    enableMemory: boolean
    // 是否启用钩子系统
    enableHooks: boolean
  }

  // 新增: 自定义子代理配置
  agents?: Record<string, AgentConfig>

  // 新增: 钩子配置
  hooks?: HooksConfig
}

interface AgentConfig {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  mcpServers?: string[]
}

interface HooksConfig {
  PreToolUse?: HookMatcher[]
  PostToolUse?: HookMatcher[]
  SessionStart?: HookMatcher[]
  // ... 其他钩子事件
}

interface HookMatcher {
  matcher?: string
  command?: string  // Shell 命令形式
  timeout?: number
}
```

#### 1.2 添加默认配置

```typescript
const DEFAULT_CONFIG: HaloConfig = {
  // ... 现有默认值

  claudeCodeCompat: {
    enableSystemSettings: false,  // 默认关闭，用户可选择开启
    enableSystemSkills: false,
    enableMemory: true,           // 记忆功能默认开启
    enableHooks: false
  },
  agents: {},
  hooks: {}
}
```

---

### Phase 2: 记忆功能实现

#### 2.1 创建记忆服务

**新文件**: `src/main/services/memory.service.ts`

```typescript
/**
 * Memory Service - 管理 CLAUDE.md 记忆文件
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// 记忆文件路径
export function getUserMemoryPath(): string {
  return join(homedir(), '.claude', 'CLAUDE.md')
}

export function getProjectMemoryPath(workDir: string): string {
  return join(workDir, '.claude', 'CLAUDE.md')
}

// 读取记忆内容
export function readMemory(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8')
    }
  } catch (e) {
    console.warn(`[Memory] Failed to read memory file: ${path}`, e)
  }
  return null
}

// 获取所有记忆内容（格式化）
export function getFormattedMemory(workDir: string): string {
  const userMemory = readMemory(getUserMemoryPath())
  const projectMemory = readMemory(getProjectMemoryPath(workDir))

  let result = ''

  if (userMemory) {
    result += `\n## Global Memory (from ~/.claude/CLAUDE.md)\n${userMemory}\n`
  }

  if (projectMemory) {
    result += `\n## Project Memory (from .claude/CLAUDE.md)\n${projectMemory}\n`
  }

  return result
}

// 写入记忆（用于 AI 自动更新记忆）
export function writeMemory(path: string, content: string): boolean {
  try {
    writeFileSync(path, content, 'utf-8')
    return true
  } catch (e) {
    console.error(`[Memory] Failed to write memory file: ${path}`, e)
    return false
  }
}
```

---

### Phase 3: 子代理系统实现

#### 3.1 创建代理定义服务

**新文件**: `src/main/services/agents.service.ts`

```typescript
/**
 * Agents Service - 管理自定义子代理
 */

import { getConfig } from './config.service'

// SDK AgentDefinition 类型
export interface AgentDefinition {
  description: string
  tools?: string[]
  disallowedTools?: string[]
  prompt: string
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
  mcpServers?: (string | Record<string, any>)[]
  criticalSystemReminder_EXPERIMENTAL?: string
}

// 内置代理定义
const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
  'quick-task': {
    description: 'Fast agent for simple, straightforward tasks that need quick execution',
    prompt: `You are a fast, efficient assistant for quick tasks.
Focus on speed and directness. Complete tasks with minimal back-and-forth.
Prefer simple solutions over complex ones.`,
    model: 'haiku',
    tools: ['Read', 'Grep', 'Glob', 'Bash']
  },

  'code-reviewer': {
    description: 'Specialized agent for reviewing code quality, security, and best practices',
    prompt: `You are an expert code reviewer.
Focus on:
- Code quality and readability
- Security vulnerabilities
- Performance issues
- Best practices and patterns
Provide constructive feedback with specific suggestions.`,
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob']
  },

  'researcher': {
    description: 'Agent for researching codebases, gathering information, and exploring',
    prompt: `You are a research specialist.
Your job is to thoroughly explore and understand codebases.
Search comprehensively, follow references, and provide detailed findings.`,
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash']
  }
}

// 获取所有代理定义（内置 + 用户自定义）
export function getAgentDefinitions(): Record<string, AgentDefinition> {
  const config = getConfig()
  const userAgents = config.agents || {}

  // 用户定义的代理可以覆盖内置代理
  return {
    ...BUILTIN_AGENTS,
    ...convertUserAgents(userAgents)
  }
}

// 转换用户配置格式到 SDK 格式
function convertUserAgents(userAgents: Record<string, any>): Record<string, AgentDefinition> {
  const result: Record<string, AgentDefinition> = {}

  for (const [name, config] of Object.entries(userAgents)) {
    result[name] = {
      description: config.description || `Custom agent: ${name}`,
      prompt: config.prompt || '',
      tools: config.tools,
      disallowedTools: config.disallowedTools,
      model: config.model || 'inherit',
      mcpServers: config.mcpServers
    }
  }

  return result
}
```

---

### Phase 4: 钩子系统实现

#### 4.1 创建钩子服务

**新文件**: `src/main/services/hooks.service.ts`

```typescript
/**
 * Hooks Service - 管理 Claude Code 钩子
 */

import { getConfig } from './config.service'
import { spawn } from 'child_process'

// SDK Hook 类型
export type HookEvent =
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'Notification' | 'UserPromptSubmit'
  | 'SessionStart' | 'SessionEnd' | 'Stop'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreCompact' | 'PermissionRequest'

export interface HookCallback {
  (input: any, toolUseID: string | undefined, options: { signal: AbortSignal }): Promise<HookOutput>
}

export interface HookOutput {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: any
}

export interface HookCallbackMatcher {
  matcher?: string
  hooks: HookCallback[]
  timeout?: number
}

// 从配置构建 SDK hooks 参数
export function buildHooksFromConfig(): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  const config = getConfig()

  if (!config.claudeCodeCompat?.enableHooks || !config.hooks) {
    return undefined
  }

  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}

  for (const [event, matchers] of Object.entries(config.hooks)) {
    if (!Array.isArray(matchers)) continue

    result[event as HookEvent] = matchers.map(m => ({
      matcher: m.matcher,
      timeout: m.timeout,
      hooks: [createHookCallback(m)]
    }))
  }

  return Object.keys(result).length > 0 ? result : undefined
}

// 创建钩子回调函数
function createHookCallback(matcher: any): HookCallback {
  return async (input, toolUseID, { signal }) => {
    // 如果配置了 shell 命令，执行它
    if (matcher.command) {
      try {
        const result = await executeHookCommand(matcher.command, input, signal)
        return parseHookResult(result)
      } catch (e) {
        console.error('[Hooks] Command execution failed:', e)
        return { continue: true }
      }
    }

    // 默认继续
    return { continue: true }
  }
}

// 执行钩子命令
async function executeHookCommand(
  command: string,
  input: any,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', command], {
      env: {
        ...process.env,
        HOOK_INPUT: JSON.stringify(input)
      }
    })

    let stdout = ''
    proc.stdout.on('data', (data) => { stdout += data })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Hook command exited with code ${code}`))
    })
    proc.on('error', reject)

    signal.addEventListener('abort', () => proc.kill())
  })
}

// 解析钩子命令输出
function parseHookResult(output: string): HookOutput {
  try {
    return JSON.parse(output)
  } catch {
    return { continue: true }
  }
}

// 内置钩子：会话开始时注入 Halo 上下文
export function getBuiltinHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    SessionStart: [{
      hooks: [async (input) => ({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `
[Halo Context]
- Session started at: ${new Date().toISOString()}
- Running in Halo Desktop App
- Extended capabilities: AI Browser, Canvas, Remote Access
`
        }
      })]
    }]
  }
}
```

---

### Phase 5: 核心 Agent Service 改造

#### 5.1 修改 buildSdkOptions 函数

**文件**: `src/main/services/agent.service.ts`

```typescript
import { getFormattedMemory } from './memory.service'
import { getAgentDefinitions } from './agents.service'
import { buildHooksFromConfig, getBuiltinHooks } from './hooks.service'

function buildSdkOptions(params: {
  spaceId: string
  conversationId: string
  workDir: string
  config: ReturnType<typeof getConfig>
  abortController: AbortController
  anthropicApiKey: string
  anthropicBaseUrl: string
  sdkModel: string
  electronPath: string
  aiBrowserEnabled?: boolean
  thinkingEnabled?: boolean
  stderrSuffix?: string
}): Record<string, any> {
  const {
    spaceId, conversationId, workDir, config,
    abortController, anthropicApiKey, anthropicBaseUrl,
    sdkModel, electronPath, aiBrowserEnabled, thinkingEnabled,
    stderrSuffix = ''
  } = params

  const compat = config.claudeCodeCompat || {}

  // 构建 settingSources
  const settingSources: string[] = []
  if (compat.enableSystemSettings) {
    settingSources.push('user', 'project', 'local')
  }

  // 构建 plugins 配置
  const plugins = buildPluginsConfigEnhanced(workDir, compat.enableSystemSkills)

  // 构建记忆内容
  const memoryContent = compat.enableMemory !== false
    ? getFormattedMemory(workDir)
    : ''

  // 构建代理定义
  const agents = getAgentDefinitions()

  // 构建钩子
  const userHooks = buildHooksFromConfig()
  const builtinHooks = getBuiltinHooks()
  const hooks = mergeHooks(builtinHooks, userHooks)

  const sdkOptions: Record<string, any> = {
    model: sdkModel,
    cwd: workDir,
    abortController,
    env: {
      ...process.env,
      PATH: getPythonEnhancedPath(),
      ELECTRON_RUN_AS_NODE: 1,
      ELECTRON_NO_ATTACH_CONSOLE: 1,
      ANTHROPIC_API_KEY: anthropicApiKey,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1'
    },
    extraArgs: {
      'dangerously-skip-permissions': null
    },
    stderr: (data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr${stderrSuffix}:`, data)
    },

    // 系统提示词（包含记忆）
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: buildSystemPromptAppend(workDir)
        + memoryContent
        + (aiBrowserEnabled ? AI_BROWSER_SYSTEM_PROMPT : '')
    },

    maxTurns: 50,
    allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    permissionMode: 'acceptEdits' as const,
    canUseTool: createCanUseTool(workDir, spaceId, conversationId),
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],

    // 🆕 settingSources - 控制系统配置加载
    settingSources,

    // 🆕 plugins - 包含系统级 Skills
    plugins,

    // 🆕 agents - 自定义子代理
    agents,

    // 🆕 hooks - 钩子系统
    ...(hooks ? { hooks } : {}),

    // Extended thinking
    ...(thinkingEnabled ? { maxThinkingTokens: 10240 } : {}),

    // MCP servers
    ...((() => {
      const enabledMcp = getEnabledMcpServers(config.mcpServers || {})
      const mcpServers: Record<string, any> = enabledMcp ? { ...enabledMcp } : {}
      if (aiBrowserEnabled) {
        mcpServers['ai-browser'] = createAIBrowserMcpServer()
      }
      return Object.keys(mcpServers).length > 0 ? { mcpServers } : {}
    })())
  }

  return sdkOptions
}

// 增强版 plugins 配置构建
function buildPluginsConfigEnhanced(
  workDir: string,
  enableSystemSkills: boolean
): PluginConfig[] {
  const plugins: PluginConfig[] = []

  const isValidPluginPath = (pluginPath: string): boolean => {
    try {
      const stat = lstatSync(pluginPath)
      if (stat.isSymbolicLink()) {
        console.warn(`[Agent] Security: Rejected symlink plugin path: ${pluginPath}`)
        return false
      }
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  // 1. 系统级 Claude Code Skills (最低优先级)
  if (enableSystemSkills) {
    const systemSkillsPath = join(homedir(), '.claude', 'skills')
    if (isValidPluginPath(systemSkillsPath)) {
      plugins.push({ type: 'local', path: systemSkillsPath })
      console.log(`[Agent] Loaded system skills: ${systemSkillsPath}`)
    }
  }

  // 2. Halo 应用级 Skills
  try {
    const haloDir = getHaloDir()
    if (haloDir) {
      const appSkillsPath = join(haloDir, 'skills')
      if (isValidPluginPath(appSkillsPath)) {
        plugins.push({ type: 'local', path: appSkillsPath })
      }
    }
  } catch (e) {
    console.warn('[Agent] Failed to check app-level skills:', e)
  }

  // 3. Space 级 Skills (最高优先级)
  if (workDir) {
    try {
      const spaceSkillsPath = join(workDir, '.claude')
      if (isValidPluginPath(spaceSkillsPath)) {
        plugins.push({ type: 'local', path: spaceSkillsPath })
      }
    } catch (e) {
      console.warn('[Agent] Failed to check space-level skills:', e)
    }
  }

  if (plugins.length > 0) {
    console.log(`[Agent] Plugins loaded: ${plugins.map(p => p.path).join(', ')}`)
  }

  return plugins
}

// 合并钩子配置
function mergeHooks(
  builtin: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  user?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  if (!user) return builtin

  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = { ...builtin }

  for (const [event, matchers] of Object.entries(user)) {
    const existing = result[event as HookEvent] || []
    result[event as HookEvent] = [...existing, ...matchers]
  }

  return result
}
```

---

### Phase 6: 前端配置界面

#### 6.1 添加 Claude Code 兼容性设置页面

**新文件**: `src/renderer/src/components/settings/ClaudeCodeCompatSettings.tsx`

```tsx
import React from 'react'
import { useConfig } from '../../hooks/useConfig'

export function ClaudeCodeCompatSettings() {
  const { config, updateConfig } = useConfig()
  const compat = config.claudeCodeCompat || {}

  const handleToggle = (key: string, value: boolean) => {
    updateConfig({
      claudeCodeCompat: {
        ...compat,
        [key]: value
      }
    })
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Claude Code 兼容性</h2>

      <div className="space-y-4">
        <ToggleOption
          label="启用系统级配置"
          description="加载 ~/.claude/settings.json 中的配置"
          checked={compat.enableSystemSettings}
          onChange={(v) => handleToggle('enableSystemSettings', v)}
        />

        <ToggleOption
          label="启用系统级 Skills"
          description="加载 ~/.claude/skills/ 目录中的技能"
          checked={compat.enableSystemSkills}
          onChange={(v) => handleToggle('enableSystemSkills', v)}
        />

        <ToggleOption
          label="启用记忆功能"
          description="读取 CLAUDE.md 文件作为上下文记忆"
          checked={compat.enableMemory !== false}
          onChange={(v) => handleToggle('enableMemory', v)}
        />

        <ToggleOption
          label="启用钩子系统"
          description="允许配置工具执行前后的钩子"
          checked={compat.enableHooks}
          onChange={(v) => handleToggle('enableHooks', v)}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-md font-medium mb-4">自定义子代理</h3>
        <AgentConfigEditor
          agents={config.agents || {}}
          onChange={(agents) => updateConfig({ agents })}
        />
      </div>
    </div>
  )
}
```

---

### Phase 7: IPC 接口扩展

#### 7.1 添加记忆管理 IPC

**文件**: `src/main/ipc/memory.ts`

```typescript
import { ipcMain } from 'electron'
import {
  getUserMemoryPath,
  getProjectMemoryPath,
  readMemory,
  writeMemory
} from '../services/memory.service'

export function registerMemoryHandlers(): void {
  // 读取用户记忆
  ipcMain.handle('memory:read-user', async () => {
    return readMemory(getUserMemoryPath())
  })

  // 读取项目记忆
  ipcMain.handle('memory:read-project', async (_event, workDir: string) => {
    return readMemory(getProjectMemoryPath(workDir))
  })

  // 写入用户记忆
  ipcMain.handle('memory:write-user', async (_event, content: string) => {
    return writeMemory(getUserMemoryPath(), content)
  })

  // 写入项目记忆
  ipcMain.handle('memory:write-project', async (_event, workDir: string, content: string) => {
    return writeMemory(getProjectMemoryPath(workDir), content)
  })
}
```

---

## 文件变更清单

### 新增文件
- [ ] `src/main/services/memory.service.ts` - 记忆服务
- [ ] `src/main/services/agents.service.ts` - 代理服务
- [ ] `src/main/services/hooks.service.ts` - 钩子服务
- [ ] `src/main/ipc/memory.ts` - 记忆 IPC 处理
- [ ] `src/renderer/src/components/settings/ClaudeCodeCompatSettings.tsx` - 设置界面

### 修改文件
- [ ] `src/main/services/config.service.ts` - 扩展配置类型
- [ ] `src/main/services/agent.service.ts` - 改造 buildSdkOptions
- [ ] `src/main/ipc/index.ts` - 注册新 IPC 处理器
- [ ] `src/renderer/src/pages/Settings.tsx` - 添加新设置页面入口

---

## 测试计划

### 单元测试
- [ ] memory.service.ts - 记忆读写测试
- [ ] agents.service.ts - 代理定义合并测试
- [ ] hooks.service.ts - 钩子构建测试

### 集成测试
- [ ] 启用 settingSources 后能正确加载系统配置
- [ ] 系统级 Skills 能被正确识别和调用
- [ ] 记忆内容能正确注入到系统提示词
- [ ] 自定义子代理能通过 Task tool 调用
- [ ] 钩子能在正确的时机触发

### E2E 测试
- [ ] 完整对话流程中记忆功能正常
- [ ] 子代理切换和执行正常
- [ ] 斜杠命令能正确触发

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| settingSources 可能加载冲突配置 | 中 | 默认关闭，用户手动启用 |
| 系统级 Skills 可能有安全风险 | 高 | 验证路径，拒绝符号链接 |
| 钩子命令执行可能阻塞 | 中 | 设置超时，异步执行 |
| 记忆文件过大影响性能 | 低 | 限制注入长度，截断处理 |

---

## 里程碑

1. **M1 - 基础能力** (Phase 1-2)
   - 配置扩展
   - 记忆功能

2. **M2 - 高级能力** (Phase 3-4)
   - 子代理系统
   - 钩子系统

3. **M3 - 核心改造** (Phase 5)
   - Agent Service 改造
   - 完整集成

4. **M4 - 用户界面** (Phase 6-7)
   - 设置界面
   - IPC 接口

---

## 参考资料

- Claude Agent SDK 类型定义: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- 当前 Agent Service: `src/main/services/agent.service.ts`
- SDK Patch 文件: `patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch`
