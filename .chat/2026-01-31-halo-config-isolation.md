# Halo 配置隔离机制实现文档

## 概述

本文档记录了如何让 Halo (`~/.halo/`) 像原生 Claude Code (`~/.claude/`) 一样加载配置的完整实现方案。

## 问题背景

### 原始问题
1. Halo 需要**完全隔离** - 不加载 `~/.claude/` 的任何配置
2. `~/.halo/` 需要作为独立配置源 - 像原生 Claude Code 加载 `~/.claude/` 一样工作
3. 之前的方案设置 `settingSources: []` 实现隔离，但这也禁用了 commands 加载

### 核心发现
SDK 内部使用 `CLAUDE_CONFIG_DIR` 环境变量来确定配置目录：

```javascript
// SDK 内部代码
function getClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")
}
```

设置 `CLAUDE_CONFIG_DIR=~/.halo/` 后，SDK 会从 `~/.halo/` 加载：
- `settings.json` - 用户设置
- `skills/` - Skills 目录
- `commands/` - Commands 目录
- `agents/` - Agents 目录
- `hooks/` - Hooks 配置

## 实现方案

### 核心修改：`src/main/services/agent.service.ts`

#### 1. 添加 `CLAUDE_CONFIG_DIR` 环境变量

**位置**：`buildSdkOptions` 函数的 `env` 对象

```typescript
const sdkOptions: Record<string, any> = {
  // ...
  env: {
    ...process.env,
    // 设置 CLAUDE_CONFIG_DIR 让 SDK 使用 ~/.halo/ 作为 home 目录
    // 这提供了与系统 Claude Code 配置的完全隔离
    CLAUDE_CONFIG_DIR: getHaloDir(),
    PATH: getPythonEnhancedPath(),
    ELECTRON_RUN_AS_NODE: 1,
    // ...其他环境变量
  },
  // ...
}
```

#### 2. 简化 `buildSettingSources` 函数

**之前的实现**（复杂，需要手动启用）：
```typescript
function buildSettingSources(workDir: string): SettingSource[] {
  const config = getConfig()
  const sourcSource[] = []

  // 需要 enableUserSettings: true 才能加载用户配置
  if (config.claudeCode?.enableUserSettings) {
    sources.push('user')
  }

  if (config.claudeCode?.enableProjectSettings !== false) {
    sources.push('project')
  }
  // ...
  return sources
}
```

**现在的实现**（简洁，默认启用）：
```typescript
function buildSettingSources(workDir: string): SettingSource[] {
  const spaceConfig = getSpaceConfig(workDir)

  // 默认启用 'user' 和 'project' 两个源
  // 'user' 现在指向 ~/.halo/（通过 CLAUDE_CONFIG_DIR 环境变量）
  // 'project' 指向 {workDir}/.claude/（项目级配置）
  const sources: SettingSource[] = ['user', 'project']

  // Space 级别可以禁用 project 设置
  if (spaceConfig?.claudeCode?.enableProjectSettings === false) {
    const idx = sources.indexOf('project')
    if (idx !== -1) {
      sources.splice(idx, 1)
    }
  }

  console.log(`[Agent] Setting sources enabled: ${sources.join(', ')}`)
  return sources
}
```

#### 3. 更新注释说明

```typescript
// Configure filesystem settings loading
// With CLAUDE_CONFIG_DIR=~/.halo/, the SDK loads from:
// - 'user': ~/.halo/ (skills, commands, agents, settings)
// - 'project': {workDir}/.claude/ (project-level config)
// Both are enabled by default for full functionality
settingSources: buildSettingSources(workDir),
```

## SDK 参数说明

### `env` 参数
传递给 SDK 子进程的环境变量。关键变量：

| 变量 | 值 | 作用 |
|------|-----|------|
| `CLAUDE_CONFIG_DIR` | `~/.halo/` | **核心**：让 SDK 从 `~/.halo/` 加载配置 |
| `PATH` | 增强的 PATH | 包含嵌入式 Python 路径 |
| `ELECTRON_RUN_AS_NODE` | `1` | 让 Electron 作为 Node.js 运行 |
| `ANTHROPIC_API_KEY` | API Key | Anthropic API 密钥 |
| `ANTHROPIC_BASE_URL` | API URL | Anthropic API 地址 |

### `settingSources` 参数
控制 SDK 从哪些位置加载文件系统设置：

| 值 | 加载位置 | 说明 |
|----|----------|------|
| `'user'` | `$CLAUDE_CONFIG_DIR/` | 用户级配置（现在是 `~/.halo/`） |
| `'project'` | `{workDir}/.claude/` | 项目级配置 |
| `'local'` | `.claude/settings.local.json` | 本地设置（不提交到 git） |

### `plugins` 参数
指定插件加载路径，支持多层级：

```typescript
plugins: [
  { type: 'local', path: '/path/to/plugin1' },
  { type: 'local', path: '/path/to/plugin2' },
]
```

### `hooks` 参数
传递 hooks 配置给 SDK：

```typescript
hooks: {
  PreToolUse: [...],
  PostToolUse: [...],
  SessionStart: [...],
  SessionEnd: [...],
}
```

## 配置加载优先级

### Settings Sources（SDK 内置）
通过 `CLAUDE_CONFIG_DIR` 和 `settingSources` 控制：

1. `'user'` → `~/.halo/` (通过 CLAUDE_CONFIG_DIR)
   - `settings.json` - 用户设置
   - `skills/` - Skills
   - `commands/` - Commands
   - `agents/` - Agents

