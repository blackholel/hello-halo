# SkillCard 组件与 Timeline 分段渲染

## 概述

本文档描述了 Kite 中 Skill 调用和 SubAgent 调用的 UI 渲染机制，包括设计理念、数据流、实现细节和修复历史。

## 设计理念

### 问题背景

在 Claude Agent SDK 中，AI 可以调用多种工具，其中包括：
- **Skill 工具**：执行预定义的技能（如 `/tdd-workflow`、`/commit` 等）
- **Task 工具**：启动子代理（SubAgent）执行复杂任务

原有实现将 `thoughts` 数组分成两组独立渲染：
1. `mainAgentThoughts` - 主代理的思考过程
2. `subAgents` - 子代理卡片

这种方式**丢失了原始时间顺序**，导致 Skill 和 SubAgent 调用无法按实际执行顺序交替显示。

### 解决方案：Segment-Based Rendering

采用分段渲染机制，将 `thoughts` 数组按时间顺序分割成多个 segment，每个 segment 对应一种渲染组件：

```
ThoughtProcess (thoughts 1-5)
    ↓
SkillCard (/tdd-workflow)  ← 按调用顺序插入
    ↓
ThoughtProcess (thoughts 6-10)
    ↓
SubAgentCard (代码审查)  ← 按调用顺序插入
    ↓
ThoughtProcess (thoughts 11-15)
    ↓
TaskPanel (始终在最底部)
```

## 数据结构

### Thought 类型

```typescript
interface Thought {
  id: string
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'system' | 'result' | 'error'
  content: string
  timestamp: string
  toolName?: string           // 工具名称（如 'Skill', 'Task', 'Read' 等）
  toolInput?: Record<string, unknown>  // 工具输入参数
  toolOutput?: string         // 工具输出结果（实际内容）
  isError?: boolean           // 是否执行失败
  parentToolUseId?: string    // 父工具 ID（用于子代理的 thoughts）
  status?: 'pending' | 'running' | 'success' | 'error'
}
```

### Timeline Segment 类型

```typescript
// 思考过程段
interface ThoughtsSegment {
  id: string
  type: 'thoughts'
  startIndex: number
  thoughts: Thought[]
}

// Skill 调用段
interface SkillSegment {
  id: string
  type: 'skill'
  startIndex: number
  skillId: string
  skillName: string      // 技能名称（如 'tdd-workflow'）
  skillArgs?: string     // 技能参数
  isRunning: boolean     // 是否正在执行
  hasError: boolean      // 是否执行失败
  result?: string        // 执行结果
}

// 子代理段
interface SubAgentSegment {
  id: string
  type: 'subagent'
  startIndex: number
  agentId: string
  description: string    // 子代理描述
  subagentType?: string  // 子代理类型（如 'code-reviewer'）
  thoughts: Thought[]    // 子代理的 thoughts
  isRunning: boolean
  hasError: boolean
}

type TimelineSegment = ThoughtsSegment | SkillSegment | SubAgentSegment
```

## 核心算法：buildTimelineSegments

### 算法流程

```
输入: thought的 thought 数组
输出: TimelineSegment[] - 分段后的 segment 数组

1. 第一遍扫描：收集子代理的 child thoughts
   - 遍历 thoughts，将 parentToolUseId 不为空的 thought 归类到对应的子代理

2. 第二遍扫描：按顺序构建 segments
   - 遍历 thoughts（跳过 child thoughts）
   - 遇到 Skill tool_use → 创建 SkillSegment
   - 遇到 Task tool_use → 创建 SubAgentSegment
   - 其他 thoughts → 累积到当前 ThoughtsSegment
   - 遇到 Skill/Task 时，先 flush 累积的 thoughts

3. 最后 flush 剩余的 thoughts
```

### 代码实现

