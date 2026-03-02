# 资源展示多语言 Sidecar（离线）

> 详细背景、变更清单、新增资源翻译流程与排障手册见：`docs/resource-display-i18n-implementation-and-playbook.zh-CN.md`

## 对外与内部接口签名

### Renderer API（对外）
- `listSkills(workDir, locale, view)`
- `listAgents(workDir, locale, view)`
- `listCommands(workDir, locale, view)`

### Main Service（内部）
- `listSkills(workDir, view, locale)`
- `listAgents(workDir, view, locale)`
- `listCommands(workDir, view, locale)`

> 注意：两层参数顺序不同，新增调用时务必按层级使用，避免串参。

## Sidecar 文件

- 文件名：`resource-display.i18n.json`
- 内容仅包含 `title/description` 的多语言映射。
- 优先级：`sidecar(locale) > frontmatter(locale) > sidecar(defaultLocale) > frontmatter(base) > fallback`。

## 离线脚本

- `npm run sidecar:scan`
- `npm run sidecar:apply`
- `npm run sidecar:report`

## 旧迁移脚本说明

`scripts/migrate-kite-resource-i18n.mjs` 保留兼容，但默认启用 `--offline-only`，会阻止 `api/google` 在线翻译模式。仅在显式传入 `--allow-online` 时允许在线模式（不推荐）。
