---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, quality]
dependencies: []
---

# buildPluginsConfig 缺乏错误处理

## Problem Statement

`buildPluginsConfig()` 函数假设 `workDir` 和 `getKiteDir()` 总是返回有效路径，但没有处理：
1. `workDir` 为空字符串或 undefined 的情况
2. `getKiteDir()` 返回无效路径的情况
3. `existsSync` 可能抛出的异常（如权限问题）

## Findings

**来源**: 代码质量审查代理

**证据**:
```typescript
const appSkillsPath = join(getKiteDir(), 'skills')
if (existsSync(appSkillsPath)) {
  // 没有 try-catch
```

**位置**: `src/main/services/agent.service.ts:634-659`

## Proposed Solutions

### Solution 1: 添加 try-catch 和参数验证 (Recommended)
**描述**:
```typescript
function buildPluginsConfig(workDir: string): PluginConfig[] {
  const plugins: PluginConfig[] = []

  // App-level skills
  try {
    const kiteDir = getKiteDir()
    if (kiteDir) {
      const appSkillsPath = join(kiteDir, 'skills')
      if (existsSync(appSkillsPath)) {
        plugins.push({ type: 'local', path: appSkillsPath })
      }
    }
  } catch (e) {
    console.warn('[Agent] Failed to check app-level skills', e)
  }

  // Space-level skills
  if (workDir) {
    try {
      const spaceSkillsPath = join(workDir, '.claude')
      if (existsSync(spaceSkillsPath)) {
        plugins.push({ type: 'local', path: spaceSkillsPath })
      }
    } catch (e) {
      console.warn('[Agent] Failed to check space-level skills', e)
    }
  }

  return plugins
}
```
**优点**: 健壮性高
**缺点**: 代码稍长
**工作量**: Small
**风险**: Low

## Recommended Action

<!-- 待 triage 时填写 -->

## Technical Details

**Affected Files**:
- `src/main/services/agent.service.ts`

**Components**: Agent Service

## Acceptance Criteria

- [ ] 无效输入不会导致崩溃
- [ ] 文件系统错误被捕获并记录

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-17 | 代码质量审查发现问题 | 防御性编程很重要 |

## Resources

- 变更文件: `src/main/services/agent.service.ts`
