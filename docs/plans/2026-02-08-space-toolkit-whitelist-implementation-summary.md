# 2026-02-08 空间资源隔离方案实施总结

## 文档目的

本文档汇总本次「空间资源隔离方案（Toolkit 白名单 + SDK 强制 + 工作流联动）」的全部代码改动，作为阶段性实现记录与后续迭代基线。

---

## 一、实现目标与范围

本次实现覆盖以下能力：

1. **Toolkit 通道接通**（IPC / Preload / Renderer API / HTTP）
2. **SDK 侧强制隔离**（toolkit 存在时强制 lazy-load）
3. **Lazy 指令展开过滤**（skill / agent / command）
4. **会话重建机制升级**（toolkit 变更触发 session rebuild）
5. **UI 资源管理联动**（Extensions、三大侧边栏面板）
6. **工作流联动**（编辑器资源选择约束 + 运行前校验）
7. **空间设置页 Toolkit 管理区**（显示、清空、偏好迁移）
8. **国际化文案补齐**（en / zh-CN）

---

## 二、核心架构落地结果

### 1) SDK 强制策略

- 当空间 `toolkit !== null` 时：
  - 强制 `effectiveSkillsLazyLoad = true`
  - SDK 不预加载插件目录（避免绕过白名单）
  - `settingSources` 降为 `['local']`
- 系统提示追加 Toolkit 可用资源列表，形成软约束。

### 2) 过滤执行点

- `expandLazyDirectives(...)` 增加 toolkit 参数与白名单校验：
  - `/skill`、`@agent`、`/command`
  - command 引用 skill 的二跳检查
- 不在 toolkit 内的资源不展开。

### 3) Session 隔离一致性

- `SessionConfig` 增加 `toolkitHash`
- 会话复用判断包含 `toolkitHash` 差异
- toolkit 变更后自动重建 session，避免旧上下文污染。

---

## 三、文件改动总览

### Main 进程

- `src/main/bootstrap/essential.ts`
  - 注册 `registerToolkitHandlers()`。

- `src/main/services/toolkit.service.ts`
  - 新增 `getToolkitHash()`。
  - 修正资源匹配逻辑（`matchesRef`），加强 namespace/source 判定。

- `src/main/services/agent/sdk-config.builder.ts`
  - 新增 `getEffectiveSkillsLazyLoad()`。
  - `toolkit !== null` 时强制 lazy-load。
  - `buildSystemPromptAppend()` 注入 Toolkit 白名单信息。

- `src/main/services/agent/skill-expander.ts`
  - `expandLazyDirectives(input, workDir, toolkit)`。
  - 增加 skill/agent/command 白名单过滤与 command->skill 二跳检查。

- `src/main/services/agent/message-flow.service.ts`
  - 读取 `effectiveLazyLoad + toolkit`。
  - 传递 toolkit 给 expander。
  - 记录 `toolkitHash` 到 `SessionConfig`。

- `src/main/services/agent/session.manager.ts`
  - `needsSessionRebuild()` 加入 `toolkitHash` 判断。
  - warm 流程同步 `toolkitHash`。

- `src/main/services/agent/types.ts`
  - `SessionConfig` 新增 `toolkitHash?: string`。

- `src/main/http/routes/index.ts`
  - 新增 Toolkit REST 路由：
    - `GET /api/toolkit/:spaceId`
    - `POST /api/toolkit/:spaceId/add`
    - `POST /api/toolkit/:spaceId/remove`
    - `DELETE /api/toolkit/:spaceId`
    - `POST /api/toolkit/:spaceId/migrate`
  - 同步补齐 Skills / Agents / Workflows 的 HTTP 路由支持。

### IPC / Preload / Renderer API

- `src/preload/index.ts`
  - KiteAPI 增加 toolkit 相关方法（含 `migrateToToolkit`）。

- `src/renderer/api/index.ts`
  - 增加 toolkit API（IPC + HTTP 双通道）。

### Renderer Store

