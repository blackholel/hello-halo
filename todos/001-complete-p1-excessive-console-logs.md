---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, quality, performance]
dependencies: []
---

# 过多的 console.log 调试日志

## Problem Statement

`agent.service.ts` 文件包含 84 处 `console.log` 调用，其中 `buildPluginsConfig()` 函数仅 24 行代码却包含 5 处调试日志。这些日志：
1. 使用 `console.log` 而非结构化日志系统
2. 没有日志级别区分（debug/info/warn/error）
3. 在生产环境会产生大量噪音，影响性能和可读性
4. 敏感路径信息直接输出

## Findings

**来源**: 代码质量审查代理、性能审查代理、代码简化审查代理

**证据**:
- `buildPluginsConfig()` 中有 5 条 console.log
- 每次 `ensureSessionWarm()` 和 `sendMessage()` 都会调用
- `console.log` 是同步操作，会阻塞事件循环
- 字符串拼接和 `JSON.stringify` 有额外开销

**位置**: `src/main/services/agent.service.ts:634-659`

## Proposed Solutions

### Solution 1: 引入结构化日志系统 (Recommended)
**描述**: 使用 electron-log 或自定义 logger，支持日志级别
**优点**:
- 生产环境可控制日志级别
- 支持日志文件输出
- 统一日志格式
**缺点**: 需要引入新依赖或创建 logger 服务
**工作量**: Medium
**风险**: Low

### Solution 2: 条件日志
**描述**: 使用环境变量控制日志输出
```typescript
const DEBUG = process.env.NODE_ENV === 'development' || process.env.HALO_DEBUG
DEBUG && console.log(...)
```
**优点**: 简单快速
**缺点**: 不够优雅，仍然是 console.log
**工作量**: Small
**风险**: Low

### Solution 3: 精简日志到单条
**描述**: 将 5 条日志合并为 1 条汇总日志
```typescript
if (plugins.length > 0) {
  console.log(`[Agent] Plugins: ${plugins.map(p => p.path).join(', ')}`)
}
```
**优点**: 最小改动
**缺点**: 仍然是 console.log
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] `buildPluginsConfig()` 中的日志从 5 条减少到 1 条或使用日志级别
- [ ] 生产环境不输出调试级别日志
- [ ] 日志格式统一

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 代码审查发现问题 | 日志过多影响性能和可读性 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
