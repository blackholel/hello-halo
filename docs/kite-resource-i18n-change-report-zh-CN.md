# Kite 资源多语言改造说明（Skills / Agents / Commands）

## 1. 背景与问题

当前系统里 `Skills / Agents / Commands` 的展示与使用存在以下问题：

1. 资源 frontmatter 只有英文 `name/description`，缺少中文展示字段。
2. 即使资源已补中文字段，前后端部分链路仍使用英文 `name` 做展示，导致侧边栏、模板库、输入建议等界面仍出现英文。
3. 资源从模板库导入到空间（space/toolkit）后，展示与外层不一致，用户体验割裂。
4. 斜杠命令相关 UI（建议面板、会话列表中的命令痕迹、技能卡片等）没有统一走本地化展示名。

目标是：**展示层中文统一，执行层稳定不变**（执行仍使用原始标识符，避免行为回归）。

---

## 2. 改造目标

1. 支持资源标题和描述的本地化字段：`name_zh-CN` / `description_zh-CN`（兼容 `title_zh-CN`）。
2. 打通主进程 -> IPC/HTTP -> preload -> renderer 的 locale 透传。
3. 前端所有核心展示位优先使用本地化展示名 `displayName`。
4. 提供存量迁移脚本，支持：
   - 全量/增量扫描
   - GPT 产出文件批量写回
   - 后续新增资源低成本维护
5. 不改资源正文内容，仅改标题/描述展示元数据。

---

## 3. 方案原则

1. **展示与执行分离**
   - 展示：`displayName`（本地化）
   - 执行：`name`（原始标识符）
2. **向后兼容**
   - 无本地化字段时回落英文字段。
3. **最小侵入**
   - 优先改读取与映射层，不改业务执行协议。

---

## 4. 核心代码改造（第一阶段）

### 4.1 主进程本地化元数据读取

- 新增/增强本地化 frontmatter 解析：支持
  - `name_<locale>` / `title_<locale>`
  - `description_<locale>`
- 并带 locale fallback 到默认英文字段。

涉及文件：
- `src/main/services/resource-metadata.service.ts`
- `src/main/services/__tests__/resource-metadata.service.test.ts`

### 4.2 资源服务支持 locale 与 displayName

- `skills/agents/commands` 服务层新增 locale 入参。
- 缓存维度纳入 locale，避免不同语言互相污染。
- 列表返回 `displayName`（用于展示）与本地化 `description`。

涉及文件：
- `src/main/services/skills.service.ts`
- `src/main/services/agents.service.ts`
- `src/main/services/commands.service.ts`
- `src/main/services/__tests__/resource-scan-scene-tags.integration.test.ts`

### 4.3 IPC / HTTP / preload / renderer API 链路透传 locale

涉及文件：
- `src/main/ipc/skills.ts`
- `src/main/ipc/agents.ts`
- `src/main/ipc/commands.ts`
- `src/main/http/routes/index.ts`
- `src/preload/index.ts`
- `src/renderer/api/index.ts`

### 4.4 Renderer 存储与模板库映射改造

- stores 侧请求资源列表时带当前语言。
- 模板库过滤、资源卡片元信息优先用 `displayName`。

涉及文件：
- `src/renderer/stores/skills.store.ts`
- `src/renderer/stores/agents.store.ts`
- `src/renderer/stores/commands.store.ts`
- `src/renderer/stores/workflows.store.ts`
- `src/renderer/components/resources/extension-filtering.ts`
- `src/renderer/components/resources/resource-meta.ts`
- `src/renderer/components/resources/__tests__/extension-filtering.test.ts`
- `src/renderer/components/canvas/viewers/TemplateLibraryViewer.tsx`
- `src/renderer/pages/SceneTaxonomyAdminPage.tsx`

---

## 5. 存量迁移与增量维护（第二阶段）

### 5.1 新增迁移脚本

新增文件：
- `scripts/migrate-kite-resource-i18n.mjs`

能力包括：

