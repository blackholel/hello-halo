# 2026-02-19 严格 only-space 资源模型 + 侧边栏 UX 重构实施总结

## 文档目的

本文档汇总本轮「strict only-space 资源隔离」与「Skills/Agents/Commands 侧边栏 UX 重构」的背景、整改点、代码落地范围和验证结果，作为后续迭代与回归基线。

---

## 一、背景与问题

本轮整改前的核心问题是：UI 看起来在收紧，但运行时仍有绕过口子，主要体现在：

1. `toolkit/null` 与 `skillsLazyLoad` 分支会造成“仅空间可用”语义漂移。
2. `Write/Edit` 虽可控，但 `Bash` 仍可能绕过资源目录保护。
3. 复制链路按 `name` 覆盖，存在同名不同来源/命名空间误伤。
4. workflow 前后端约束不一致，出现“编辑器和服务端双标”风险。
5. 侧边栏信息密度过高（来源分组、Toolkit 操作、模式切换），普通用户认知负担重。

整改目标：把“空间资源隔离”从 UI、运行时、权限、复制导入、workflow 校验全部统一到 `source === 'space'`，并保留“手动创建 + 模板导入 + Agent 建议创建（需用户确认）”的可控入口。

---

## 二、整改目标与验收口径

### 目标

1. 运行时强制 `strict-space-only`，不再依赖 `toolkit === null/non-null` 推导安全语义。
2. strict 下仅允许空间来源资源参与展开与执行。
3. 拦截资源目录写入绕过（`Write/Edit/Bash`）。
4. by-ref 复制全链路支持冲突判定与覆盖策略，避免 name 级误替换。
5. 侧边栏只展示空间资源，导入入口统一为模板库。
6. workflow 在前后端都做 `space-only` 校验。

### 验收口径

1. strict 下 `settingSources` 固定 `['local']`。
2. strict 下插件目录/外部 hooks/MCP 指令按策略收口。
3. `expandLazyDirectives` strict 场景下仅允许 `source === 'space'`。
4. `.claude/{skills,agents,commands}` 不可通过工具调用和 Bash 直接写入。
5. 单元测试与构建通过。

---

## 三、核心整改项与实现落点

## 3.1 统一策略层：`strict-space-only`

- 新增：`src/main/services/agent/space-resource-policy.service.ts`
- 修改：`src/main/services/space-config.service.ts`
- 修改：`src/main/services/space.service.ts`

实现要点：

1. 增加 `resourcePolicy` 配置并默认写入 strict 策略。
2. 读取空间时执行幂等策略补齐（兼容旧空间）。
3. `toolkit` 结构保留兼容读取，但不再作为唯一主语义。

## 3.2 SDK / MessageFlow 运行时硬门闩

- 修改：`src/main/services/agent/sdk-config.builder.ts`
- 修改：`src/main/services/agent/message-flow.service.ts`
- 修改：`src/main/services/hooks.service.ts`
- 修改：`src/main/services/agent/skill-expander.ts`

实现要点：

1. strict 下强制 lazy-load 路径与 `settingSources=['local']`。
2. strict 下插件目录收敛到空间路径，不走全局/插件扩散路径。
3. strict 下 hooks 默认禁用。
4. strict 下 `/mcp ...` 指令剥离，不动态启用插件 MCP。
5. `expandLazyDirectives` 在 strict 下传入 `allowSources:['space']`。

## 3.3 工具权限闭环（补 Bash 绕过）

- 新增：`src/main/services/agent/resource-dir-guard.service.ts`
- 修改：`src/main/services/agent/renderer-comm.ts`

实现要点：

1. `Write/Edit` 命中 `.claude/skills|agents|commands` 时拒绝。
2. `Bash` 命令字符串命中受保护目录时拒绝。
3. 拦截逻辑集中化，避免规则分散。

## 3.4 by-ref 复制与冲突策略

- 新增：`src/main/services/resource-ref.service.ts`
- 修改：`src/main/services/skills.service.ts`
- 修改：`src/main/services/agents.service.ts`
- 修改：`src/main/services/commands.service.ts`
- 修改：`src/main/ipc/skills.ts`
- 修改：`src/main/ipc/agents.ts`
- 修改：`src/main/ipc/commands.ts`
- 修改：`src/preload/index.ts`
- 修改：`src/renderer/api/index.ts`
- 修改：`src/main/http/routes/index.ts`

实现要点：

