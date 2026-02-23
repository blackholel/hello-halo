# 2026-02-23 会话级多模型供应商改造与 Anthropic 兼容扩展总结

## 1. 背景与问题

项目原先虽然具备多供应商底座，但核心仍是全局单一 `config.api`，导致：

1. 同时开多个会话时无法做到“会话 A 用 GLM、会话 B 用 MiniMax/Kimi”。
2. GLM/MiniMax/Kimi 这类 Anthropic 兼容厂商在部分链路上会被错误映射或参数丢失，出现“在本应用不可用，但在 Claude Code 可用”的问题。
3. 厂商品牌与协议耦合过重，扩展新厂商成本高。

本次改造目标是：在会话级多模型方案基础上，补齐 GLM/MiniMax/Kimi 的 Anthropic 协议兼容能力，并保证全链路可用。

---

## 2. 实施目标（本次覆盖）

1. 支持 `config.ai`（profile 列表）+ `conversation.ai`（会话绑定）模式。
2. 会话发送链路按 `profileId + modelOverride` 路由，不再只看全局 `config.api`。
3. 增加 Kimi/Moonshot 与 MiniMax 官方模板，统一按 Anthropic 兼容协议接入。
4. 修复 Anthropic 兼容链路中的关键环境变量注入策略，确保 GLM/MiniMax/Kimi 可稳定工作。
5. 保持 OpenAI 兼容链路不回归。

---

## 3. 多代理执行方式

本次采用主控 + 多实现代理并行推进：

1. 代理 1：类型扩展与 UI 模板（Settings / ApiSetup）。
2. 代理 2：后端 provider 解析、SDK/MCP 环境注入策略统一。
3. 代理 3：回归测试补齐（resolver / sdk env / ai-config-resolver）。
4. 主控代理：集成、二次修正、统一验证、文档交付。

---

## 4. 关键设计与实现

## 4.1 类型与配置模型升级

### 实现内容

1. 引入 `ApiProfile`、`ConversationAiConfig`、`AiConfig`，并支持 `config.ai.profiles + defaultProfileId`。
2. 保留 `config.api` 作为兼容镜像，避免旧路径直接崩。
3. `ProviderVendor` 扩展 `moonshot`，用于 Kimi/Moonshot 厂商标识。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/shared/types/ai-profile.ts`
2. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/config.service.ts`
3. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/types/index.ts`

---

## 4.2 会话级 AI 绑定与解析

### 实现内容

1. `Conversation`/`ConversationMeta` 增加 `ai?: { profileId, modelOverride }`。
2. 新建会话时写入默认 `profileId`。
3. 有效模型优先级固定为：
   `request.modelOverride > conversation.ai.modelOverride > profile.defaultModel`。
4. 若会话绑定的 profile 丢失，自动回退到 `defaultProfileId`。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/conversation.service.ts`
2. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/ai-config-resolver.ts`
3. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/message-flow.service.ts`
4. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/session.manager.ts`

---

## 4.3 Provider 解析与协议解耦

### 实现内容

1. `resolveProvider` 输入从旧 `ApiConfig` 扩展为 `ApiProfile + modelOverride`（兼容旧入参）。
2. 协议分支明确化：
   - `anthropic_official`：直连官方；
   - `anthropic_compat`：第三方兼容直连；
   - `openai_compat`：走本地 `openai-compat-router`。
3. 默认策略改为：Anthropic 兼容厂商直传真实模型名（不强制 fake `claude-*`）。
4. 仅在 `KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING=1` 时启用旧映射模式。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/provider-resolver.ts`

---

## 4.4 Anthropic 兼容环境变量策略统一（本轮核心修复）

### 修复背景

此前兼容环境变量注入与“强制模型映射开关”耦合，导致不开映射时，部分厂商缺少必要 env，表现为可连接但行为不稳定/不可用。

### 实现内容

1. 统一兼容判定函数：`shouldEnableAnthropicCompatEnvDefaults(...)`。
2. 统一兼容 env 构造：`buildAnthropicCompatEnvDefaults(effectiveModel)`。
3. 对 `anthropic_compat` 且 vendor 属于以下集合默认注入兼容 env：
   - `minimax`、`moonshot`、`zhipu`、`topic`、`custom`（排除 `anthropic` 官方）。
4. 注入字段：
   - `API_TIMEOUT_MS`（默认 `3000000`）
   - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
   - `ANTHROPIC_MODEL=<effectiveModel>`
   - `ANTHROPIC_DEFAULT_OPUS_MODEL=<effectiveModel>`
   - `ANTHROPIC_DEFAULT_SONNET_MODEL=<effectiveModel>`
   - `ANTHROPIC_DEFAULT_HAIKU_MODEL=<effectiveModel>`
