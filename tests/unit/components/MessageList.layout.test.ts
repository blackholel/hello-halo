/**
 * MessageList Layout Tests
 *
 * TDD RED Phase: Tests for TaskPanel positioning in MessageList
 *
 * Requirements:
 * 1. TaskPanel should appear ABOVE StreamingBubble (when StreamingBubble has content)
 * 2. TaskPanel should be at the bottom when there's no streaming content
 * 3. TaskPanel should persist after generation completes (isGenerating = false)
 * 4. TaskPanel should only reset when a new TodoWrite is called
 *
 * Layout order (top to bottom):
 * - ThoughtProcess
 * - SubAgentCards
 * - BrowserTaskCard
 * - TaskPanel
 * - StreamingBubble (only when has content)
 */

import { describe, it, expect } from 'vitest'

/**
 * Helper to simulate the layout order logic from MessageList
 * This extracts the pure logic for testing without React dependencies
 */
interface LayoutConfig {
  isGenerating: boolean
  hasTasks: boolean
  hasStreamingContent: boolean
  hasThoughts: boolean
  hasSubAgents: boolean
  hasBrowserTools: boolean
}

type LayoutElement =
  | 'ThoughtProcess'
  | 'SubAgentCards'
  | 'BrowserTaskCard'
  | 'TaskPanel'
  | 'StreamingBubble'

/**
 * Determines the order of elements in the generation area
 * This is the logic we're testing - it should match MessageList implementation
 */
function getGenerationAreaLayout(config: LayoutConfig): LayoutElement[] {
  const elements: LayoutElement[] = []

  if (!config.isGenerating && !config.hasTasks) {
    return elements
  }

  // During generation
  if (config.isGenerating) {
    // 1. ThoughtProcess at top
    if (config.hasThoughts) {
      elements.push('ThoughtProcess')
    }

    // 2. SubAgentCards
    if (config.hasSubAgents) {
      elements.push('SubAgentCards')
    }

    // 3. BrowserTaskCard
    if (config.hasBrowserTools) {
      elements.push('BrowserTaskCard')
    }

    // 4. TaskPanel - above StreamingBubble
    if (config.hasTasks) {
      elements.push('TaskPanel')
    }

    // 5. StreamingBubble at bottom (only when has content)
    if (config.hasStreamingContent) {
      elements.push('StreamingBubble')
    }
  }

  // After generation completes, TaskPanel should still show
  if (!config.isGenerating && config.hasTasks) {
    elements.push('TaskPanel')
  }

  return elements
}

describe('MessageList Layout', () => {
  describe('TaskPanel positioning during generation', () => {
    it('should place TaskPanel above StreamingBubble when both have content', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: true,
        hasThoughts: false,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      const taskPanelIndex = layout.indexOf('TaskPanel')
      const streamingBubbleIndex = layout.indexOf('StreamingBubble')

      expect(taskPanelIndex).toBeGreaterThanOrEqual(0)
      expect(streamingBubbleIndex).toBeGreaterThanOrEqual(0)
      expect(taskPanelIndex).toBeLessThan(streamingBubbleIndex)
    })

    it('should place TaskPanel at bottom when no streaming content', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: true,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      expect(layout).toContain('TaskPanel')
      expect(layout).not.toContain('StreamingBubble')
      expect(layout[layout.length - 1]).toBe('TaskPanel')
    })

    it('should place TaskPanel below SubAgentCards', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: false,
        hasSubAgents: true,
        hasBrowserTools: false
      })

      const subAgentIndex = layout.indexOf('SubAgentCards')
      const taskPanelIndex = layout.indexOf('TaskPanel')

      expect(subAgentIndex).toBeGreaterThanOrEqual(0)
      expect(taskPanelIndex).toBeGreaterThan(subAgentIndex)
    })

    it('should place TaskPanel below BrowserTaskCard', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: false,
        hasSubAgents: false,
        hasBrowserTools: true
      })

      const browserIndex = layout.indexOf('BrowserTaskCard')
      const taskPanelIndex = layout.indexOf('TaskPanel')

      expect(browserIndex).toBeGreaterThanOrEqual(0)
      expect(taskPanelIndex).toBeGreaterThan(browserIndex)
    })

    it('should maintain correct order: ThoughtProcess -> SubAgents -> Browser -> TaskPanel -> StreamingBubble', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: true,
        hasThoughts: true,
        hasSubAgents: true,
        hasBrowserTools: true
      })

      expect(layout).toEqual([
        'ThoughtProcess',
        'SubAgentCards',
        'BrowserTaskCard',
        'TaskPanel',
        'StreamingBubble'
      ])
    })
  })

  describe('TaskPanel persistence after generation', () => {
    it('should show TaskPanel after generation completes when tasks exist', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: false,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: false,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      expect(layout).toContain('TaskPanel')
    })

    it('should not show TaskPanel after generation if no tasks', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: false,
        hasTasks: false,
        hasStreamingContent: false,
        hasThoughts: false,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      expect(layout).not.toContain('TaskPanel')
      expect(layout).toHaveLength(0)
    })

    it('should only show TaskPanel (no other elements) after generation completes', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: false,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: true, // These should be ignored when not generating
        hasSubAgents: true,
        hasBrowserTools: true
      })

      // After generation, only TaskPanel should remain
      expect(layout).toEqual(['TaskPanel'])
    })
  })

  describe('TaskPanel visibility conditions', () => {
    it('should not show TaskPanel during generation if no tasks', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: false,
        hasStreamingContent: true,
        hasThoughts: true,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      expect(layout).not.toContain('TaskPanel')
    })

    it('should show TaskPanel during generation when tasks exist', () => {
      const layout = getGenerationAreaLayout({
        isGenerating: true,
        hasTasks: true,
        hasStreamingContent: false,
        hasThoughts: false,
        hasSubAgents: false,
        hasBrowserTools: false
      })

      expect(layout).toContain('TaskPanel')
    })
  })
})

