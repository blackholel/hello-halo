# Kite 配置与目录策略改造说明（v2.2）

## 1. 文档目的
记录本轮「Kite 品牌切换后配置源互斥开关」改造的背景、方案、代码变更与验收结果，作为后续维护与回归基线。

## 2. 背景与问题
1. 品牌切换后，应用主配置目录已统一为 `.kite`，但用户群体里同时存在已安装 Claude Code 的人群。
2. 业务诉求不是“混合兼容”，而是“二选一互斥”：要么全走 Kite 配置源，要么全走 Claude 配置源。
3. 改造前存在风险：
- 运行期读取实时配置，切换后不重启可能出现新旧源混读。
- hooks/plugins/skills/agents/commands/watcher 的来源边界不一致。
- 缓存未携带模式签名，切模式后可能读到脏缓存。

## 3. 最终方案（已落地）
### 3.1 单目录策略（既有决策继续生效）
1. Kite 运行目录主策略保持不变：默认使用 `~/.kite`（或 `KITE_CONFIG_DIR`）。
2. 不自动回退、不自动迁移历史 `.halo` 目录。

### 3.2 配置源互斥开关
新增 `configSourceMode`（默认 `kite`），支持：
1. `kite`：用户级配置根目录为 `~/.kite`。
2. `claude`：用户级配置根目录为 `~/.claude`。

### 3.3 纯源边界（定稿）
1. `kite` 模式：保留原有合并语义（settings + app/space overlay + plugin）。
2. `claude` 模式：严格纯源，仅允许 `~/.claude/settings.json` + 当前启用插件 hooks。
3. `claude` 模式下明确禁止叠加：
- `config.claudeCode.hooks`
- `space-config(.kite).claudeCode.hooks`

### 3.4 运行时锁定（防混读）
进程启动后锁定模式，运行中不因设置变更而改变来源路径：
1. 启动时读取一次 `configSourceMode` 并锁定。
2. 业务逻辑统一读取锁定态 API，不再使用运行期 `getConfig().configSourceMode` 决策路径。
3. 设置页仅“写配置 + 提示重启”，不做热切换。

### 3.5 启动时序硬约束
在 `app.whenReady()` 中固定顺序：
1. `await initializeApp()`
2. `initConfigSourceModeLock()`
3. `createWindow()`
4. `initializeEssentialServices(mainWindow)`
5. `initializeExtendedServices(mainWindow)`

## 4. 主要代码变更
### 4.1 新增服务
1. `src/main/services/config-source-mode.service.ts`
- `initConfigSourceModeLock()`
- `getLockedConfigSourceMode()`
- `getLockedUserConfigRootDir()`
- `_testResetConfigSourceModeLock()`
- `_testInitConfigSourceModeLock(mode)`

### 4.2 配置服务
1. `src/main/services/config.service.ts`
- 新增 `ConfigSourceMode` 类型与 `normalizeConfigSourceMode()`。
- `DEFAULT_CONFIG` 增加 `configSourceMode: 'kite'`。
- `getConfig()` / `saveConfig()` 对非法值统一回退 `kite`。

### 4.3 启动流程
1. `src/main/index.ts`
- 在 `initializeApp()` 之后、window 和服务初始化前执行 `initConfigSourceModeLock()`。
- 锁定初始化失败时中断启动，避免部分可用状态。

### 4.4 资源与 SDK 链路
1. `src/main/services/agent/sdk-config.builder.ts`
- `CLAUDE_CONFIG_DIR` 改为锁定根目录。
- plugins/settingSources/hooks 组装统一依赖锁定态。
2. `src/main/services/skills.service.ts`
3. `src/main/services/commands.service.ts`
4. `src/main/services/agents.service.ts`
5. `src/main/services/skills-agents-watch.service.ts`
- 全部改为锁定态源选择。
- `claude` 模式不加载 app overlay 的全局扩展路径。

### 4.5 Hooks 与 Plugins
1. `src/main/services/hooks.service.ts`
- `claude` 模式仅合并 `settings + plugin`。
2. `src/main/services/plugins.service.ts`
- 改为单源读取（当前锁定根目录）。
- 缓存签名引入 `mode + registryPaths + settingsPath + mtime`，切模式或路径变化强制 miss。

### 4.6 设置页与类型
1. `src/renderer/pages/SettingsPage.tsx`
- 新增配置源切换 UI（Kite/Claude）。
- 保存后提示“重启后生效”。
2. `src/renderer/types/index.ts`
- 补充 `configSourceMode` 字段。
3. `src/renderer/i18n/locales/en.json`
4. `src/renderer/i18n/locales/zh-CN.json`
- 增加配置源相关文案。
5. `src/renderer/components/commands/CommandsDropdown.tsx`
6. `src/renderer/components/commands/CommandsPanel.tsx`
7. `src/renderer/components/agents/AgentsPanel.tsx`
- 路径展示随模式变化。

## 5. 测试与验收
### 5.1 单测覆盖
新增/更新：
1. `tests/unit/services/config-source-mode.service.test.ts`
2. `tests/unit/services/resource-source-selection.test.ts`
3. `tests/unit/services/skills-agents-watch.service.test.ts`
4. `tests/unit/services/hooks.service.test.ts`
5. `tests/unit/services/plugins.service.test.ts`
6. `tests/unit/services/agent.service.test.ts`
7. `tests/unit/services/config.test.ts`

### 5.2 验收命令
1. `npm run build`：通过
2. `npm run test:unit`：通过（`285 passed`）
3. `npm run test:e2e:smoke`：通过（`9 passed, 2 skipped`）

## 6. 行为结果与边界
1. 切换 `configSourceMode` 后不重启：当前进程来源保持不变（锁定态生效）。
2. 重启后：来源一次性切换到目标模式，不发生混读。
3. `claude` 模式 hooks 不叠加 app/space overlay。
4. 本期不改会话/空间数据存储目录策略。
5. 不处理 `.halo` 自动迁移，仍属于手动迁移范畴。

## 7. 已知注意事项
1. 仓库当前 `.gitignore` 忽略了 `tests/` 目录；新增测试文件默认不会被 Git 跟踪，需要按仓库策略单独处理。
2. 本文档描述的是本次代码状态，不等于发布说明；发布前仍需按主分支 CI 与发版流程复核。