1. 扫描 `~/.kite` 下 `skills/agents/commands`。
2. 批量写入本地化字段：`name_zh-CN` / `description_zh-CN`。
3. 支持 `--pending-only` 输出“待翻译清单”（只扫新增未本地化资源）。
4. 支持 `--translations-file` 读取 GPT 翻译结果 JSON 并批量写回。
5. 支持 `--force` 覆盖更新。

### 5.2 npm 命令

在 `package.json` 中新增：

1. `migrate:kite-resource-i18n:scan-new`
2. `migrate:kite-resource-i18n:apply-gpt`

并保留：

1. `migrate:kite-resource-i18n`

### 5.3 GPT 直译存量数据（无外部翻译 API）

已完成：

1. 对存量资源（62 个文件）生成中文标题/描述翻译。
2. 批量写回 `~/.kite` frontmatter 本地化字段。
3. 校验覆盖率：62/62 具备 `name_zh-CN` 与 `description_zh-CN`。

---

## 6. UI 中文一致性补强（第三阶段）

在已有链路基础上，继续修复“仍显示英文”的位置。

### 6.1 左侧资源面板

- Skills / Agents / Commands 面板统一优先显示 `displayName`。
- 面板搜索支持按 `displayName`（中文）检索。

涉及文件：
- `src/renderer/components/skills/SkillsPanel.tsx`
- `src/renderer/components/agents/AgentsPanel.tsx`
- `src/renderer/components/commands/CommandsPanel.tsx`

### 6.2 输入建议面板（斜杠 / @）

- 建议项标题显示中文展示名。
- 插入行为保持原始英文 key，不影响执行。

涉及文件：
- `src/renderer/components/chat/InputArea.tsx`
- `src/renderer/components/chat/ComposerTriggerPanel.tsx`

### 6.3 Skills 快捷下拉

- 收藏和最近列表展示名改为本地化。

涉及文件：
- `src/renderer/components/skills/SkillsDropdown.tsx`

### 6.4 会话列表与技能卡片

- 对会话标题/预览中 `/xxx`、`@xxx` 触发词做显示层映射，优先显示中文名。
- Skill 卡片显示本地化技能名。

涉及文件：
- `src/renderer/components/chat/ConversationList.tsx`
- `src/renderer/components/chat/SkillCard.tsx`

### 6.5 Space 设置页 Toolkit 清单

- Toolkit 已加入资源在设置页中优先显示中文名（与外层保持一致）。

涉及文件：
- `src/renderer/pages/HomePage.tsx`

---

## 7. 验证结果

本轮执行过的验证：

1. `npx tsc --noEmit -p tsconfig.json` 通过。
2. `npx vitest run src/renderer/components/resources/__tests__/extension-filtering.test.ts` 通过。

前序阶段也已通过：

1. `src/main/services/__tests__/resource-metadata.service.test.ts`
2. `src/main/services/__tests__/resource-scan-scene-tags.integration.test.ts`
3. `src/renderer/components/resources/__tests__/extension-filtering.test.ts`

---

## 8. 当前行为说明（重要）

1. **显示是中文**：侧栏、模板库、建议面板、Toolkit 列表等尽量统一为本地化展示名。
2. **执行仍走英文标识符**：插入到输入框的实际 token 仍为原始 key，保证命令解析稳定。
3. 这是有意设计：避免“展示中文后命令执行失败”的回归。

---

## 9. 后续建议

1. 如果希望“输入框里也直接显示中文 token”，需增加“发送前中文->英文 key 映射”层。
2. 可增加一组端到端 UI 用例，覆盖：
   - 模板库导入后侧栏中文一致性
   - 斜杠面板显示中文但执行成功
   - Toolkit 清单显示中文
3. 发布前跑一次全量 `test` 与关键页面冒烟（SpacePage / TemplateLibrary / Settings）。

---

## 10. 快速操作手册（增量维护）

1. 扫描新增未翻译资源：

```bash
npm run migrate:kite-resource-i18n:scan-new -- --pending-out /private/tmp/kite-resource-pending-zhCN.json
```

2. 用 GPT 生成翻译结果文件（格式：`file/nameZh/descriptionZh`）。

3. 批量写回：

```bash
npm run migrate:kite-resource-i18n:apply-gpt -- --translations-file /private/tmp/kite-resource-translations-zhCN.json
```