5. `sdk-config.builder` 与 `mcp-status.service` 统一使用这套逻辑，避免分叉。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/provider-resolver.ts`
2. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/sdk-config.builder.ts`
3. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agent/mcp-status.service.ts`

---

## 4.5 IPC / HTTP / Preload / 前端 API 透传

### 实现内容

1. `AgentRequest` 增加 `modelOverride`，并兼容旧字段 `model -> modelOverride`。
2. `validateApi` 协议参数支持透传，避免校验阶段丢协议信息。
3. `updateConversation` 支持提交 `ai` 变更。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/preload/index.ts`
2. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/ipc/agent.ts`
3. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/controllers/agent.controller.ts`
4. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/http/routes/index.ts`
5. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/api/index.ts`

---

## 4.6 前端交互改造

### 实现内容

1. 设置页升级为 Profile 列表 + 编辑器模式，支持多供应商并存。
2. 首次引导页与设置页统一模板体系。
3. 新增 `ModelSwitcher`（输入区会话级模型切换），生成中禁切换。
4. 会话列表/历史面板显示模型 badge 与 profile 信息。

### 关键文件

1. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/pages/SettingsPage.tsx`
2. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/setup/ApiSetup.tsx`
3. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/chat/ModelSwitcher.tsx`
4. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/chat/InputArea.tsx`
5. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/chat/ConversationList.tsx`
6. `/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/chat/ChatHistoryPanel.tsx`

---

## 5. 厂商模板与默认配置（本次结果）

1. **GLM**
   - `vendor=zhipu`
   - `protocol=anthropic_compat`
   - `apiUrl=https://open.bigmodel.cn/api/anthropic`
2. **MiniMax**
   - `vendor=minimax`
   - `protocol=anthropic_compat`
   - `apiUrl=https://api.minimaxi.com/anthropic`
   - 默认模型：`MiniMax-M2.5`
3. **Kimi / Moonshot**
   - `vendor=moonshot`
   - `protocol=anthropic_compat`
   - `apiUrl=https://api.moonshot.cn/anthropic`
   - 默认模型：`kimi-k2-thinking`
   - 预置目录：`kimi-k2-thinking`、`kimi-k2-thinking-turbo`、`kimi-k2-0905-preview`、`kimi-k2-turbo-preview`

---

## 6. 官方文档对齐

本次模板与兼容 env 策略对齐了以下资料：

1. GLM Claude 兼容说明：`https://docs.bigmodel.cn/cn/guide/develop/claude/introduction`
2. MiniMax Claude Code：`https://platform.minimaxi.com/docs/coding-plan/claude-code`
3. Moonshot/Kimi Agent 支持：`https://platform.moonshot.cn/docs/guide/agent-support`

---

## 7. 测试与验证结果

### 已通过

1. 定向测试：
   - `provider-resolver` / `sdk-config.builder.strict-space` / `ai-config-resolver`
   - 结果：`18 passed`
2. TypeScript 编译检查：
   - `npx tsc --noEmit --pretty false`
3. 构建：
   - `npm run build`

### 当前环境中未通过（已确认非本次改动独占）

1. `npm run test:unit`
   - 存在仓库基线失败（如 checkpoint/snapshot/skills/commands 相关测试）。
2. `npm run test:e2e:smoke`
   - Electron 启动阶段 `kill EPERM`，导致 smoke 全挂。
3. `npm run test`
   - `test:check` 缺少 `cloudflared` 二进制依赖。

---

## 8. 最终实现功能（用户可见）

1. 每个会话可独立选择 Profile + Model，不再被全局单一模型绑死。
2. 多会话并发时可用不同供应商模型并行执行。
3. GLM / MiniMax / Kimi 可通过 Anthropic 兼容协议在本应用内正常使用主链路能力。
4. 生成中禁止切换模型，降低上下文混模风险。
5. 配置保持兼容旧版 `config.api`，升级后无需强制重配。

---

## 9. 开关与回滚位

1. 兼容映射开关（默认关闭）：
   - `KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING=1`
2. 默认行为：
   - 第三方 Anthropic 兼容厂商走真实模型名直传 + 兼容 env 注入。

---

## 10. 后续建议

1. 在可运行 Electron E2E 的环境补一次端到端验收（尤其是会话切换与生成中禁切换）。
2. 清理当前仓库基线失败用例后再跑全量 `npm run test`，把本次能力纳入稳定回归集。
3. 如需更强隔离，可在下一期加“按空间（space）限制 profile 可见范围”的 allowlist 机制。

