# 资源可见性与调用控制指南（resource-exposure）

本文档用于统一管理 `skills / agents / commands` 的外层展示与调用权限。

## 1. 目标与作用

通过配置 `resource-exposure.json`，你可以控制资源是否：

1. 在外层扩展列表显示（Extensions / Composer / TemplateLibrary）
2. 可以被用户直接调用（`/skill`、`@agent`、`/command`）
3. 仅作为内部依赖被命令链路调用（internal-only 资源）

## 2. 配置文件位置

配置文件路径：

`/Users/dl/.kite/taxonomy/resource-exposure.json`

如果文件不存在，可以手动创建。

## 3. 曝光级别

支持两种值：

1. `public`
2. `internal-only`

语义：

1. `public`：可展示、可直接调用
2. `internal-only`：不在外层展示；不可被用户直接 `/` 或 `@` 调用；但允许作为 command 依赖被内部调用

## 4. 默认行为（很关键）

系统默认值：

1. `skill = internal-only`
2. `agent = internal-only`
3. `command = public`

这就是为什么你只放行一个 command，其他 command 还会出现：因为 command 默认就是 `public`。

## 5. 优先级规则

同一资源命中多个来源时，优先级如下：

1. `resource-exposure.json` 的 `resources`（最高）
2. `resource-exposure.json` 的按类型分组（`skills/agents/commands`）
3. 资源 frontmatter 中的 `exposure`
4. 系统默认值

另外：

1. 若 `config.json` 中 `resourceExposure.enabled = false`，则所有资源按 `public` 处理

## 6. 推荐配置结构

推荐同时写两层：

1. `resources`：精确 key（最稳）
2. `skills/agents/commands`：可读性更好、作为兜底

示例（完整可用）：

```json
{
  "version": 1,
  "resources": {
    "command:plugin:-:superpowers:brainstorm": "public",
    "command:plugin:-:superpowers:execute-plan": "internal-only",
    "command:plugin:-:superpowers:write-plan": "internal-only",
    "skill:global:-:-:frontend-slides": "public"
  },
  "commands": {
    "superpowers:brainstorm": "public",
    "superpowers:execute-plan": "internal-only",
    "superpowers:write-plan": "internal-only"
  },
  "skills": {
    "frontend-slides": "public"
  },
  "agents": {
    "planner": "internal-only",
    "tdd-guide": "internal-only"
  }
}
```

## 7. 如何“只显示一个 command”

由于 command 默认 `public`，你必须显式把其他 command 设为 `internal-only`。

操作方式：

1. 目标 command 设为 `public`
2. 同命名空间其他 command 全部设为 `internal-only`

## 8. 新增资源时的标准流程（建议固定执行）

每次新增资源（本地、插件、global path、space `.claude`）后：

1. 决定是否对外展示
2. 在 `resource-exposure.json` 增加对应条目
3. 优先补 `resources` 精确 key，再补类型分组兜底项
4. 观察 UI 是否刷新（watcher 已支持自动刷新，无需重启）

建议团队规范：

1. `skills/agents` 默认保持 `internal-only`
2. command 采用白名单放行：只把需要给用户看的 command 设为 `public`

## 9. key 写法说明

### 9.1 精确 key（`resources`）

格式：

`{type}:{source}:{scope}:{namespace}:{name}`

说明：

1. `type`：`skill | agent | command`
2. `source`：例如 `app | global | space | plugin | installed`
3. `scope`：空间资源时为 `workDir` 的哈希；非空间一般为 `-`
4. `namespace`：插件名或命名空间；没有就 `-`
5. `name`：资源名

### 9.2 类型分组 key（`skills/agents/commands`）

支持较短写法：

1. 纯名：`frontend-slides`
2. 带命名空间：`superpowers:brainstorm`

建议：

1. 对关键资源优先写 `resources` 精确 key
2. 对日常维护写类型分组 key，便于阅读

## 10. 你当前场景对应写法

你给的两个目标：

1. `/Users/dl/.kite/plugins/superpowers/commands/brainstorm.md`
2. `/Users/dl/.agents/skills/frontend-slides`

建议最少配置：

```json
{
  "version": 1,
  "resources": {
    "command:plugin:-:superpowers:brainstorm": "public",
    "skill:global:-:-:frontend-slides": "public"
  },
  "commands": {
    "superpowers:brainstorm": "public"
  },
  "skills": {
    "frontend-slides": "public"
  }
}
```

## 11. 常见问题排查

### 11.1 访达看不到 `.kite`

1. `.kite` 是隐藏目录（点开头）
2. 访达按 `Command + Shift + .` 显示隐藏文件，或“前往文件夹”输入 `/Users/dl/.kite`
3. 这和 `resource-exposure` 配置无关

### 11.2 配了 `public` 仍不显示

依次检查：

1. 资源是否被系统扫描到（插件是否启用、global path 是否在配置里）
2. `resourceExposure.enabled` 是否被异常关闭/改动
3. key 是否写错（尤其 namespace/source）
4. 有无更高优先级规则把它覆盖回 `internal-only`

### 11.3 为什么突然多了很多 command

1. 因为 command 默认 `public`
2. 需要把不想展示的 command 显式标为 `internal-only`

## 12. 配套配置项（`/Users/dl/.kite/config.json`）

可选相关开关：

1. `resourceExposure.enabled`：总开关（默认 `true`）
2. `workflow.allowLegacyInternalDirect`：workflow legacy 兼容开关（默认 `true`）
3. `commands.legacyDependencyRegexEnabled`：命令依赖 regex 回退开关（默认 `true`）

建议：

1. 生产阶段保持默认开启，避免打断现有 workflow
2. 完成命令依赖迁移后，再逐步收紧 legacy 开关

