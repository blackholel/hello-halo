# 2026-02-13 工具状态收口与终态一致性实施总结

## 文档目的

本文档汇总本轮「工具调用状态管理 + 运行终态收口 + UI 展示一致性」的代码改动背景、实现方案与验证结果，作为后续迭代和排障基线。

---

## 一、背景与问题复盘

本轮改动前，核心痛点集中在三类：

1. **终态不唯一**  
`completed / stopped / error` 可能从不同分支各自收尾，导致 `agent:complete` 重复或乱序触发风险。

2. **前端缺少 run 启动屏障**  
前端虽然有 runId 过滤，但缺少“先建立 active run，再消费事件”的硬屏障；迟到/抢先事件容易造成串扰或误丢。

3. **工具状态与 UI 不一致**  
UI 大量依赖推断（例如“有没有 tool_result”）而非状态表，出现“工具已经结束但还在转圈”的错觉。  
另外 `AskUserQuestion` 的 denied `tool_result` 被当作失败，容易诱发重复调用和错误感知。

---

## 二、目标与验收口径

### 目标

1. 任一 run 只允许一次 terminal 收口。
2. run 事件严格隔离，杜绝跨 run 串扰。
3. 工具状态以 `toolCallId` 为主键统一管理，支持乱序到达。
4. terminal 后 UI 和持久层同步收口，不再出现幽灵 running。
5. `AskUserQuestion` 语义改为“交互成功交接”，不再被渲染为失败。

### 验收口径（本轮落地）

1. terminal 事件到达后，前端统一关闭 `isGenerating/isThinking/isStreaming`。
2. remaining running tools 收敛为 `cancelled`。
3. `runA` 迟到事件不会污染 `runB`。
4. `tool_result` 先于 `tool_call` 到达时最终状态一致。

---

## 三、核心架构决策

### 1) 后端单点 finalize（幂等）

- 在 `message-flow.service.ts` 引入单点 `finalizeSession(...)`。
- 通过 `sessionState.finalized` 做 CAS 风格幂等保护。
- 所有正常结束、停止、异常路径统一调用该函数，禁止分散发 `agent:complete`。

### 2) 显式 run 启动屏障

- 新增 `agent:run-start` 事件。
- 约束为：run 级事件应在 run-start 建立 `activeRunId` 后被消费。

### 3) tool 关联主键统一

- 统一 `toolCallId`（兼容保留 `toolId`）。
- 同 run 内 `toolCallId` 稳定；SDK 无 id 时生成 `local-{runId}-{seq}`。

### 4) 状态兼容兜底

- 前端引入 `normalizeToolStatus / normalizeLifecycle`。
- 未知状态 fallback 到 `unknown/idle` 并 `console.warn`，不抛错。

---

## 四、实现清单（按层）

## 4.1 Main（Agent 流程与持久化）

- `src/main/services/agent/message-flow.service.ts`
  - 新增 `runId`、tools snapshot、single finalize 主链。
  - stream 中 terminal 后仅 drain，不再转发 run 事件。
  - `tool_call/tool_result` 全量带 `runId + toolCallId`。
  - 完成、停止、异常都走 `finalizeSession(...)`。
  - terminal 时批量收口工具状态并落盘 `terminalReason/toolCalls/thoughts`。
  - 新增 `AskUserQuestion` 结果归一化逻辑：denied 的 `tool_result(is_error=true)` 转 success 语义。

- `src/main/services/agent/message-parser.ts`
  - 升级为 `parseSDKMessages(...)` 多 block 全量解析。

- `src/main/services/agent/renderer-comm.ts`
  - `AskUserQuestion` deny message 不再携带 `User answered: ...`，避免错误语义通道承载业务答案。
  - 交互型工具事件补齐 `runId/toolCallId`。

- `src/main/services/agent/types.ts`
  - 扩展会话运行字段：`runId/lifecycle/terminalReason/finalized/toolsById/...`。
  - `ToolCallStatus` 增加 `cancelled`。

- `src/main/services/conversation.service.ts`
  - 消息持久化新增 `terminalReason`。
  - 工具状态枚举支持 `cancelled`。

## 4.2 Preload / API / App 事件接线

- `src/preload/index.ts`
- `src/renderer/api/transport.ts`
- `src/renderer/api/index.ts`
  - 新增事件通道：
    - `agent:run-start`
    - `agent:tools-available`

