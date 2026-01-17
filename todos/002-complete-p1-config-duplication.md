---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, architecture, maintainability]
dependencies: []
---

# sdkOptions 配置重复导致潜在不一致性

## Problem Statement

`buildPluginsConfig(workDir)` 在两处被调用，且两处的 `sdkOptions` 配置几乎完全相同（约 40 行重复代码）：
- `ensureSessionWarm()` (第 522 行)
- `sendMessage()` (第 1137 行)

这导致：
1. 修改一处忘记修改另一处，导致 warm-up 和实际发送时配置不一致
2. Session 可能因配置差异被意外重建
3. 维护成本高，容易引入 bug

## Findings

**来源**: 架构审查代理

**证据**:
两处配置包含相同的：
- `settingSources: []`
- `plugins: buildPluginsConfig(workDir)`
- `env` 配置
- `systemPrompt` 配置
- `allowedTools`、`permissionMode` 等

**位置**:
- `src/main/services/agent.service.ts:516-580` (ensureSessionWarm)
- `src/main/services/agent.service.ts:1130-1200` (sendMessage)

## Proposed Solutions

### Solution 1: 抽取为独立函数 (Recommended)
**描述**: 创建 `buildSdkOptions()` 函数统一配置构建
```typescript
function buildSdkOptions(
  spaceId: string,
  conversationId: string,
  workDir: string,
  config: AppConfig,
  options?: { aiBrowserEnabled?: boolean; thinkingEnabled?: boolean }
): Record<string, any> {
  // 共享配置逻辑
  return sdkOptions
}
```
**优点**:
- 消除重复
- 保证一致性
- 易于维护
**缺点**: 需要重构两处代码
**工作量**: Medium
**风险**: Low

### Solution 2: 配置对象常量化
**描述**: 将共享配置提取为模块级常量
**优点**: 简单
**缺点**: 动态配置（如 workDir）仍需处理
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] `ensureSessionWarm()` 和 `sendMessage()` 使用相同的配置构建逻辑
- [ ] 配置变更只需修改一处
- [ ] 现有功能不受影响

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 架构审查发现问题 | 配置重复是维护隐患 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
