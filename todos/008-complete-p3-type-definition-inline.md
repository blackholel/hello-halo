---
status: pending
priority: p3
issue_id: "008"
tags: [code-review, quality]
dependencies: []
---

# 类型定义内联，缺乏复用性

## Problem Statement

`Array<{ type: 'local'; path: string }>` 类型在函数签名和变量声明中重复定义，且与 SDK 补丁中新增的 `plugins` 参数类型应保持一致。

## Findings

**来源**: 代码质量审查代理

**证据**:
```typescript
function buildPluginsConfig(workDir: string): Array<{ type: 'local'; path: string }> {
  const plugins: Array<{ type: 'local'; path: string }> = []
```

**位置**: `src/main/services/agent.service.ts:634`

## Proposed Solutions

### Solution 1: 提取类型定义 (Recommended)
**描述**:
```typescript
// 在文件顶部或 types.ts 中定义
type PluginConfig = { type: 'local'; path: string }

function buildPluginsConfig(workDir: string): PluginConfig[] {
  const plugins: PluginConfig[] = []
  // ...
}
```
**优点**:
- 类型复用
- 易于扩展（如添加 remote 类型）
**缺点**: 无
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] 类型定义被提取为命名类型
- [ ] 所有使用处引用该类型

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 代码质量审查发现问题 | 类型复用提高可维护性 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