```typescript
export function buildTimelineSegments(thoughts: Thought[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let currentThoughts: Thought[] = []
  let segmentIndex = 0

  // 第一遍：收集子代理的 child thoughts
  const subAgentChildMap = new Map<string, Thought[]>()
  thoughts.forEach(t => {
    if (t.parentToolUseId) {
      const children = subAgentChildMap.get(t.parentToolUseId) || []
      children.push(t)
      subAgentChildMap.set(t.parentToolUseId, children)
    }
  })

  // Helper: flush 累积的 thoughts
  const flushThoughts = () => {
    if (currentThoughts.length > 0) {
      segments.push({
        id: `thoughts-${segmentIndex}`,
        type: 'thoughts',
        startIndex: segmentIndex,
        thoughts: currentThoughts
      })
      segmentIndex++
      currentThoughts = []
    }
  }

  // 第二遍：按顺序构建 segments
  thoughts.forEach((thought) => {
    // 跳过 child thoughts
    if (thought.parentToolUseId) return

    // 处理 Skill 工具调用
    if (thought.toolName === 'Skill' && thought.type === 'tool_use') {
      flushThoughts()

      const resultThought = thoughts.find(
        t => t.type === 'tool_result' && t.id === thought.id
      )

      segments.push({
        id: `skill-${thought.id}`,
        type: 'skill',
        skillId: thought.id,
        skillName: thought.toolInput?.skill as string || 'unknown',
        skillArgs: thought.toolInput?.args as string,
        isRunning: !resultThought,
        hasError: resultThought?.isError || false,
        result: resultThought?.toolOutput || resultThought?.content
      })
      return
    }

    // 处理 Task 工具调用（子代理）
    if (thought.toolName === 'Task' && thought.type === 'tool_use') {
      flushThoughts()

      const resultThought = thoughts.find(
        t => t.type === 'tool_result' && t.id === thought.id
      )
      const childThoughts = subAgentChildMap.get(thought.id) || []

      segments.push({
        id: `subagent-${thought.id}`,
        type: 'subagent',
        agentId: thought.id,
        description: thought.agentMeta?.description || thought.toolInput?.description,
        subagentType: thought.agentMeta?.subagentType,
        thoughts: childThoughts,
        isRunning: !resultThought,
        hasError: childThoughts.some(t => t.isError) || resultThought?.isError
      })
      return
    }

    // 跳过 Skill/Task 的 tool_result（已在上面处理）
    if (thought.type === 'tool_result') {
      const useThought = thoughts.find(t => t.type === 'tool_use' && t.id === thought.id)
      if (useThought?.toolName === 'Skill' || useThought?.toolName === 'Task') return
    }

    // 累积普通 thoughts
    currentThoughts.push(thought)
  })

  flushThoughts()
  return segments
}
```

## 渲染流程

### MessageList.tsx 渲染逻辑

```tsx
// 构建 timeline segments
const timelineSegments = useMemo(() => {
  return buildTimelineSegments(thoughts)
}, [thoughts])

// 渲染 segments
{timelineSegments.map((segment, index) => {
  const isLastSegment = index === timelineSegments.length - 1

  switch (segment.type) {
    case 'thoughts':
      return (
        <ThoughtProcess
          key={segment.id}
          thoughts={segment.thoughts}
          isThinking={isLastSegment && isThinking}
          mode="realtime"
        />
      )

    case 'skill':
      return (
        <SkillCard
          key={segment.id}
          skillId={segment.skillId}
          skillName={segment.skillName}
          skillArgs={segment.skillArgs}
          isRunning={segment.isRunning}
          hasError={segment.hasError}
          result={segment.result}
        />
      )

    case 'subagent':
      return (
        <SubAgentCard
          key={segment.id}
          agentId={segment.agentId}
          description={segment.description}
          subagentType={segment.subagentType}
          thoughts={segment.thoughts}
          isRunning={segment.isRunning}
          hasError={segment.hasError}
        />
      )
  }
})}
```

## SkillCard 组件

### UI 设计

SkillCard 的 UI 设计与 SubAgentCard 保持一致：

```
┌─────────────────────────────────────────────┐
│█│ ▶ ⚡ /skill-name args...        [状态图标] │  ← 头部（可点击展开）
│█│   Running skill... / 结果预览              │  ← 折叠摘要
│█├───────────────────────────────────────────│
│█│   展开后的完整结果内容                      │  ← 展开内容
└─────────────────────────────────────────────┘
 ↑
 左侧颜色条：蓝色(运行中) / 绿色(成功) / 红色(失败)
```

