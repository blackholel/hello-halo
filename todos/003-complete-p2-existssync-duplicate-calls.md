---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, performance]
dependencies: []
---

# existsSync 重复调用导致性能浪费

## Problem Statement

`buildPluginsConfig()` 函数中 `existsSync` 被重复调用：
- console.log 中调用 2 次
- if 判断中调用 2 次
- 总计 4 次，实际只需要 2 次

每次调用都是同步阻塞操作，在 HDD 或网络驱动器上可能达到 10-100ms。

## Findings

**来源**: 性能审查代理

**证据**:
```typescript
console.log(`... exists: ${existsSync(appSkillsPath)}`)  // 第1次
if (existsSync(appSkillsPath)) {                         // 第2次
```

**位置**: `src/main/services/agent.service.ts:634-659`

## Proposed Solutions

### Solution 1: 缓存 existsSync 结果 (Recommended)
**描述**: 将结果存入变量，避免重复调用
```typescript
const appSkillsExists = existsSync(appSkillsPath)
console.log(`... exists: ${appSkillsExists}`)
if (appSkillsExists) { ... }
```
**优点**: 简单有效，调用次数从 4 减到 2
**缺点**: 无
**工作量**: Small
**风险**: Low

### Solution 2: 结合日志精简
**描述**: 删除 console.log 中的 existsSync 调用，同时精简日志
**优点**: 一举两得
**缺点**: 调试信息减少
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] `existsSync` 每个路径只调用一次
- [ ] 功能不变

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 性能审查发现问题 | 同步 IO 应避免重复调用 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
