---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, security]
dependencies: []
---

# Space-level Skills 供应链攻击风险

## Problem Statement

当前设计允许从 `{workDir}/.claude/` 加载 Space-level skills，且优先级高于 app-level。这存在供应链攻击风险：
- 用户克隆恶意仓库时，`.claude/` 目录中可能包含恶意 skills
- 恶意 skills 可以覆盖 app-level 的同名 skill
- 没有对 skills 内容进行完整性或来源验证

## Findings

**来源**: 安全审查代理

**证据**:
```typescript
// 注释表明 space-level 优先级更高
// 2. Space-level skills (higher priority, can override app-level)
const spaceSkillsPath = join(workDir, '.claude')
```

**位置**: `src/main/services/agent.service.ts:648-655`

## Proposed Solutions

### Solution 1: 首次加载确认机制 (Recommended)
**描述**: 首次加载项目级 skills 时提示用户确认
**优点**: 用户知情同意
**缺点**: 增加用户操作步骤
**工作量**: Medium
**风险**: Low

### Solution 2: Skills 白名单机制
**描述**: 只允许加载已批准的 skills
**优点**: 安全性高
**缺点**: 灵活性降低
**工作量**: Medium
**风险**: Low

### Solution 3: UI 显示 Skills 来源
**描述**: 在 UI 中显示当前加载的 skills 及其来源
**优点**: 透明度高
**缺点**: 不能阻止攻击，只能事后发现
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`
- 可能需要新增 UI 组件

**Components**: Agent Service, UI

## Acceptance Criteria

- [ ] 用户能够知道当前加载了哪些 skills 及来源
- [ ] 首次加载项目级 skills 时有确认机制（可选）

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 安全审查发现问题 | 项目级配置是供应链攻击向量 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