2. `'project'` → `{workDir}/.claude/`
   - 项目级 skills、commands、agents

### Plugins（Halo 扩展）
通过 `buildPluginsConfig` 函数构建，优先级从低到高：

1. **已安装插件** - `~/.halo/plugins/installed_plugins.json`
2. **系统配置** - `~/.claude/`（仅当 `enableSystemSkills: true`）
3. **全局路径** - `config.claudeCode.plugins.globalPaths`
4. **App 配置** - `~/.halo/`
5. **Space 路径** - `spaceConfig.claudeCode.plugins.paths`
6. **默认 Space** - `{workDir}/.claude/`

### Hooks（Halo 扩展）
通过 `buildHooksConfig` 函数合并：

1. `~/.halo/settings.json` 中的 hooks
2. `~/.halo/config.json` 中的 `claudeCode.hooks`
3. `{workDir}/.halo/space-config.json` 中的 `claudeCode.hooks`

### MCP Servers（Halo 扩展）
通过 `getEnabledMcpServers` 函数合并：

1. `~/.halo/config.json` 中的 `mcpServers`
2. `{workDir}/.halo/space-config.json` 中的 `claudeCode.mcpServers`

Space 配置优先级更高，可以覆盖全局配置。

## 文件变更清单

### 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/main/services/agent.service.ts` | 1. 添加 `CLAUDE_CONFIG_DIR` 到 env<br>2. 简化 `buildSettingSources`<br>3. 导出测试辅助函数 |
| `src/main/services/config.service.ts` | 更新 `ClaudeCodeConfig` 接口注释 |
| `src/main/services/space-config.service.ts` | 添加 `enableProjectSettings` 字段 |

### 新增的文件

| 文件 | 说明 |
|------|------|
| `src/main/services/hooks.service.ts` | Hooks 配置构建服务 |
| `src/main/services/plugins.service.ts` | 插件路径管理服务 |
| `src/main/services/space-config.service.ts` | Space 级别配置服务 |
| `tests/unit/services/agent.service.test.ts` | Agent 服务单元测试 |
| `tests/unit/services/plugins.service.test.ts` | 插件服务单元测试 |

## 配置文件结构

### `~/.halo/config.json`（全局配置）
```json
{
  "api": { ... },
  "mcpServers": { ... },
  "claudeCode": {
    "plugins": {
      "enabled": true,
      "globalPaths": ["/path/to/custom/plugin"],
      "loadDefaultPaths": true
    },
    "hooks": { ... },
    "agents": { ... }
  }
}
```

### `~/.halo/settings.json`（SDK 设置）
```json
{
  "env": { ... },
  "enabledPlugins": { ... },
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "SessionStart": [...],
    "SessionEnd": [...]
  }
}
```

### `{workDir}/.halo/space-config.json`（Space 配置）
```json
{
  "claudeCode": {
    "plugins": {
      "paths": ["./local-plugin"],
      "disableGlobal": false,
      "loadDefaultPath": true
    },
    "hooks": { ... },
    "mcpServers": { ... },
    "enableProjectSettings": true
  }
}
```

## 行为对比

### 之前的行为
- `settingSources: []` 实现隔离，但禁用了 commands 加载
- 需要 `enableUserSettings: true` 才能加载 `~/.claude/` 的配置
- Commands 无法从 `~/.halo/commands/` 加载

### 现在的行为
- 设置 `CLAUDE_CONFIG_DIR=~/.halo/`，SDK 自动从 `~/.halo/` 加载配置
- `settingSources: ['user', 'project']` 默认启用
- `'user'` 现在指向 `~/.halo/`（通过 `CLAUDE_CONFIG_DIR`）
- `'project'` 指向 `{workDir}/.claude/`（项目级配置）
- 完全隔离 `~/.claude/`，不读取系统 Claude Code 配置
- Commands、Skills、Agents 都能从 `~/.halo/` 正常加载

## 验证方法

### 1. 检查日志
重启 Halo 后，控制台应显示：
```
[Agent] Setting sources enabled: user, project
[Agent] Plugins loaded: /Users/xxx/.halo, /path/to/workspace/.claude
```

### 2. 测试 Commands
在 `~/.halo/commands/` 创建一个测试命令：
```
~/.halo/commands/test.md
```

内容：
```markdown
# Test Command
This is a test command from ~/.halo/
```

然后在 Halo 中输入 `/test`，应该能正常加载。

### 3. 运行单元测试
```bash
npm run test:unit -- tests/unit/services/agent.service.test.ts
```

所有 7 个测试应该通过。

## 注意事项

### `~/.halo/settings.json` 中的 Hooks
如果 `~/.halo/settings.json` 中有使用 `${CLAUDE_PLUGIN_ROOT}` 的 hooks，需要移除或修复，因为这个环境变量可能未定义。

### 已弃用的配置项
以下配置项已弃用（通过 `CLAUDE_CONFIG_DIR` 实现了隔离）：
- `config.claudeCode.enableUserSettings` - 不再需要
- `config.claudeCode.enableProjectSettings` - 全局级别不再需要，仅 Space 级别有效

## 总结

通过设置 `CLAUDE_CONFIG_DIR=~/.halo/` 环境变量，我们实现了：

1. **完全隔离** - SDK 不再读取 `~/.claude/` 的任何配置
2. **功能完整** - `~/.halo/` 的 commands、skills、agents、hooks 都能正常加载
3. **向后兼容** - 项目级 `.claude/` 配置仍然有效
4. **简洁实现** - 只需一行代码 `CLAUDE_CONFIG_DIR: getHaloDir()`
