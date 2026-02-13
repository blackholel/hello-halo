---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, security]
dependencies: []
---

# 符号链接攻击风险

## Problem Statement

代码使用 `existsSync()` 检查路径是否存在，但没有检查路径是否为符号链接。攻击者可以：
1. 在 `~/.kite/skills/` 或 `{workDir}/.claude/` 中创建指向敏感目录的符号链接
2. 通过符号链接让 Claude Agent SDK 加载任意位置的"插件"

## Findings

**来源**: 安全审查代理

**证据**:
```typescript
// 当前代码没有检查符号链接
if (existsSync(appSkillsPath)) {
  plugins.push({ type: 'local', path: appSkillsPath })
}
```

**位置**: `src/main/services/agent.service.ts:634-659`

## Proposed Solutions

### Solution 1: 禁止符号链接 (Recommended)
**描述**: 使用 `lstatSync` 检查是否为符号链接，拒绝符号链接路径
```typescript
import { lstatSync } from 'fs'

function isValidPluginPath(pluginPath: string): boolean {
  try {
    const stat = lstatSync(pluginPath)
    if (stat.isSymbolicLink()) {
      console.warn(`[Agent] Security: Rejected symlink: ${pluginPath}`)
      return false
    }
    return stat.isDirectory()
  } catch {
    return false
  }
}
```
**优点**: 安全性高
**缺点**: 可能影响合法使用符号链接的用户
**工作量**: Small
**风险**: Low

### Solution 2: 解析并验证真实路径
**描述**: 使用 `realpathSync` 解析符号链接，验证真实路径在允许范围内
**优点**: 更灵活
**缺点**: 实现复杂
**工作量**: Medium
**风险**: Medium

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] 符号链接路径被检测并拒绝（或验证后允许）
- [ ] 安全日志记录可疑路径

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 安全审查发现问题 | 符号链接是常见攻击向量 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