- `src/renderer/stores/toolkit.store.ts`
  - 增加 `migrateFromPreferences(spaceId, skills, agents)`。

- `src/renderer/stores/skills.store.ts`
  - 空间内新建 skill 时，若 toolkit 已启用，自动加入 toolkit。

- `src/renderer/stores/agents.store.ts`
  - 空间内新建 agent 时，若 toolkit 已启用，自动加入 toolkit。

- `src/renderer/stores/workflows.store.ts`
  - `runWorkflow` 前加载 toolkit 并校验步骤资源。
  - 若存在越权资源，阻断运行并返回明确错误。

### Renderer 组件

- `src/renderer/components/home/ExtensionsView.tsx`
  - 在空间上下文中加载 toolkit。

- `src/renderer/components/home/ResourceCard.tsx`
  - 增加 `Activate / Add / Remove` toolkit 操作。
  - 修正 toolkit 加载判定（避免 `undefined` 分支无效）。

- `src/renderer/components/skills/SkillsPanel.tsx`
  - toolkit 模式默认仅显示白名单资源。
  - 支持 `Browse all resources` 与 `Toolkit resources only` 切换。
  - 支持资源级 Add/Remove/Activate 操作。

- `src/renderer/components/agents/AgentsPanel.tsx`
  - 同 SkillsPanel 的 toolkit 过滤与管理能力。

- `src/renderer/components/commands/CommandsPanel.tsx`
  - 同 SkillsPanel 的 toolkit 过滤与管理能力。

- `src/renderer/components/workflows/WorkflowEditorModal.tsx`
  - 步骤选择器仅展示 toolkit 内 skills/agents（toolkit 未配置时展示全部）。
  - 显示「Only toolkit resources are selectable」提示。

- `src/renderer/pages/HomePage.tsx`
  - 在「Edit Space」弹窗新增 **Toolkit 管理区**：
    - 显示当前 toolkit 资源（skills/agents/commands）
    - `Clear Toolkit`
    - `Import from Preferences`
    - 操作加载态/禁用态/错误态反馈

### i18n

- `src/renderer/i18n/locales/en.json`
- `src/renderer/i18n/locales/zh-CN.json`

新增 Toolkit 相关文案（按钮、提示、错误、模式说明）。

---

## 四、空间设置页 Toolkit 管理区（新增功能）

### 入口

- Home 页 -> Space 卡片 -> `Edit Space` 弹窗。

### 功能

1. **当前状态展示**
   - 未配置 toolkit：提示“当前全量可用模式”
   - 已配置 toolkit：分组展示 Skills / Agents / Commands 白名单项

2. **Clear Toolkit**
   - 二次确认
   - 执行后回到全量加载模式

3. **Import from Preferences**
   - 读取 `preferences.skills.enabled` 与 `preferences.agents.enabled`
   - 迁移为 toolkit 白名单

4. **可用性体验**
   - 加载中状态
   - 操作中禁用
   - 失败提示

---

## 五、验证结果

### 构建检查

- 命令：`npm run build`
- 结果：✅ 通过

### 单元测试

- 命令：`npm run test:unit`
- 结果：⚠️ 存在仓库既有失败项（主要在 checkpoint / skills.service 相关测试），与本次 toolkit 方案无直接耦合。

---

## 六、已知边界与后续建议

1. `Import from Preferences` 当前迁移来源是旧的 enabled 偏好字段（skills/agents）。
2. commands 偏好未做历史字段迁移（当前实现符合现有数据结构）。
3. 可进一步把 HomePage 中 Toolkit 区块拆为独立组件，降低页面复杂度。
4. 可新增专门的 Toolkit E2E 用例，覆盖：
   - 激活白名单
   - 非白名单资源拒绝
   - workflow 运行前拦截
   - clear/migrate 回归

---

## 七、结论

本次实现已将「Toolkit 白名单」从数据层、SDK 层、会话层、UI 层、工作流层整体打通，并在空间设置页提供了可运营的管理入口，达到可用、可管、可迁移的阶段目标。