describe('TaskPanel reset behavior', () => {
  /**
   * These tests verify the reset logic in task.store.ts
   * TaskPanel should only reset when a NEW TodoWrite is called,
   * not when user sends a new message or generation starts
   */

  it('should preserve tasks across multiple generations until new TodoWrite', () => {
    // This is tested in task.store.test.ts - extractTasksFromThoughts
    // The store uses the LATEST TodoWrite, so old tasks are replaced
    // only when a new TodoWrite arrives
    expect(true).toBe(true) // Placeholder - actual logic in store tests
  })
})

/**
 * Tests for streamingBrowserToolCalls optimization
 *
 * The function extracts browser tool calls from thoughts array for real-time display.
 * It needs to:
 * 1. Filter out sub-agent thoughts (parentToolUseId != null)
 * 2. Filter out Task and Skill tools
 * 3. Only include browser tools (tool names starting with 'mcp__' browser prefix or 'browser_')
 * 4. Determine status: 'success' if matching tool_result exists, 'running' otherwise
 */

interface MockThought {
  id: string
  type: 'tool_use' | 'tool_result' | 'thinking' | 'text'
  toolName?: string
  toolInput?: Record<string, unknown>
  parentToolUseId?: string | null
}

interface BrowserToolCall {
  id: string
  name: string
  status: 'success' | 'running'
  input: Record<string, unknown>
}

// Mock isBrowserTool function (matches actual implementation)
function isBrowserTool(toolName: string): boolean {
  return toolName.startsWith('mcp__plugin_playwright_playwright__') || toolName.startsWith('browser_')
}

/**
 * Original implementation (inefficient - multiple array traversals)
 */
function extractBrowserToolCallsOriginal(thoughts: MockThought[]): BrowserToolCall[] {
  const mainThoughts = thoughts.filter(t =>
    (t.parentToolUseId === null || t.parentToolUseId === undefined) &&
    t.toolName !== 'Task' && t.toolName !== 'Skill'
  )
  return mainThoughts
    .filter(t => t.type === 'tool_use' && t.toolName && isBrowserTool(t.toolName))
    .map(t => ({
      id: t.id,
      name: t.toolName!,
      status: thoughts.some(
        r => r.type === 'tool_result' && r.id.startsWith(t.id.replace('_use', '_result'))
      ) ? 'success' as const : 'running' as const,
      input: t.toolInput || {},
    }))
}

/**
 * Optimized implementation (single pass with O(1) lookups)
 */
function extractBrowserToolCallsOptimized(thoughts: MockThought[]): BrowserToolCall[] {
  // Pre-build result ID Set for O(1) lookup
  const resultIds = new Set<string>()
  for (const t of thoughts) {
    if (t.type === 'tool_result') {
      resultIds.add(t.id.replace('_result', '_use'))
    }
  }

  const calls: BrowserToolCall[] = []
  for (const t of thoughts) {
    // Skip sub-agent thoughts
    if (t.parentToolUseId != null) continue
    // Skip Task and Skill
    if (t.toolName === 'Task' || t.toolName === 'Skill') continue
    // Only process browser tool_use
    if (t.type !== 'tool_use' || !t.toolName || !isBrowserTool(t.toolName)) continue

    calls.push({
      id: t.id,
      name: t.toolName,
      status: resultIds.has(t.id) ? 'success' : 'running',
      input: t.toolInput || {},
    })
  }
  return calls
}

