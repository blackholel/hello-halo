# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Kite 是 Claude Code 的桌面 GUI 客户端，基于 Electron + React + TypeScript 构建。它封装了 Claude Agent SDK，提供可视化界面，无需使用终端即可进行 AI 辅助编程。

## 开发命令

```bash
# 开发
npm run dev              # 启动开发服务器（支持热重载）

# 构建
npm run build            # 生产环境构建
npm run build:mac        # 构建 macOS 应用（包含 Python 环境准备）
npm run build:win-x64    # 构建 Windows x64 应用
npm run build:linux      # 构建 Linux AppImage

# 测试
npm run test             # 运行所有测试（check + unit）
npm run test:unit        # 仅运行单元测试
npm run test:unit:watch  # 监听模式运行单元测试
npm run test:e2e         # 运行 Playwright E2E 测试
npm run test:e2e:smoke   # 仅运行冒烟测试

# 国际化
npm run i18n:extract     # 提取翻译键
npm run i18n:translate   # 自动翻译缺失的键
```

## 架构

### 进程模型 (Electron)

```
┌─────────────────────────────────────────────────────────────┐
│                    渲染进程 (React)                          │
│  Zustand Stores ◄── api layer ◄── window.kite (preload)     │
└─────────────────────────────────────────────────────────────┘
                          │ IPC
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    主进程 (Electron)                         │
│  IPC Handlers ──► Services ──► Claude Agent SDK (V2 Session)│
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

- `src/main/` - 主进程
  - `services/` - 核心业务逻辑（agent, config, space, conversation, memory, hooks）
  - `ipc/` - 与渲染进程通信的 IPC 处理器
  - `http/` - 用于远程访问的 HTTP/WebSocket 服务
  - `bootstrap/` - 分阶段应用初始化
- `src/renderer/` - 渲染进程 (React)
  - `stores/` - Zustand 状态管理（app, chat, space, canvas）
  - `api/` - 统一 API 层（自动选择 IPC 或 HTTP 传输）
  - `components/` - React 组件
  - `pages/` - 页面组件
- `src/preload/` - 预加载脚本，暴露 `window.kite` API

### 核心服务

| 服务 | 文件 | 职责 |
|------|------|------|
| AgentService | `src/main/services/agent.service.ts` | Claude Agent SDK 集成、V2 Session 管理、消息流处理 |
| ConfigService | `src/main/services/config.service.ts` | 配置管理（~/.kite/config.json） |
| SpaceService | `src/main/services/space.service.ts` | 工作空间管理 |
| ConversationService | `src/main/services/conversation.service.ts` | 对话持久化 |
| MemoryService | `src/main/services/memory.service.ts` | 加载 CLAUDE.md 作为上下文 |
| HooksService | `src/main/services/hooks.service.ts` | Claude Code hooks 集成 |

### 状态管理

使用 Zustand 进行状态管理，职责分离：
- `chat.store.ts` - 对话状态、消息流、Session 管理
- `app.store.ts` - 全局应用状态（视图、配置、MCP 状态）
- `space.store.ts` - 工作空间状态
- `canvas.store.ts` - 内容画布（文件预览、浏览器标签页）

### IPC 通信

通道遵循命名空间模式：`config:*`、`space:*`、`conversation:*`、`agent:*`、`browser:*`

预加载脚本（`src/preload/index.ts`）定义了 `KiteAPI` 接口，向渲染进程暴露所有主进程功能。

### Agent SDK 集成

Kite 使用 `@anthropic-ai/claude-agent-sdk` npm 包，该 SDK 内置了 Claude Code 核心逻辑。子进程通过 Electron 自身（设置 `ELECTRON_RUN_AS_NODE=1`）运行，**不依赖系统安装的 `claude` CLI**。用户只需提供 API Key 即可使用。

Agent 服务使用 V2 Session 实现子进程的高效复用：
- 跨消息复用 Session，避免冷启动（约 3-5 秒）
- 切换对话时后台预热 Session
- 通过 patch-package 扩展 SDK 功能（token 级流式输出、中断支持）

### 配置隔离机制

Kite **默认不读取系统 Claude Code 配置**（`~/.claude/`），所有配置来自 Kite 自己的配置体系：

| 配置类型 | 来源 | 说明 |
|----------|------|------|
| Plugins | 可配置路径 | 默认加载 `~/.kite/plugins/`、`~/.kite/skills/` 和 `{workDir}/.claude/` |
| MCP Servers | Kite 全局配置 + Space 配置 | 不读取系统 MCP 配置 |
| Agents | `config.claudeCode.agents` + `spaceConfig.agents` | Kite 独立配置 |
| Hooks | `config.claudeCode.hooks` + `spaceConfig.hooks` | Kite 独立配置 |
| Memory | `~/.kite/` + `{workDir}/CLAUDE.md` | Kite 独立管理 |

**兼容性选项**（默认关闭）：
- `enableUserSettings` - 启用后读取 `~/.claude/` 用户配置
- `enableProjectSettings` - 启用后读取项目级 `.claude/` 配置
- `enableSystemSkills` - 启用后加载 `~/.claude/skills/`

配置优先级：Space 配置 > Kite 全局配置 > 系统配置（如已启用）

### Plugins 配置

Plugins 是 SDK 的扩展加载机制，一个 plugin 目录可以包含 skills、commands、agents、hooks。

**全局配置** (`~/.kite/config.json`)：
```json
{
  "claudeCode": {
    "plugins": {
      "enabled": true,
      "globalPaths": ["/path/to/custom/plugin"],
      "loadDefaultPaths": true
    }
  }
}
```

**Space 配置** (`{workDir}/.kite/space-config.json`)：
```json
{
  "claudeCode": {
    "plugins": {
      "paths": ["./local-plugin"],
      "disableGlobal": false,
      "loadDefaultPath": true
    }
  }
}
```

**加载优先级**（低到高）：
1. `~/.claude/skills/` - 仅当 `enableSystemSkills: true`
2. `globalPaths` - 用户配置的全局路径
3. `~/.kite/plugins/` - 默认 app 级别路径
4. `~/.kite/skills/` - 默认 app 级别路径（与 plugins 同时加载）
5. Space `paths` - Space 自定义路径
6. `{workDir}/.claude/` - 默认 space 级别路径（Claude Code 兼容）

### 远程访问

HTTP 服务器 + WebSocket 支持从任意浏览器/设备控制 Kite。渲染进程的 api 层自动检测传输模式（桌面端使用 IPC，远程使用 HTTP）。

## 技术栈

- 框架：Electron + electron-vite
- 前端：React 18 + TypeScript
- 样式：Tailwind CSS
- 状态管理：Zustand
- Agent 核心：@anthropic-ai/claude-agent-sdk
- 测试：Vitest（单元测试）、Playwright（E2E 测试）
