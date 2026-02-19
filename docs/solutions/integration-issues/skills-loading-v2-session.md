---
title: Hello-Kite Skills 加载功能实现
category: integration-issues
tags: [skills, plugins, sdk, v2-session, claude-agent-sdk]
created: 2026-01-17
severity: high
component: agent-service
root_cause: SDK V2 Session 未传递 plugins 参数
status: resolved
---

# Hello-Kite Skills 加载功能实现

## 问题概述

用户希望在 Hello-Kite 应用中实现自定义 Skills 功能，支持两层技能配置：
- **应用级 Skills**：位于 `~/.kite/skills/`，所有 Space 共享
- **Space 级 Skills**：位于 `{workDir}/.claude/skills/`，项目特定

配置完成后，Skills 无法被识别和加载。

## 症状

```
[Agent] Final plugins config: [{"type":"local","path":"/Users/dl/.kite/skills"}]
[Agent][xxx] Loaded skills: []
[Agent][xxx] Loaded plugins: []
```

plugins 配置正确传递，但 SDK 返回的 skills 和 plugins 都是空数组。

## 根因分析

### 深入 SDK 源码分析

通过分析 `@anthropic-ai/claude-agent-sdk` 0.2.7 源码发现：

1. **SDK 的 `Query` 类正确处理 plugins 参数**：
   ```javascript
   // sdk.mjs 第 7739-7746 行
   if (plugins && plugins.length > 0) {
     for (const plugin of plugins) {
       if (plugin.type === "local") {
         args.push("--plugin-dir", plugin.path);
       }
     }
   }
   ```

2. **但 `SessionImpl` 类（V2 Session）没有传递 plugins 参数**：
   ```javascript
   // sdk.mjs 第 8595-8624 行
   const transport = new ProcessTransport({
     // ... 很多选项 ...
     settingSources: options.settingSources ?? [],
     allowedTools: options.allowedTools ?? [],
     // ❌ 缺少 plugins 参数！
   });
   ```

3. **CLI 的 skills 加载流程**：
   - `ao2()` 函数处理插件目录，检测 `skills/` 子目录
   - `So2()` 函数遍历子目录加载 `SKILL.md` 文件
   - `tw0()` 函数（getPluginSkills）从 enabled plugins 加载 skills

## 解决方案

### 1. SDK Patch 修复

在 `SessionImpl` 构造函数中添加 `plugins` 参数传递：

**文件**: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`

**位置**: 第 8618-8626 行

```javascript
// 修改前
const transport = new ProcessTransport({
  // ...
  forkSession: options.forkSession ?? false,
  resumeSessionAt: options.resumeSessionAt ?? undefined
});

// 修改后
const transport = new ProcessTransport({
  // ...
  forkSession: options.forkSession ?? false,
  resumeSessionAt: options.resumeSessionAt ?? undefined,
  // [PATCHED] Add plugins support for V2 sessions
  plugins: options.plugins ?? []
});
```

### 2. 应用层配置

**文件**: `src/main/services/agent.service.ts`

添加 `buildPluginsConfig()` 函数（第 634-659 行）：

```typescript
// Build plugins configuration for skills loading
// Supports two-tier skills: app-level (shared) and space-level (project-specific)
function buildPluginsConfig(workDir: string): Array<{ type: 'local'; path: string }> {
  const plugins: Array<{ type: 'local'; path: string }> = []

  // 1. App-level skills (default, lower priority)
  // Located at ~/.kite/skills/, shared across all spaces
  const appSkillsPath = join(getKiteDir(), 'skills')
  console.log(`[Agent] Checking app-level skills path: ${appSkillsPath}, exists: ${existsSync(appSkillsPath)}`)
  if (existsSync(appSkillsPath)) {
    plugins.push({ type: 'local', path: appSkillsPath })
    console.log(`[Agent] Added app-level skills: ${appSkillsPath}`)
  }

  // 2. Space-level skills (higher priority, can override app-level)
  // Located at {workDir}/.claude/, project-specific
  const spaceSkillsPath = join(workDir, '.claude')
  console.log(`[Agent] Checking space-level skills path: ${spaceSkillsPath}, exists: ${existsSync(spaceSkillsPath)}`)
  if (existsSync(spaceSkillsPath)) {
    plugins.push({ type: 'local', path: spaceSkillsPath })
    console.log(`[Agent] Added space-level skills: ${spaceSkillsPath}`)
  }

  console.log(`[Agent] Final plugins config:`, JSON.stringify(plugins))
  return plugins
}
```

在 `sdkOptions` 中使用（第 522 行和第 1137 行）：

```typescript
const sdkOptions = {
  // ...
  settingSources: [],  // 禁用文件系统 settings 加载
  plugins: buildPluginsConfig(workDir),  // 分层加载 skills
  // ...
}
```

### 3. Skills 目录结构

```
~/.kite/skills/
├── .claude-plugin/
│   └── plugin.json       # 插件清单
└── skills/               # Skills 目录
    ├── doc-learner/
    │   └── SKILL.md
    ├── excalidraw-diagram/
    │   └── SKILL.md
    └── ...