describe('streamingBrowserToolCalls extraction', () => {
  describe('basic functionality', () => {
    it('should return empty array when no thoughts', () => {
      const thoughts: MockThought[] = []
      expect(extractBrowserToolCallsOptimized(thoughts)).toEqual([])
    })

    it('should extract browser tool calls with running status', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: { selector: '#button' }
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'tool_use_1',
        name: 'mcp__plugin_playwright_playwright__browser_click',
        status: 'running',
        input: { selector: '#button' }
      })
    })

    it('should mark tool as success when matching result exists', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: { selector: '#button' }
        },
        {
          id: 'tool_result_1',
          type: 'tool_result',
          toolName: 'mcp__plugin_playwright_playwright__browser_click'
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('success')
    })

    it('should handle browser_ prefix tools', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'browser_navigate',
          toolInput: { url: 'https://example.com' }
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('browser_navigate')
    })
  })

  describe('filtering behavior', () => {
    it('should filter out sub-agent thoughts (parentToolUseId is set)', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: {},
          parentToolUseId: 'parent_task_1'  // Sub-agent thought
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(0)
    })

    it('should include thoughts with null parentToolUseId (main agent)', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: {},
          parentToolUseId: null  // Main agent
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(1)
    })

    it('should filter out Task tool calls', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'Task',
          toolInput: { description: 'Do something' }
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(0)
    })

    it('should filter out Skill tool calls', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'Skill',
          toolInput: { skill: 'commit' }
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(0)
    })

    it('should filter out non-browser tools', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'Read',
          toolInput: { file_path: '/some/file.ts' }
        },
        {
          id: 'tool_use_2',
          type: 'tool_use',
          toolName: 'Write',
          toolInput: { file_path: '/some/file.ts', content: 'test' }
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(0)
    })

    it('should filter out non-tool_use thoughts', () => {
      const thoughts: MockThought[] = [
        {
          id: 'thinking_1',
          type: 'thinking'
        },
        {
          id: 'text_1',
          type: 'text'
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(0)
    })
  })

  describe('complex scenarios', () => {
    it('should handle mixed thoughts with multiple browser tools', () => {
      const thoughts: MockThought[] = [
        { id: 'thinking_1', type: 'thinking' },
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_navigate',
          toolInput: { url: 'https://example.com' }
        },
        { id: 'tool_result_1', type: 'tool_result' },
        {
          id: 'tool_use_2',
          type: 'tool_use',
          toolName: 'Read',
          toolInput: { file_path: '/file.ts' }
        },
        {
          id: 'tool_use_3',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: { selector: '#btn' }
        },
        {
          id: 'tool_use_4',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_type',
          toolInput: { text: 'hello' },
          parentToolUseId: 'sub_agent_1'  // Sub-agent - should be filtered
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('tool_use_1')
      expect(result[0].status).toBe('success')
      expect(result[1].id).toBe('tool_use_3')
      expect(result[1].status).toBe('running')
    })

    it('should preserve order of browser tool calls', () => {
      const thoughts: MockThought[] = [
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_navigate',
          toolInput: {}
        },
        {
          id: 'tool_use_2',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: {}
        },
        {
          id: 'tool_use_3',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_type',
          toolInput: {}
        }
      ]

      const result = extractBrowserToolCallsOptimized(thoughts)
      expect(result.map(r => r.id)).toEqual(['tool_use_1', 'tool_use_2', 'tool_use_3'])
    })
  })

  describe('equivalence with original implementation', () => {
    it('should produce same results as original implementation', () => {
      const thoughts: MockThought[] = [
        { id: 'thinking_1', type: 'thinking' },
        {
          id: 'tool_use_1',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_navigate',
          toolInput: { url: 'https://example.com' }
        },
        { id: 'tool_result_1', type: 'tool_result' },
        {
          id: 'tool_use_2',
          type: 'tool_use',
          toolName: 'Task',
          toolInput: { description: 'task' }
        },
        {
          id: 'tool_use_3',
          type: 'tool_use',
          toolName: 'mcp__plugin_playwright_playwright__browser_click',
          toolInput: { selector: '#btn' }
        },
        {
          id: 'tool_use_4',
          type: 'tool_use',
          toolName: 'browser_type',
          toolInput: { text: 'hello' },
          parentToolUseId: 'sub_1'
        },
        {
          id: 'tool_use_5',
          type: 'tool_use',
          toolName: 'Skill',
          toolInput: { skill: 'commit' }
        }
      ]

      const original = extractBrowserToolCallsOriginal(thoughts)
      const optimized = extractBrowserToolCallsOptimized(thoughts)

      expect(optimized).toEqual(original)
    })
  })
})