- `src/renderer/App.tsx`
  - 注册并消费上述新事件。
  - `tool-result` 兼容 `toolCallId/toolId` 双字段。

## 4.3 Renderer 状态层（核心）

- `src/renderer/stores/chat.store.ts`
  - 新增会话字段：
    - `activeRunId/lifecycle/terminalReason`
    - `toolStatusById/toolCallsById/orphanToolResults`
    - `availableToolsSnapshot/pendingRunEvents`
  - 新增 `handleAgentRunStart` 作为运行屏障。
  - 非 start 事件：
    - run 不匹配直接丢弃；
    - 无 active run 时短缓冲（TTL 2s）并超时告警。
  - `tool_result` 乱序容错（orphan 缓存 + 回填）。
  - terminal 后统一关闭生成态并取消剩余运行工具。
  - stop/error/complete 与 task 终态联动。

## 4.4 任务与 UI 展示收口

- `src/renderer/stores/task.store.ts`
  - 新增 `finalizeTasksOnTerminal(reason)`。
  - `stopped/error/no_text` 时 `in_progress -> paused`。
  - 增加未知状态兜底归一化。

- `src/renderer/components/task/TaskPanel.tsx`
- `src/renderer/components/task/TaskItem.tsx`
- `src/renderer/components/tool/TodoCard.tsx`
  - 增加 `paused` 视觉态，避免 terminal 后继续 spinner。

- `src/renderer/components/chat/MessageList.tsx`
- `src/renderer/components/chat/ThoughtProcess.tsx`
- `src/renderer/components/chat/SubAgentCard.tsx`
- `src/renderer/components/tool/ToolCard.tsx`
  - 改为优先读 `toolStatusById` 渲染状态。
  - 增加 `cancelled/unknown` 兜底显示。
  - 新增 run 摘要（可用工具数、调用总数、状态计数）。

- `src/renderer/components/chat/ChatView.tsx`
- `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
  - 透传 `toolStatusById` 与 `availableToolsSnapshot`，统一展示来源。

---

## 五、AskUserQuestion 专项修复

## 5.1 问题根因

`AskUserQuestion` 由 Halo UI 处理，但 SDK 侧表现为 `deny`，会产出 `tool_result(is_error=true)`。  
若不归一化，前端会把它显示成失败，模型也容易将其理解为“工具失败后应重试”。

## 5.2 修复策略

1. **语义去歧义**  
deny message 改为系统说明，不再带用户答案。

2. **状态归一化**  
识别到 `AskUserQuestion` 的 denied result 后，将 `isError/status/content` 归一到 success 语义。

3. **专项测试兜底**  
新增专测，防止未来回归。

---

## 六、测试与验证

### 新增/更新测试

- `src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts`
  - 乱序 tool 事件一致性
  - 多 run 串扰屏蔽
  - terminal 收口
  - stop 后迟到 thought 不反点燃
  - no_text 终态收口

- `src/main/services/agent/__tests__/ask-user-question-flow.test.ts`
  - 同步扩展后的 `SessionState` 字段

- `src/main/services/agent/__tests__/message-flow.ask-user-question-status.test.ts`（新增）
  - AskUserQuestion denied result 归一化为 success
  - 非 AskUserQuestion 错误结果不被污染
  - 已成功结果保持不变

- `tests/vitest.config.ts`
  - 将新增专测加入 include 白名单

### 实际执行

已执行并通过：

```bash
npm run test:unit -- src/main/services/agent/__tests__/message-flow.ask-user-question-status.test.ts src/main/services/agent/__tests__/ask-user-question-flow.test.ts src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts
```

结果：`3 files passed, 15 tests passed`。

---

## 七、已知边界

1. 当前是“run 内一致性”优先，历史消息不做离线迁移，仅在线兼容归一化。
2. 仓库仍存在与本次改动无关的全局 TypeScript 既有错误；本轮以受影响模块与专项测试通过为准。
3. `AskUserQuestion` 的“是否应再次询问”仍由模型策略决定；本轮解决的是错误状态误导与重复重试放大问题。

---

## 八、结论

本轮已把「终态唯一出口 + run 屏障 + 工具状态真值化 + UI 收口」完整打通，并对 `AskUserQuestion` 的失败误判问题做了语义修正与专项测试兜底。  
用户侧可见收益是：终态更稳定、转圈不反弹、工具状态可解释、交互型工具不再普遍显示失败。