### 状态指示

| 状态 | 左侧颜色条 | 边框颜色 | 图标 |
|------|-----------|---------|------|
| 运行中 | 蓝色 | 蓝色/50 | Loader2 (旋转) |
| 成功 | 绿色 | 绿色/50 | CheckCircle2 |
| 失败 | 红色 | 红色/50 | XCircle |

### 摘要文本逻辑

```typescript
const getSummaryText = (): string => {
  if (isRunning) {
    return t('Running skill...')
  }
  if (hasError) {
    // 显示实际错误信息（如果有）
    if (result) {
      return truncateText(result.split('\n')[0] || '', 60)
    }
    return t('Skill failed')
  }
  if (result) {
    return truncateText(result.split('\n')[0] || '', 60)
  }
  return t('Skill completed')
}
```

## SDK 数据流

### tool_use 事件

当 AI 调用 Skill 工具时，SDK 发送：

```typescript
{
  type: 'tool_use',
  id: 'toolu_xxx',
  name: 'Skill',
  input: {
    skill: 'tdd-workflow',
    args: '--verbose'
  }
}
```

转换为 Thought：

```typescript
{
  id: 'toolu_xxx',
  type: 'tool_use',
  toolName: 'Skill',
  toolInput: { skill: 'tdd-workflow', args: '--verbose' },
  content: 'Tool call: Skill'
}
```

### tool_result 事件

工具执行完成后，SDK 发送：

```typescript
{
  type: 'tool_result',
  tool_use_id: 'toolu_xxx',
  content: '...',  // 实际输出
  is_error: false
}
```

转换为 Thought：

```typescript
{
  id: 'toolu_xxx',  // 与 tool_use 的 id 相同
  type: 'tool_result',
  content: 'Tool execution succeeded',  // 状态描述
  toolOutput: '...',  // 实际输出内容
  isError: false
}
```

**重要**：`content` 是状态描述，`toolOutput` 才是实际的工具输出。

## 修复历史

### 问题 1：结果字段使用错误

**问题**：SkillCard 显示 "Tool execution failed" 而不是实际的错误信息。

**原因**：`buildTimelineSegments` 使用了 `content` 字段（状态描述）而不是 `toolOutput` 字段（实际结果）。

**修复**：
```typescript
// 修复前
result: resultThought?.content

// 修复后
result: resultThought?.toolOutput || resultThought?.content
```

### 问题 2：错误时不显示具体信息

**问题**：当 `hasError` 为 true 时，只显示通用的 "Skill failed"。

**修复**：
```typescript
if (hasError) {
  if (result) {
    return truncateText(result.split('\n')[0] || '', 60)
  }
  return t('Skill failed')
}
```

## 文件清单

| 文件 | 说明 |
|------|------|
| `src/renderer/utils/thought-utils.ts` | TimelineSegment 类型定义和 buildTimelineSegments 函数 |
| `src/renderer/components/chat/SkillCard.tsx` | Skill 调用卡片组件 |
| `src/renderer/components/chat/SubAgentCard.tsx` | 子代理卡片组件（参考） |
| `src/renderer/components/chat/MessageList.tsx` | 消息列表，使用 segment-based 渲染 |
| `src/main/services/agent.service.ts` | SDK 事件转换为 Thought |
| `tests/unit/utils/thought-utils.test.ts` | buildTimelineSegments 单元测试 |

## 测试用例

```typescript
describe('buildTimelineSegments', () => {
  it('should preserve order: thoughts -> skill -> thoughts -> subagent')
  it('should create SkillSegment for Skill tool calls')
  it('should create SubAgentSegment for Task tool calls')
  it('should mark running skill when no result yet')
  it('should mark hasError when skill result has error')
  it('should handle consecutive skill calls')
  it('should handle skill and subagent interleaved')
  it('should filter out empty thoughts segments')
})
```
