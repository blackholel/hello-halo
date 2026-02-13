/**
 * SDK Message Parser
 *
 * Parses SDK messages into Thought objects for the UI.
 * Pure functions, easy to test.
 */

import type { Thought, ThoughtType, CanvasContext, ImageAttachment } from './types'

interface ParseSDKMessageOptions {
  nextLocalToolCallId?: () => string
}

/**
 * Generate a unique thought ID
 */
function generateId(): string {
  return `thought-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Format Canvas Context for injection into user message
 * Returns empty string if no meaningful context to inject
 */
export function formatCanvasContext(canvasContext?: CanvasContext): string {
  if (!canvasContext?.isOpen || canvasContext.tabCount === 0) {
    return ''
  }

  const activeTab = canvasContext.activeTab
  const tabsSummary = canvasContext.tabs
    .map(
      (t) =>
        `${t.isActive ? '▶ ' : '  '}${t.title} (${t.type})${t.path ? ` - ${t.path}` : ''}${t.url ? ` - ${t.url}` : ''}`
    )
    .join('\n')

  return `<kite_canvas>
Content canvas currently open in Kite:
- Total ${canvasContext.tabCount} tabs
- Active: ${activeTab ? `${activeTab.title} (${activeTab.type})` : 'None'}
${activeTab?.url ? `- URL: ${activeTab.url}` : ''}${activeTab?.path ? `- File path: ${activeTab.path}` : ''}

All tabs:
${tabsSummary}
</kite_canvas>

`
}

/**
 * Build multi-modal message content for Claude API
 */
export function buildMessageContent(
  text: string,
  images?: ImageAttachment[]
): string | Array<{ type: string; [key: string]: unknown }> {
  // If no images, just return plain text
  if (!images || images.length === 0) {
    return text
  }

  // Build content blocks array for multi-modal message
  const contentBlocks: Array<{ type: string; [key: string]: unknown }> = []

  // Add text block first (if there's text)
  if (text.trim()) {
    contentBlocks.push({
      type: 'text',
      text: text
    })
  }

  // Add image blocks
  for (const image of images) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data
      }
    })
  }

  return contentBlocks
}

/**
 * Parse SDK message into a Thought object
 * Extracts parent_tool_use_id for sub-agent nesting support
 */
function resolveToolCallId(
  rawId: unknown,
  options?: ParseSDKMessageOptions
): string {
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    return rawId
  }
  if (options?.nextLocalToolCallId) {
    return options.nextLocalToolCallId()
  }
  return generateId()
}

/**
 * Parse SDK message into Thought objects.
 * Some SDK messages contain multiple content blocks, all blocks are preserved in order.
 */
export function parseSDKMessages(message: any, options?: ParseSDKMessageOptions): Thought[] {
  const timestamp = new Date().toISOString()
  const thoughts: Thought[] = []

  // Extract parent_tool_use_id for sub-agent nesting (all message types may have this)
  const parentToolUseId = message.parent_tool_use_id ?? null

  // System initialization and new message types (SDK 0.2.22+)
  if (message.type === 'system') {
    if (message.subtype === 'init') {
      thoughts.push({
        id: generateId(),
        type: 'system',
        content: `Connected | Model: ${message.model || 'claude'}`,
        timestamp,
        parentToolUseId
      })
      return thoughts
    }
    // Hook started (new in 0.2.22)
    if (message.subtype === 'hook_started') {
      thoughts.push({
        id: `${message.hook_id || generateId()}-started`,
        type: 'system',
        content: `Hook started: ${message.hook_name} (${message.hook_event})`,
        timestamp,
        parentToolUseId
      })
      return thoughts
    }
    // Hook progress (new in 0.2.22)
    if (message.subtype === 'hook_progress') {
      thoughts.push({
        id: `${message.hook_id || generateId()}-progress`,
        type: 'system',
        content: message.output || message.stdout || `Hook progress: ${message.hook_name}`,
        timestamp,
        parentToolUseId
      })
      return thoughts
    }
    // Hook response (new in 0.2.22, includes outcome field)
    if (message.subtype === 'hook_response') {
      const outcome = message.outcome || 'success'
      thoughts.push({
        id: `${message.hook_id || generateId()}-response`,
        type: 'system',
        content: `Hook ${outcome}: ${message.hook_name}${message.output ? ` - ${message.output}` : ''}`,
        timestamp,
        parentToolUseId
      })
      return thoughts
    }
    // Task notification (new in 0.2.22) - background task status
    if (message.subtype === 'task_notification') {
      thoughts.push({
        id: `${message.task_id || generateId()}-${message.status}`,
        type: 'system',
        content: `Task ${message.status}: ${message.summary || message.task_id}`,
        timestamp,
        parentToolUseId
      })
      return thoughts
    }
    return thoughts
  }

  // Tool use summary (new in 0.2.22)
  if (message.type === 'tool_use_summary') {
    thoughts.push({
      id: generateId(),
      type: 'system',
      content: message.summary || 'Tool execution summary',
      timestamp,
      parentToolUseId
    })
    return thoughts
  }

  // Assistant messages (thinking, tool_use, text blocks)
  if (message.type === 'assistant') {
    const content = message.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        // Thinking blocks
        if (block.type === 'thinking') {
          thoughts.push({
            id: generateId(),
            type: 'thinking',
            content: block.thinking || '',
            timestamp,
            parentToolUseId
          })
          continue
        }
        // Tool use blocks
        if (block.type === 'tool_use') {
          const isTaskTool = block.name === 'Task'
          const toolUseId = resolveToolCallId(block.id, options)
          thoughts.push({
            id: toolUseId,
            type: 'tool_use',
            content: isTaskTool
              ? `Sub-agent: ${block.input?.description || 'Task'}`
              : `Tool call: ${block.name}`,
            timestamp,
            toolName: block.name,
            toolInput: block.input,
            parentToolUseId,
            status: 'running',
            // Add agent metadata for Task tool
            ...(isTaskTool && {
              agentMeta: {
                description: block.input?.description || '',
                prompt: block.input?.prompt,
                subagentType: block.input?.subagent_type
              }
            })
          })
          continue
        }
        // Text blocks
        if (block.type === 'text') {
          thoughts.push({
            id: generateId(),
            type: 'text',
            content: block.text || '',
            timestamp,
            parentToolUseId
          })
        }
      }
    }
    return thoughts
  }

  // User messages (tool results or command output)
  if (message.type === 'user') {
    const content = message.message?.content

    // Handle slash command output: <local-command-stdout>...</local-command-stdout>
    // These are returned as user messages with isReplay: true
    if (typeof content === 'string') {
      const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
      if (match) {
        thoughts.push({
          id: generateId(),
          type: 'text', // Render as text block (will show in assistant bubble)
          content: match[1].trim(),
          timestamp,
          parentToolUseId
        })
      }
      return thoughts
    }

    // Handle tool results (array content)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result') {
          const isError = block.is_error || false
          const resultContent =
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          const toolResultId = resolveToolCallId(block.tool_use_id, options)
          thoughts.push({
            id: toolResultId,
            type: 'tool_result',
            content: isError ? `Tool execution failed` : `Tool execution succeeded`,
            timestamp,
            toolOutput: resultContent,
            isError,
            parentToolUseId,
            status: isError ? 'error' : 'success'
          })
        }
      }
    }
    return thoughts
  }

  // Final result
  if (message.type === 'result') {
    thoughts.push({
      id: generateId(),
      type: 'result',
      content: message.message?.result || message.result || '',
      timestamp,
      duration: message.duration_ms,
      parentToolUseId
    })
    return thoughts
  }

  return thoughts
}

/**
 * Backward-compatible single-thought parser.
 */
export function parseSDKMessage(message: any, options?: ParseSDKMessageOptions): Thought | null {
  const thoughts = parseSDKMessages(message, options)
  return thoughts.length > 0 ? thoughts[0] : null
}
