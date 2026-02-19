# 聊天流重构 v3 实施总结（含 remote / complete / recovery / visibility）

## 1. 文档信息
- 文档日期：2026-02-16
- 分支：`codex/chat-flow-rework-v3`
- 对应提交：`8329aa7`（`feat: 优化消息流与思考过程显示逻辑`）
- 目标版本：聊天流重构最终实施方案 v3

## 2. 背景与问题
在原有聊天流程里，存在以下用户体验与工程一致性问题：

1. 主消息气泡与过程信息耦合，导致“最终答案 + 全量过程”混在同一层展示，重复且噪声大。
2. 事件协议存在新旧并行阶段，但 remote mode 与 Electron mode 的分发链路不完全一致，存在断流风险。
3. `agent:complete` 缺少正文兜底字段，若会话 reload 失败，前端可能拿不到最终内容。
4. session 恢复长期依赖 `thoughts`，若直接切到 `processTrace` 会破坏旧链路。
5. hook/system 原始事件未分级过滤，过程面板可读性差。
6. AskUserQuestion / 工具审批状态机高度依赖 tool_call/tool_result 语义，改造时需要等价承接。

## 3. 时间线（本次实施）

1. 2026-02-15 ~ 2026-02-16（方案评审阶段）
   - 汇总并确认 P0/P1/P2 风险：事件链、complete 兜底、恢复兼容、visibility 过滤、UI 去重、测试迁移等。
2. 2026-02-16（开发与联调阶段）
   - 按 v3 清单完成主进程、preload、transport、renderer、store、UI、测试改造。
3. 2026-02-16 21:20:32 CST（提交落地）
   - 形成提交 `8329aa7`，共 25 个文件，`1225` 行新增、`771` 行删除。

## 4. 功能目标与最终结果

### 4.1 目标
1. 主气泡只呈现最终答案。
2. 过程信息统一进入 Process 面板，减少重复入口。
3. 协议升级到 `agent:process`，同时保留旧事件一版兼容。
4. stop/error/complete 全链路不丢最后文本。
5. remote/Electron 两种模式均可消费新事件。

### 4.2 结果
上述目标均已在代码层落地，并通过对应单元测试验证（见第 8 节）。

## 5. 核心改造总览

### 5.1 事件协议与终态兜底
- 新增统一过程事件：`agent:process`。
- `agent:complete` 扩展字段：`finalContent?: string`。
- 新增终态正文决策：`resolveFinalContent`。

正文优先级为：
1. `result.content`
2. `sessionState.latestAssistantContent`
3. `accumulatedTextContent + currentStreamingText`
4. `undefined`

### 5.2 主进程（message-flow）
- 新增 `emitProcessEvent`，将 thought/tool 过程同步写入 `processTrace` 并向前端发 `agent:process`。
- 保留旧事件 `agent:thought` / `agent:tool-call` / `agent:tool-result`，兼容过渡。
- `finalizeSession` 写入 `processTrace` / `processSummary`，并在 complete 事件携带 `finalContent`。

### 5.3 remote + Electron 分发链
完整链路已补齐：
`main -> preload -> transport.ts -> renderer api -> App -> chat.store`

并确认 remote mode 路径包含：
`transport.ts` 与 `renderer/api/index.ts` 对 `agent:process` 的订阅映射。

### 5.4 Store 与状态机
- `PendingRunEventKind` 增加 `process`，支持 run-start 前缓存与 replay。
- 新增 `handleAgentProcess`，并把 tool_call/tool_result/thought 转入统一处理链。
- AskUserQuestion、工具审批、`toolStatusById` 仍由原语义驱动，保证行为等价。
- complete 后若 reload 会话失败，使用 `finalContent` 回填最后 assistant 内容。

### 5.5 Session 恢复兼容
- `getSessionState` 现并行返回：`thoughts + processTrace`。
- 渲染恢复策略：优先 `processTrace`，缺失时回退 `thoughts`，避免旧消费方断链。

### 5.6 visibility 过滤落地
- parser 侧：hook/system 噪声标记 `debug`，对用户有意义摘要标记 `user`。
- UI 侧：默认隐藏 `visibility='debug'`。
- 同时过滤 `TodoWrite/Task` 在 ThoughtProcess 的重复入口。

