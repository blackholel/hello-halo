# 插件加载与安装配置说明（Kite / Claude Code）

## 1. 当前已完成的配置（2026-02-28）

已在本机完成以下配置：

1. 创建插件注册表：`/Users/dl/.kite/plugins/installed_plugins.json`
2. 注册插件：`superpowers@superpowers-dev`
3. 设置显式启用：`/Users/dl/.kite/settings.json` 中 `enabledPlugins.superpowers@superpowers-dev = true`

当前注册表示例：

```json
{
  "version": 2,
  "plugins": {
    "superpowers@superpowers-dev": [
      {
        "scope": "user",
        "installPath": "/Users/dl/.kite/plugins/superpowers",
        "version": "4.3.1",
        "installedAt": "2026-02-28T04:21:49.202Z",
        "lastUpdated": "2026-02-28T04:21:49.202Z"
      }
    ]
  }
}
```

## 2. 当前校验结果

按项目实际加载规则（`plugins.service.ts`）校验结果：

- installedCount: `1`
- enabledCount: `1`
- enabled: `superpowers@superpowers-dev`
- 安装路径存在且为真实目录（非 symlink）
- 插件目录下资源存在：`skills/`、`commands/`、`agents/`、`hooks/hooks.json`

结论：当前插件已满足“可被系统识别并加载”的条件。

## 3. 系统是怎么加载插件的

这个项目有两条并行加载链路：

1. **会话运行时加载（SDK / Claude Code CLI）**
   - `buildPluginsConfig(workDir)` 组装插件目录数组
   - 把目录作为 `plugins` 传给 SDK
   - SDK 最终转成 CLI 参数 `--plugin-dir <path>`

2. **扩展面板资源加载（Extensions UI）**
   - `listEnabledPlugins()` 从注册表 + settings 计算启用插件
   - `skills.service / commands.service / agents.service / hooks.service` 扫描每个启用插件目录
   - 扫描结果通过 IPC 返回到前端，显示在 Extensions 面板

### 3.1 Hooks 现行规则（2026-03-01）

1. 已安装且启用的插件 hooks 会像 `commands/skills/agents` 一样默认参与加载。
2. `strict-space-only` 不再单独屏蔽 hooks 来源；在 `kite` 模式下合并链路为：
   `settings -> global -> space -> plugin`。
3. hooks 的总开关仍是：
   - `config.claudeCode.hooksEnabled === false`，或
   - `space-config.claudeCode.hooksEnabled === false`。

## 4. 插件安装时必须配置什么

### 4.1 必须项

1. **插件目录存在且不是软链接**
   - 例：`/Users/dl/.kite/plugins/<plugin-name>`

2. **注册表有记录**
   - 文件：`/Users/dl/.kite/plugins/installed_plugins.json`
   - key 必须是 `name@marketplace` 形式
   - `installPath` 必须指向真实目录

### 4.2 推荐项

1. **显式启用插件**
   - 文件：`/Users/dl/.kite/settings.json`
   - 字段：`enabledPlugins`
   - 示例：

```json
{
  "enabledPlugins": {
    "superpowers@superpowers-dev": true
  }
}
```

不写 `settings.json` 也能加载（默认启用全部已安装插件），但显式配置更稳。

### 4.3 可选开关（在 `config.json` 的 `claudeCode.plugins`）

可用字段：

- `enabled`: 总开关，`false` 会直接禁用插件加载
- `loadDefaultPaths`: 是否加载默认路径（通常保持 `true`）
- `globalPaths`: 额外全局路径（可选）

## 5. 常见误区

1. 顶层 `config.json` 的 `plugins: []` 并不是当前主加载链路使用的配置源。
2. 只把插件目录放在 `~/.kite/plugins` 下，不写 `installed_plugins.json`，系统不会把它当“已安装插件”。
3. `installPath` 指向 symlink 会被安全校验拒绝。

## 6. 新插件接入最小流程

1. 放置目录：`/Users/dl/.kite/plugins/<name>`
2. 确保目录内有资源子目录（按需）：`skills/`、`commands/`、`agents/`、`hooks/hooks.json`
3. 在 `installed_plugins.json` 新增 `name@marketplace` 记录
4. 在 `settings.json` 的 `enabledPlugins` 置为 `true`
5. 重启应用或触发资源刷新

## 7. 快速自检命令

```bash
cat /Users/dl/.kite/plugins/installed_plugins.json
cat /Users/dl/.kite/settings.json
ls -la /Users/dl/.kite/plugins/<plugin-name>
```