```

**plugin.json 格式**：

```json
{
  "name": "kite-skills",
  "version": "1.0.0",
  "description": "Kite 应用自定义技能集",
  "author": {
    "name": "User"
  }
}
```

**SKILL.md 格式**：

```markdown
---
name: skill-name
description: 技能描述，包含触发词
---

# 技能标题

## 工作流程
...
```

## 代码变更总结

### SDK 层（底层）

| 文件 | 变更 |
|------|------|
| `patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch` | 添加 `plugins` 参数传递到 `ProcessTransport` |

**关键修改**：
- `SessionImpl` 构造函数中添加 `plugins: options.plugins ?? []`
- 使 V2 Session 能够将 plugins 配置传递给 CLI

### 应用层（工程）

| 文件 | 变更 |
|------|------|
| `src/main/services/agent.service.ts` | 添加 `buildPluginsConfig()` 函数，在 `sdkOptions` 中配置 plugins |
| `~/.kite/skills/.claude-plugin/plugin.json` | 创建插件清单，添加 version 字段 |
| `~/.kite/skills/skills/*/SKILL.md` | 创建技能定义文件 |

**关键修改**：
- 新增 `buildPluginsConfig()` 函数（第 634-659 行）
- 在 `ensureSessionWarm()` 和 `sendMessage()` 中使用 plugins 配置
- 添加 skills/plugins 加载日志（第 1426-1434 行）

## 验证方法

1. **启动应用**，观察控制台日志：
   ```
   [Agent] Checking app-level skills path: /Users/dl/.kite/skills, exists: true
   [Agent] Added app-level skills: /Users/dl/.kite/skills
   [Agent] Final plugins config: [{"type":"local","path":"/Users/dl/.kite/skills"}]
   ```

2. **发送消息**，确认 skills 加载：
   ```
   [Agent][xxx] Loaded skills: ["kite-skills:doc-learner", "kite-skills:excalidraw-diagram", ...]
   [Agent][xxx] Loaded plugins: [{"name":"kite-skills","path":"/Users/dl/.kite/skills"}]
   ```

3. **验证插件**：
   ```bash
   npx @anthropic-ai/claude-code plugin validate ~/.kite/skills
   # ✔ Validation passed
   ```

## 配置层级

| 层级 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| 应用级 | `~/.kite/skills/` | 所有 Space 共享的默认技能 | 低 |
| Space 级 | `{workDir}/.claude/skills/` | 项目特定的技能 | 高（可覆盖应用级） |

## 注意事项

1. **settingSources: []** 会禁用 CLAUDE.md 文件的加载，如需支持改为 `['project']`

2. **plugins 加载顺序**：数组中后面的 plugin 优先级更高，可覆盖前面的同名 skill

3. **目录不存在时**：使用 `existsSync` 过滤，避免传入不存在的路径导致错误

4. **V2 Session 缓存**：修改配置后需要关闭旧 session 或创建新对话才能生效

## 相关文件

- `src/main/services/agent.service.ts` - SDK 配置和 skills 加载
- `src/main/services/config.service.ts` - `getKiteDir()` 函数
- `patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch` - SDK 补丁
- `node_modules/@anthropic-ai/claude-code/cli.js` - CLI skills 加载逻辑

## 参考

- Claude Code Plugin 规范
- `@anthropic-ai/claude-agent-sdk` 0.2.7 源码
- `@anthropic-ai/claude-code` CLI 源码