### 5.7 UI 去重
- 删除 `MessageItem` 内部基于 `message.thoughts` 的重复渲染入口。
- `MessageList` 统一从 `processTrace`（缺失则回退 thoughts）提取过程数据。
- 当前结构为：主消息（final bubble）+ 统一过程区域（含实时/完成态）。

### 5.8 存储路径一致性
- 保持现有约定：
  - 非 temp space：`.kite/conversations`
  - temp space：`conversations`
- 未引入 `.halo/conversations` 新依赖。

## 6. 关键文件变更清单

### 6.1 主进程与类型
- `src/main/services/agent/message-flow.service.ts`
- `src/main/services/agent/message-parser.ts`
- `src/main/services/agent/session.manager.ts`
- `src/main/services/agent/types.ts`
- `src/main/services/conversation.service.ts`

### 6.2 通信与分发
- `src/preload/index.ts`
- `src/renderer/api/transport.ts`
- `src/renderer/api/index.ts`
- `src/renderer/App.tsx`

### 6.3 渲染层与状态管理
- `src/renderer/stores/chat.store.ts`
- `src/renderer/types/index.ts`
- `src/renderer/components/chat/MessageList.tsx`
- `src/renderer/components/chat/MessageItem.tsx`
- `src/renderer/components/chat/ThoughtProcess.tsx`
- `src/renderer/components/chat/ChatView.tsx`
- `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`

### 6.4 测试与配置
- `tests/vitest.config.ts`
- `tests/unit/components/MessageList.layout.test.ts`
- `src/main/services/agent/__tests__/message-flow.final-content.test.ts`
- `src/main/services/agent/__tests__/message-parser.visibility.test.ts`
- `src/renderer/api/__tests__/transport.process.test.ts`
- `src/renderer/api/__tests__/api.process.test.ts`
- `src/renderer/components/chat/__tests__/message-list.thought-priority.test.ts`
- `src/renderer/components/chat/__tests__/thought-process.visibility.test.ts`
- `src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts`

## 7. 兼容策略与失败兜底

1. 兼容期并行事件：
   - 新事件 `agent:process` + 旧事件并存，避免直接切换导致中断。
2. complete 兜底：
   - 当 conversation reload 失败时，用 `finalContent` 补齐最后 assistant 文本并清理流状态。
3. 恢复兜底：
   - `processTrace` 缺失时回退 `thoughts`，保证旧视图/旧逻辑可继续工作。

## 8. 验证结果

### 8.1 定向回归（通过）
执行时间：2026-02-16

命令：
```bash
npm run test:unit -- \
  ../src/main/services/agent/__tests__/message-flow.final-content.test.ts \
  ../src/main/services/agent/__tests__/message-parser.visibility.test.ts \
  ../src/renderer/api/__tests__/transport.process.test.ts \
  ../src/renderer/api/__tests__/api.process.test.ts \
  ../src/renderer/components/chat/__tests__/thought-process.visibility.test.ts \
  ../src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts \
  unit/components/MessageList.layout.test.ts \
  unit/stores/chat.store.isolation.test.ts \
  unit/services/message-flow.stop.test.ts
```

结果：`9` 个测试文件全部通过，`37` 个用例通过。

### 8.2 全量 unit（当前仓库状态）
命令：
```bash
npm run test:unit
```

结果：失败（非本次改造单点引入，属于仓库现存失败集）
- Test Files: `6 failed | 37 passed (43)`
- Tests: `19 failed | 376 passed (395)`

主要失败集中在：
1. checkpoint/snapshot 相关 suite 缺失依赖文件：
   - `unit/services/checkpoint.service.test.ts`
   - `unit/services/checkpoint.test.ts`
   - `unit/services/snapshot-conflict.test.ts`
   - `unit/stores/checkpoint.store.test.ts`
2. `unit/services/commands.service.test.ts`（权限/初始化相关）
3. `unit/services/skills.service.test.ts`（导出函数不匹配）

## 9. 结论
本次聊天流重构 v3 已实现预期目标：
1. 主气泡与过程信息分离，重复展示明显减少。
2. `agent:process` 在 Electron 与 remote 模式均可分发。
3. complete/reload 失败场景具备正文兜底能力。
4. session 恢复保持新旧并行兼容。
5. debug 过程默认隐藏，过程面板噪声明显下降。

