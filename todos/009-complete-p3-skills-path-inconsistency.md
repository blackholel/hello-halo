---
status: pending
priority: p3
issue_id: "009"
tags: [code-review, architecture]
dependencies: []
---

# Space 级 Skills 路径设计不一致

## Problem Statement

应用级和 Space 级的 Skills 路径设计不一致：
- 应用级：`~/.halo/skills/` (专门的 skills 目录)
- Space 级：`{workDir}/.claude/` (整个 .claude 目录)

这意味着 Space 级会加载整个 `.claude` 目录作为 plugin，而不仅仅是 skills。

## Findings

**来源**: 架构审查代理

**证据**:
```typescript
const appSkillsPath = join(getHaloDir(), 'skills')  // ~/.halo/skills/
const spaceSkillsPath = join(workDir, '.claude')     // {workDir}/.claude/
```

**位置**: `src/main/services/agent.service.ts:640, 648`

## Proposed Solutions

### Solution 1: 统一使用 skills 子目录
**描述**:
```typescript
const spaceSkillsPath = join(workDir, '.claude', 'skills')
```
**优点**: 路径结构一致
**缺点**: 可能与 Claude Code CLI 的约定不同
**工作量**: Small
**风险**: Low

### Solution 2: 保持现状并文档化
**描述**: 在代码注释和用户文档中说明差异原因
**优点**: 无需改动
**缺点**: 不一致性仍存在
**工作量**: Small
**风险**: Low

## Recommended Ac 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] 路径设计一致或差异被文档化

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 架构审查发现问题 | 一致性有助于理解 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