1. 新增 `ResourceRef` 与 `copy*ToSpaceByRef(...)`。
2. 返回 `copied/conflict/not_found`，支持 `overwrite`。
3. 修复同名资源复制歧义：复制场景改为“未合并源列表”查找，避免 space 同名把 app/global 源吞掉。

## 3.5 workflow 前后端统一 space-only

- 修改：`src/main/services/workflow.service.ts`
- 修改：`src/renderer/stores/workflows.store.ts`
- 修改：`src/renderer/components/workflows/WorkflowEditorModal.tsx`

实现要点：

1. 前端选择与运行前校验只允许空间资源。
2. 服务端 `create/update` 增加非空间资源拦截。
3. 去除 `isToolkitMode` 残留逻辑，统一语义。

## 3.6 侧边栏 UX 重构与模板库导入

- 修改：`src/renderer/components/skills/SkillsPanel.tsx`
- 修改：`src/renderer/components/agents/AgentsPanel.tsx`
- 修改：`src/renderer/components/commands/CommandsPanel.tsx`
- 新增：`src/renderer/components/shared/TemplateLibraryModal.tsx`
- 修改：`src/renderer/components/chat/ConversationList.tsx`

实现要点：

1. 三面板仅显示 `source === 'space'`。
2. 移除来源分组/来源 badge/Toolkit 模式切换与 Add/Remove Toolkit 操作。
3. Header 统一为 `✏️ 新建` + `➕ 模板库`。
4. 模板库展示非 space 资源，支持导入与冲突覆盖确认。

## 3.7 Suggestion 卡片泛化（支持 Agent 自动建议创建）

- 修改：`src/renderer/components/chat/MarkdownRenderer.tsx`
- 修改：`src/renderer/components/skills/SkillSuggestionCard.tsx`
- 修改：`src/renderer/components/chat/InputArea.tsx`

实现要点：

1. 支持 `skill_suggestion / agent_suggestion / command_suggestion`。
2. 兼容 `json/jsonc/fence` 多种建议格式解析。
3. 由用户在卡片上确认创建，避免静默写盘。

## 3.8 Preset 通道补齐

- 修改：`src/main/bootstrap/essential.ts`
- 修改：`src/main/http/routes/index.ts`
- 修改：`src/preload/index.ts`
- 修改：`src/renderer/api/index.ts`

实现要点：

1. 注册并暴露 `listPresets/getPreset`。
2. TemplateLibrary 可读取 preset 摘要数据。

## 3.9 i18n 补齐

- 修改：`src/renderer/i18n/locales/en.json`
- 修改：`src/renderer/i18n/locales/zh-CN.json`

新增模板库与空状态引导文案，避免直接硬编码中文 key。

---

## 四、测试与验证结果

## 4.1 新增测试

1. `src/main/services/agent/__tests__/sdk-config.builder.strict-space.test.ts`
2. `src/main/services/agent/__tests__/renderer-comm.resource-guard.test.ts`
3. `src/main/services/agent/__tests__/skill-expander.space-only.test.ts`
4. `src/main/services/__tests__/workflow.service.space-only.test.ts`
5. `src/main/services/__tests__/resource-copy-by-ref.test.ts`

并更新 `tests/vitest.config.ts` 纳入新测试入口。

## 4.2 执行结果

1. `npm run test:unit`：通过（30 files, 338 tests）。
2. `npm run build`：通过。
3. 构建存在既有的 Vite dynamic import 警告（非阻断，本轮未新增构建错误）。

---

## 五、整改效果总结

1. “only-space”从 UI 语义升级为运行时硬约束，不再是表层收口。
2. 资源目录写入绕过被补齐到 `Bash` 维度，安全边界更清晰。
3. by-ref 复制链路可稳定处理同名资源与覆盖冲突，减少误替换。
4. 侧边栏操作路径显著简化：只看空间资源，新增入口集中到“新建/导入”。
5. workflow 与对话链路都按 `space-only` 统一执行，行为一致性提升。

---

## 六、当前边界与后续建议

1. 当前是“拦截优先 + 告警友好”策略，未做粗暴目录回滚，避免误伤用户手动改动。
2. 若要进一步加强，可追加“run 内授权 token + 精确变更清单审计”，将资源目录变更追踪做成可观测事件。
3. Home/Extensions 等非聊天主路径仍保留部分 toolkit 历史能力（兼容目的），后续可评估分阶段下线。

