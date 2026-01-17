---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, dependency]
dependencies: []
---

# SDK 版本锁定策略不严格

## Problem Statement

`package.json` 中使用 `^0.2.7` 版本范围，但补丁文件 `@anthropic-ai+claude-agent-sdk+0.2.7.patch` 仅适用于 0.2.7 版本。

这导致：
- `npm install` 可能安装 0.2.8+ 版本
- 补丁应用失败或产生冲突
- CI/CD 构建不稳定

## Findings

**来源**: 依赖审查代理

**证据**:
```json
// package.json
"@anthropic-ai/claude-agent-sdk": "^0.2.7"
```

补丁文件名为 `@anthropic-ai+claude-agent-sdk+0.2.7.patch`

**位置**: `package.json`, `patches/`

## Proposed Solutions

### Solution 1: 锁定精确版本 (Recommended)
**描述**: 修改 package.json 使用精确版本
```json
"@anthropic-ai/claude-agent-sdk": "0.2.7"
```
**优点**:
- 保证补丁兼容性
- 构建可重复
**缺点**: 需要手动升级
**工作量**: Small
**风险**: Low

### Solution 2: 使用 package-lock.json
**描述**: 确保 package-lock.json 被提交并使用 `npm ci`
**优点**: 不修改 package.json
**缺点**: 依赖 CI 配置正确
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `package.json`

**Components**: 依赖管理

## Acceptance Criteria

- [ ] SDK 版本被锁定为 0.2.7
- [ ] CI/CD 构建稳定

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 依赖审查发现问题 | 补丁需要精确版本匹配 |

## Resources

- 变更文件: `package.json`
- 补丁文件: `patches/@anthropic-ai+claude-agent-sdk+0.2.7.patch`
