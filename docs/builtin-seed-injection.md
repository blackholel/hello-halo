# 内置 Seed 首启注入方案实现说明

## 1. 文档目的
本文档用于说明本次“内置 Seed 注入”功能的实现背景、设计目标、代码改动、验证结果与使用方式，便于后续维护、评审和交接。

## 2. 背景与问题
项目需要把一份可分发的默认配置随安装包发出去，并在用户第一次启动时注入到用户配置目录（`~/.kite`），同时满足：

1. 不覆盖用户已有配置。
2. 不把构建机敏感信息打入安装包。
3. 构建链路跨平台一致。

原始思路存在三类高风险点：

1. 开发态路径使用单一路径推断，`dev/preview` 容易找不到资源。
2. 构建命令覆盖不完整，`build:win-x64` 漏掉会导致 CI 产物不一致。
3. 若 seed 生成在 `resources/`，会与 `files: ["resources/**/*"]` 叠加，产生重复打包和残留污染风险。

## 3. 设计目标
本次实现落地了以下目标：

1. 统一 `resolveSeedDir()`，按候选路径顺序探测，不依赖单一路径。
2. `build:*` + `release*` 全链路前置 seed 生成，覆盖 `build:win-x64`。
3. seed 生成目录改为 `build/default-kite-config`，仅通过 `extraResources` 打包。
4. 首启注入采用幂等策略：`copy-if-missing` + `deepFillMissing`，不覆盖用户已有值。
5. 插件注册表支持 `__KITE_ROOT__` 模板路径替换，并与用户已有注册表合并。

## 4. 功能流程概览

### 4.1 构建阶段
1. 执行 `npm run prepare:kite-seed`。
2. 脚本从 `KITE_SEED_SOURCE_DIR`（默认 `~/.kite`）读取白名单配置。
3. 对敏感数据做脱敏与路径模板化。
4. 输出到 `build/default-kite-config`。
5. `electron-builder` 通过 `extraResources` 将其打包到 `default-kite-config`。

### 4.2 运行阶段（应用启动）
1. `initializeApp()` 创建基础目录。
2. `resolveSeedDir()` 探测内置 seed 目录。
3. 若 `KITE_DISABLE_BUILTIN_SEED=1`，直接跳过注入。
4. 若存在 `.seed-state.json`，说明已注入过，跳过。
5. 首次注入时执行：
   1. 普通目录/文件：仅复制缺失项。
   2. `config.json` / `settings.json`：仅补缺失字段。
   3. `plugins/installed_plugins.json`：模板路径替换后按插件名补齐。
6. 写入 `.seed-state.json` 标记注入完成。

## 5. 代码改动清单

## 5.1 新增文件
1. `scripts/copy-kite-seed.mjs`
   1. 生成目录固定为 `build/default-kite-config`。
   2. 脚本开头强制清空旧目录（`rmSync(..., { recursive: true, force: true })`）。
   3. 白名单复制：`config.json`、`settings.json`、`agents/`、`commands/`、`hooks/`、`mcp/`、`rules/`、`skills/`、`contexts/`、`plugins/cache/`、`plugins/installed_plugins.json`。
   4. 脱敏策略：
      1. `config.api.apiKey` 置空。
      2. `config.mcpServers.*.env` 置空对象。
      3. 删除 `config.analytics`。
      4. 删除 `config.claudeCode.plugins.globalPaths` 和 `config.claudeCode.agents.paths`。
      5. `settings.json` 中命中 `key|token|secret|password` 的字段置空。
   5. 插件注册表过滤：只保留 `plugins/cache` 子树安装路径；路径模板化为 `__KITE_ROOT__/plugins/cache/...`。
   6. 写出 `seed-manifest.json`。

## 5.2 修改文件
1. `package.json`
   1. 新增脚本：`prepare:kite-seed`。
   2. 以下脚本前置 `prepare:kite-seed`：
      1. `build:mac`
      2. `build:win`
      3. `build:win-x64`
      4. `build:linux`
      5. `release`
      6. `release:mac`
      7. `release:win`
      8. `release:linux`
   3. 在 `mac/win/linux` 的 `extraResources` 中新增 seed 条目：
      1. `from: "build/default-kite-config"`
      2. `to: "default-kite-config"`
      3. `filter: ["**/*"]`
2. `src/main/services/config.service.ts`
   1. 新增 `resolveSeedDir(): string | null`，按优先级探测：
      1. `KITE_BUILTIN_SEED_DIR`
      2. `join(process.resourcesPath, "default-kite-config")`
      3. `join(app.getAppPath(), "../resources/default-kite-config")`
      4. `join(__dirname, "../../resources/default-kite-config")`
      5. `join(process.cwd(), "build/default-kite-config")`
      6. `join(process.cwd(), "resources/default-kite-config")`
   2. 新增注入函数与辅助函数：
      1. `injectBuiltInSeed()`
      2. `copyDirMissingOnly()`
      3. `deepFillMissing()`
      4. `mergePluginRegistryWithTemplatePath()`
   3. 新增注入状态文件：`.seed-state.json`。
   4. 新增注入开关：`KITE_DISABLE_BUILTIN_SEED=1`。
3. `tests/unit/services/config.test.ts`
   1. 新增 seed 相关测试：
      1. `resolveSeedDir` 的环境变量优先级。
      2. 首次注入成功。
      3. 用户已有配置不覆盖。
      4. `KITE_DISABLE_BUILTIN_SEED` 生效。
      5. 注入只执行一次。
   2. 默认在普通测试中启用 `KITE_DISABLE_BUILTIN_SEED=1`，避免测试被本地 seed 目录干扰。

## 6. 已实现的关键约束
1. **零覆盖原则**：用户已有文件和字段优先，seed 只补缺。
2. **注入幂等**：通过 `.seed-state.json` 保证只注入一次。
3. **路径稳健性**：多候选路径探测，支持 `dev/preview/packaged` 差异。
4. **构建一致性**：`build:*` 与 `release*` 都执行 seed 准备。
5. **重复打包规避**：seed 不落 `resources/`，只走 `extraResources`。

## 7. 使用说明

### 7.1 常规构建
直接执行现有命令即可，seed 会自动准备：

1. `npm run build:mac`
2. `npm run build:win`
3. `npm run build:win-x64`
4. `npm run build:linux`

### 7.2 指定 seed 来源目录
```bash
KITE_SEED_SOURCE_DIR=/abs/path/to/.kite npm run prepare:kite-seed
```

### 7.3 运行时强制指定 seed 目录
```bash
KITE_BUILTIN_SEED_DIR=/abs/path/to/default-kite-config
```

### 7.4 运行时禁用注入
```bash
KITE_DISABLE_BUILTIN_SEED=1
```

## 8. 验证结果（本次实现）
已完成并通过：

1. `npm run test:unit -- tests/unit/services/config.test.ts`
2. `npm run test:unit -- tests/unit/services/plugins.service.test.ts`
3. `npm run test:unit -- tests/unit/services/config.test.ts tests/unit/services/plugins.service.test.ts`

并做过一次脚本级输出检查，确认：

1. `config.json`、`settings.json` 脱敏生效。
2. `plugins/installed_plugins.json` 仅保留 `plugins/cache` 条目并模板化路径。

## 9. 当前边界与后续建议
当前实现是“首启注入”，不是“持续同步”或“版本升级迁移”。如果未来需要随版本升级补新默认配置，建议基于 `.seed-state.json` 扩展 `schemaVersion` 升级策略。
