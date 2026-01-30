# SDK 0.2.22 Patch 指南

## 问题根因

### SDK V2 Session 参数传递缺陷

`@anthropic-ai/claude-agent-sdk` 0.2.22 版本的 V2 Session API (`unstable_v2_createSession`) 存在设计缺陷：**构造函数没有将用户传入的参数传递给底层的 `ProcessTransport`**。

### 代码对比

**Halo 传递的参数** (`agent.service.ts`):
```typescript
const sdkOptions = {
  cwd: workDir,                    // ✅ 正确设置
  mcpServers: mcpServersConfig,    // ✅ 正确设置
  includePartialMessages: true,    // ✅ 正确设置
  maxThinkingTokens: 10240,        // ✅ 正确设置
  plugins: buildPluginsConfig(),   // ✅ 正确设置
  // ...
}
```

**SDK 0.2.22 V2 Session 实际使用** (class U9):
```javascript
let Y = new XX({
  // cwd: X.cwd,              // ❌ 缺失！
  // stderr: X.stderr,        // ❌ 缺失！
  // plugins: X.plugins,      // ❌ 缺失！
  extraArgs: {},              // ❌ 硬编码为空
  maxThinkingTokens: void 0,  // ❌ 硬编码为 undefined
  maxTurns: void 0,           // ❌ 硬编码为 undefined
  mcpServers: {},             // ❌ 硬编码为空
  includePartialMessages: !1, // ❌ 硬编码为 false
  // ...
});
```

### 受影响的功能

| 参数 | 影响 |
|------|------|
| `cwd` | Agent 无法在正确的工作目录运行，读取文件路径错误 |
| `plugins` | 无法加载 skills、hooks 等扩展 |
| `mcpServers` | MCP 服务器配置无效 |
| `includePartialMessages` | 无法获得 token 级流式输出 |
| `maxThinkingTokens` | 扩展思考功能无效 |

---

## 创建 Patch 文件

### 方法 1: 使用 Node.js 脚本（推荐）

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', 'utf8');

// 原始代码（SDK 0.2.22 V2 Session 构造函数中的 ProcessTransport 创建）
const oldCode = 'let Y=new XX({abortController:this.abortController,pathToClaudeCodeExecutable:Q,env:\$,executable:X.executable??(j6()?\"bun\":\"node\"),executableArgs:X.executableArgs??[],extraArgs:{},maxThinkingTokens:void 0,maxTurns:void 0,maxBudgetUsd:void 0,model:X.model,fallbackModel:void 0,permissionMode:X.permissionMode??\"default\",allowDangerouslySkipPermissions:!1,continueConversation:!1,resume:X.resume,settingSources:[],allowedTools:X.allowedTools??[],disallowedTools:X.disallowedTools??[],mcpServers:{},strictMcpConfig:!1,canUseTool:!!X.canUseTool,hooks:!!X.hooks,includePartialMessages:!1,forkSession:!1,resumeSessionAt:void 0})';

// 修复后的代码（传递所有参数）
const newCode = 'let Y=new XX({abortController:this.abortController,pathToClaudeCodeExecutable:Q,cwd:X.cwd,stderr:X.stderr,env:\$,executable:X.executable??(j6()?\"bun\":\"node\"),executableArgs:X.executableArgs??[],extraArgs:X.extraArgs??{},maxThinkingTokens:X.maxThinkingTokens,maxTurns:X.maxTurns,maxBudgetUsd:X.maxBudgetUsd,model:X.model,fallbackModel:X.fallbackModel,permissionMode:X.permissionMode??\"default\",allowDangerouslySkipPermissions:X.allowDangerouslySkipPermissions??!1,continueConversation:X.continueConversation??!1,resume:X.resume,settingSources:X.settingSources??[],allowedTools:X.allowedTools??[],disallowedTools:X.disallowedTools??[],mcpServers:X.mcpServers??{},strictMcpConfig:X.strictMcpConfig??!1,canUseTool:!!X.canUseTool,hooks:!!X.hooks,includePartialMessages:X.includePartialMessages??!0,forkSession:X.forkSession??!1,resumeSessionAt:X.resumeSessionAt,plugins:X.plugins??[]})';

if (content.includes(oldCode)) {
  const newContent = content.replace(oldCode, newCode);
  fs.writeFileSync('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', newContent);
  console.log('SDK patched successfully');
} else {
  console.log('Old code not found - SDK version may have changed');
}
"
```

### 方法 2: 使用 patch-package

1. **备份原始文件**:
```bash
cp node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs /tmp/sdk.mjs.orig
```

2. **应用修改**（使用方法 1 的脚本）

3. **生成 patch 文件**:
```bash
diff -u /tmp/sdk.mjs.orig node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs \
  > patches/@anthropic-ai+claude-agent-sdk+0.2.22.patch
```

4. **验证 patch 文件**:
```bash
# 检查语法
node -c node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs

# 验证关键参数
grep -o "cwd:X.cwd" node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
```

---

## Patch 修改详情

### 新增参数

| 参数 | 修改 |
|------|------|
| `cwd` | 新增 `cwd:X.cwd` |
| `stderr` | 新增 `stderr:X.stderr` |
| `plugins` | 新增 `plugins:X.plugins??[]` |

### 修改参数

| 参数 | 修改前 | 修改后 |
|------|--------|--------|
| `extraArgs` | `{}` | `X.extraArgs??{}` |
| `maxThinkingTokens` | `void 0` | `X.maxThinkingTokens` |
| `maxTurns` | `void 0` | `X.maxTurns` |
| `maxBudgetUsd` | `void 0` | `X.maxBudgetUsd` |
| `fallbackModel` | `void 0` | `X.fallbackModel` |
| `allowDangerouslySkipPermissions` | `!1` | `X.allowDangerouslySkipPermissions??!1` |
| `continueConversation` | `!1` | `X.continueConversation??!1` |
| `settingSources` | `[]` | `X.settingSources??[]` |
| `mcpServers` | `{}` | `X.mcpServers??{}` |
| `strictMcpConfig` | `!1` | `X.strictMcpConfig??!1` |
| `includePartialMessages` | `!1` | `X.includePartialMessages??!0` |
| `forkSession` | `!1` | `X.forkSession??!1` |
| `resumeSessionAt` | `void 0` | `X.resumeSessionAt` |

---

## 注意事项

1. **SDK 版本更新时需要重新创建 patch**
   - 每次 SDK 版本更新，代码结构可能变化
   - 需要检查 patch 是否仍然适用

2. **不要使用 sed 命令**
   - sed 会错误转义特殊字符（`$`, `[]`）
   - 导致语法错误

3. **验证步骤**
   ```bash
   # 1. 语法检查
   node -c node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs

   # 2. 启动应用测试
   npm run dev

   # 3. 验证工作目录
   # 在对话中让 Claude 执行 "pwd" 或 "ls"，确认是正确的工作空间目录
   ```

---

## 长期解决方案

向 Anthropic 报告此问题，等待官方修复 V2 Session API 的参数传递。

相关代码位置：SDK 中的 `class U9`（V2 Session 实现）
