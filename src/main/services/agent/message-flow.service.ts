/**
 * Message Flow Service
 *
 * Core message sending and generation control logic.
 * Handles the main sendMessage flow and stopGeneration.
 */

import { BrowserWindow } from 'electron'
import { promises as fsPromises } from 'fs'
import { getConfig } from '../config.service'
import { getSpaceConfig } from '../space-config.service'
import { getToolkitHash } from '../toolkit.service'
import { getConversation, saveSessionId, addMessage, updateLastMessage } from '../conversation.service'
import {
  setMainWindow,
  sendToRenderer,
  createCanUseTool,
  normalizeAskUserQuestionInput
} from './renderer-comm'
import { getHeadlessElectronPath } from './electron-path'
import { resolveProvider } from './provider-resolver'
import {
  buildSdkOptions,
  getEffectiveSkillsLazyLoad,
  getWorkingDir,
  getEnabledMcpServers
} from './sdk-config.builder'
import { parseSDKMessage, formatCanvasContext, buildMessageContent } from './message-parser'
import { broadcastMcpStatus } from './mcp-status.service'
import { expandLazyDirectives } from './skill-expander'
import { findEnabledPluginByInput } from '../plugins.service'
import {
  beginChangeSet,
  clearPendingChangeSet,
  finalizeChangeSet,
  trackChangeFile
} from '../change-set.service'
import {
  buildPluginMcpServers,
  enablePluginMcp,
  getEnabledPluginMcpHash,
  getEnabledPluginMcpList,
  pluginHasMcp
} from '../plugin-mcp.service'
import {
  getOrCreateV2Session,
  closeV2Session,
  getActiveSession,
  setActiveSession,
  deleteActiveSession,
  getV2SessionInfo,
  getV2SessionsCount
} from './session.manager'
import type {
  AgentRequest,
  SessionState,
  SessionConfig,
  ToolCall,
  Thought
} from './types'

function trackChangeFileFromToolUse(
  conversationId: string,
  toolName: string | undefined,
  toolInput: { file_path?: string } | undefined
): void {
  if (toolName === 'Write' || toolName === 'Edit') {
    trackChangeFile(conversationId, toolInput?.file_path)
  }
}

interface McpDirectiveResult {
  text: string
  enabled: string[]
  missing: string[]
}

function extractMcpDirectives(input: string, conversationId: string): McpDirectiveResult {
  const lines = input.split(/\r?\n/)
  const enabled: string[] = []
  const missing: string[] = []
  let inFence = false

  const outLines = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      return line
    }
    if (inFence) return line

    const match = trimmed.match(/^\/mcp(?:\s+(.+))?$/i)
    if (!match) return line

    const pluginInput = (match[1] || '').trim()
    if (!pluginInput) {
      missing.push('(empty)')
      return '<!-- injected: mcp -->'
    }

    const plugin = findEnabledPluginByInput(pluginInput)
    if (!plugin) {
      missing.push(pluginInput)
      return '<!-- injected: mcp -->'
    }

    if (!pluginHasMcp(plugin)) {
      missing.push(pluginInput)
      return '<!-- injected: mcp -->'
    }

    enablePluginMcp(conversationId, plugin.fullName)
    enabled.push(plugin.fullName)
    return '<!-- injected: mcp -->'
  })

  return { text: outLines.join('\n'), enabled, missing }
}

/**
 * Send message to agent (supports multiple concurrent sessions)
 */
export async function sendMessage(
  mainWindow: BrowserWindow | null,
  request: AgentRequest
): Promise<void> {
  setMainWindow(mainWindow)

  const {
    spaceId,
    conversationId,
    message,
    resumeSessionId,
    images,
    aiBrowserEnabled,
    thinkingEnabled,
    planEnabled,
    canvasContext,
    fileContexts
  } = request
  const config = getConfig()
  const provider = config.api.provider
  const isMiniMax = provider === 'minimax'
  // MiniMax Anthropic-compatible backends can be strict; keep it text-only for stability.
  const effectiveAiBrowserEnabled = isMiniMax ? false : aiBrowserEnabled
  const effectiveThinkingEnabled = isMiniMax ? false : thinkingEnabled
  const effectiveImages = isMiniMax ? undefined : images
  if (isMiniMax) {
    if (aiBrowserEnabled) {
      console.warn(`[Agent][${conversationId}] MiniMax: AI Browser disabled (text-only mode)`)
    }
    if (thinkingEnabled) {
      console.warn(`[Agent][${conversationId}] MiniMax: Thinking disabled (compat mode)`)
    }
    if (images && images.length > 0) {
      console.warn(
        `[Agent][${conversationId}] MiniMax: Images dropped (${images.length}) (text-only mode)`
      )
    }
  }
  console.log(
    `[Agent] sendMessage: conv=${conversationId}${effectiveImages && effectiveImages.length > 0 ? `, images=${effectiveImages.length}` : ''}${effectiveAiBrowserEnabled ? ', AI Browser enabled' : ''}${effectiveThinkingEnabled ? ', thinking=ON' : ''}${canvasContext?.isOpen ? `, canvas tabs=${canvasContext.tabCount}` : ''}${fileContexts && fileContexts.length > 0 ? `, fileContexts=${fileContexts.length}` : ''}`
  )
  const workDir = getWorkingDir(spaceId)
  beginChangeSet(spaceId, conversationId, workDir)
  const spaceConfig = getSpaceConfig(workDir)
  const { effectiveLazyLoad: skillsLazyLoad, toolkit } = getEffectiveSkillsLazyLoad(workDir, config)
  const toolkitHash = getToolkitHash(toolkit)

  const mcpDirectiveResult = skillsLazyLoad
    ? extractMcpDirectives(message, conversationId)
    : { text: message, enabled: [], missing: [] }
  const messageForSend = mcpDirectiveResult.text

  if (mcpDirectiveResult.enabled.length > 0) {
    console.log(
      `[Agent][${conversationId}] Enabled plugin MCP: ${mcpDirectiveResult.enabled.join(', ')}`
    )
  }
  if (mcpDirectiveResult.missing.length > 0) {
    console.warn(
      `[Agent][${conversationId}] MCP plugin not found or missing MCP config: ${mcpDirectiveResult.missing.join(', ')}`
    )
  }

  // Resolve provider configuration
  const resolved = await resolveProvider(config.api)

  // Get conversation for session resumption
  const conversation = getConversation(spaceId, conversationId)
  const sessionId = resumeSessionId || conversation?.sessionId

  // Create abort controller for this session
  const abortController = new AbortController()

  // Accumulate stderr for detailed error messages
  let stderrBuffer = ''

  // Register this session in the active sessions map
  const sessionState: SessionState = {
    abortController,
    spaceId,
    conversationId,
    pendingPermissionResolve: null,
    pendingAskUserQuestionResolve: null,
    thoughts: [] // Initialize thoughts array for this session
  }
  setActiveSession(conversationId, sessionState)

  // Build file context block for AI (if file contexts provided)
  let fileContextBlock = ''
  if (fileContexts && fileContexts.length > 0) {
    const fileContentsPromises = fileContexts.map(async (fc) => {
      try {
        const content = await fsPromises.readFile(fc.path, 'utf-8')
        return `<file path="${fc.path}" name="${fc.name}">\n${content}\n</file>`
      } catch (err) {
        console.error(`[Agent] Failed to read file context: ${fc.path}`, err)
        return `<file path="${fc.path}" name="${fc.name}" error="Failed to read file" />`
      }
    })
    const fileContents = await Promise.all(fileContentsPromises)
    fileContextBlock = `<file-contexts>\n${fileContents.join('\n\n')}\n</file-contexts>\n\n`
    console.log(`[Agent] Prepared ${fileContexts.length} file context(s) for AI`)
  }

  // Add user message to conversation (original message without file contents)
  // File contexts are stored as metadata only, not embedded in content
  addMessage(spaceId, conversationId, {
    role: 'user',
    content: message, // Original user input (no file contents)
    images: effectiveImages,
    fileContexts: fileContexts // Store metadata for reference
  })

  // Add placeholder for assistant response
  addMessage(spaceId, conversationId, {
    role: 'assistant',
    content: '',
    toolCalls: []
  })

  try {
    // Use headless Electron binary (outside .app bundle on macOS to prevent Dock icon)
    const electronPath = getHeadlessElectronPath()
    console.log(`[Agent] Using headless Electron as Node runtime: ${electronPath}`)

    // Build SDK options using shared function (ensures consistency with ensureSessionWarm)
    const sdkOptions = buildSdkOptions({
      spaceId,
      conversationId,
      workDir,
      config,
      abortController,
      anthropicApiKey: resolved.anthropicApiKey,
      anthropicBaseUrl: resolved.anthropicBaseUrl,
      sdkModel: resolved.sdkModel,
      electronPath,
      aiBrowserEnabled: effectiveAiBrowserEnabled,
      thinkingEnabled: effectiveThinkingEnabled,
      canUseTool: createCanUseTool(workDir, spaceId, conversationId, getActiveSession),
      enabledPluginMcps: getEnabledPluginMcpList(conversationId)
    })

    // Override stderr handler to accumulate buffer for error reporting
    sdkOptions.stderr = (data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr:`, data)
      stderrBuffer += data // Accumulate for error reporting
    }

    const t0 = Date.now()
    console.log(`[Agent][${conversationId}] Getting or creating V2 session...`)

    // Log MCP servers if configured (only enabled ones, merged with space config + plugin MCP)
    const mcpDisabled =
      config.claudeCode?.mcpEnabled === false ||
      spaceConfig?.claudeCode?.mcpEnabled === false

    if (mcpDisabled) {
      console.log(`[Agent][${conversationId}] MCP disabled by configuration (external only)`)
    } else {
      const enabledMcpServers = getEnabledMcpServers(config.mcpServers || {}, workDir)
      const pluginMcpServers = buildPluginMcpServers(
        getEnabledPluginMcpList(conversationId),
        enabledMcpServers || {}
      )
      const mcpServerNames = [
        ...(enabledMcpServers ? Object.keys(enabledMcpServers) : []),
        ...Object.keys(pluginMcpServers)
      ]
      if (mcpServerNames.length > 0) {
        console.log(`[Agent][${conversationId}] MCP servers configured: ${mcpServerNames.join(', ')}`)
      }
    }

    // Session config for rebuild detection
    const sessionConfig: SessionConfig = {
      aiBrowserEnabled: !!effectiveAiBrowserEnabled,
      skillsLazyLoad,
      toolkitHash,
      enabledPluginMcpsHash: getEnabledPluginMcpHash(conversationId),
      hasCanUseTool: true // Session has canUseTool callback
    }

    // Get or create persistent V2 session for this conversation
    // Pass config for rebuild detection when aiBrowserEnabled changes
    const v2Session = await getOrCreateV2Session(
      spaceId,
      conversationId,
      sdkOptions,
      sessionId,
      sessionConfig
    )

    // Dynamic runtime parameter adjustment (via SDK patch)
    // These can be changed without rebuilding the session
    try {
      // Set thinking tokens dynamically
      if (v2Session.setMaxThinkingTokens) {
        await v2Session.setMaxThinkingTokens(thinkingEnabled ? 10240 : null)
        console.log(
          `[Agent][${conversationId}] Thinking mode: ${thinkingEnabled ? 'ON (10240 tokens)' : 'OFF'}`
        )
      }
      // Set permission mode dynamically (plan mode = no tool execution)
      if (v2Session.setPermissionMode) {
        const targetMode = planEnabled ? 'plan' : 'acceptEdits'
        await v2Session.setPermissionMode(targetMode)
        console.log(
          `[Agent][${conversationId}] Permission mode: ${targetMode}${planEnabled ? ' (Plan mode ON)' : ''}`
        )
      }
    } catch (e) {
      console.error(`[Agent][${conversationId}] Failed to set dynamic params:`, e)
    }
    console.log(`[Agent][${conversationId}] ⏱️ V2 session ready: ${Date.now() - t0}ms`)

    // Accumulate ALL text blocks for the final reply
    // Multi-step tasks may produce multiple text blocks that should all be preserved
    let accumulatedTextContent = ''
    let capturedSessionId: string | undefined

    // Token usage tracking
    // lastSingleUsage: Last API call usage (single call, represents current context size)
    let lastSingleUsage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    } | null = null

    let tokenUsage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      totalCostUsd: number
      contextWindow: number
    } | null = null

    // Token-level streaming state
    let currentStreamingText = '' // Accumulates text_delta tokens
    let isStreamingTextBlock = false // True when inside a text content block
    let hasStreamEventText = false // True when we have any stream_event text (use as single source of truth)

    console.log(`[Agent][${conversationId}] Sending message to V2 session...`)
    const t1 = Date.now()
    if (images && images.length > 0) {
      console.log(`[Agent][${conversationId}] Message includes ${images.length} image(s)`)
    }

    // Inject Canvas Context prefix if available
    // This provides AI awareness of what user is currently viewing
    const canvasPrefix = formatCanvasContext(canvasContext)

    const expandedMessage = skillsLazyLoad
      ? expandLazyDirectives(messageForSend, workDir, toolkit)
      : {
          text: messageForSend,
          expanded: { skills: [], commands: [], agents: [] },
          missing: { skills: [], commands: [], agents: [] }
        }

    if (expandedMessage.expanded.skills.length > 0) {
      console.log(
        `[Agent][${conversationId}] Expanded skills: ${expandedMessage.expanded.skills.join(', ')}`
      )
    }
    if (expandedMessage.expanded.commands.length > 0) {
      console.log(
        `[Agent][${conversationId}] Expanded commands: ${expandedMessage.expanded.commands.join(', ')}`
      )
    }
    if (expandedMessage.expanded.agents.length > 0) {
      console.log(
        `[Agent][${conversationId}] Expanded agents: ${expandedMessage.expanded.agents.join(', ')}`
      )
    }
    if (expandedMessage.missing.skills.length > 0) {
      console.warn(
        `[Agent][${conversationId}] Skills not found: ${expandedMessage.missing.skills.join(', ')}`
      )
    }
    if (expandedMessage.missing.commands.length > 0) {
      console.warn(
        `[Agent][${conversationId}] Commands not found: ${expandedMessage.missing.commands.join(', ')}`
      )
    }
    if (expandedMessage.missing.agents.length > 0) {
      console.warn(
        `[Agent][${conversationId}] Agents not found: ${expandedMessage.missing.agents.join(', ')}`
      )
    }

    // Inject file contexts + canvas context + original message for AI
    const messageWithContext = fileContextBlock + canvasPrefix + expandedMessage.text

    // Build message content (text-only or multi-modal with images)
    const messageContent = buildMessageContent(messageWithContext, images)

    // Send message to V2 session and stream response
    // For multi-modal messages, we need to send as SDKUserMessage
    if (typeof messageContent === 'string') {
      v2Session.send(messageContent)
    } else {
      // Multi-modal message: construct SDKUserMessage
      const userMessage = {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: messageContent
        }
      }
      v2Session.send(userMessage as any)
    }

    // Stream messages from V2 session
    for await (const sdkMessage of v2Session.stream()) {
      // Handle abort - check this session's controller
      if (abortController.signal.aborted) {
        console.log(`[Agent][${conversationId}] Aborted`)
        break
      }

      // Handle stream_event for token-level streaming (text only)
      if (sdkMessage.type === 'stream_event') {
        const event = (sdkMessage as any).event
        if (!event) continue

        // DEBUG: Log all stream events with timestamp (ms since send)
        const elapsed = Date.now() - t1
        // For message_start, log the full event to see if it contains content structure hints
        if (event.type === 'message_start') {
          console.log(
            `[Agent][${conversationId}] 🔴 +${elapsed}ms message_start FULL:`,
            JSON.stringify(event)
          )
        } else {
          console.log(
            `[Agent][${conversationId}] 🔴 +${elapsed}ms stream_event:`,
            JSON.stringify({
              type: event.type,
              index: event.index,
              content_block: event.content_block,
              delta: event.delta
            })
          )
        }

        // Text block started
        if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
          isStreamingTextBlock = true
          currentStreamingText = event.content_block.text || ''
          if (currentStreamingText.length > 0) {
            hasStreamEventText = true
          }

          // 🔑 Send precise signal for new text block (fixes truncation bug)
          // This is 100% reliable - comes directly from SDK's content_block_start event
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: '',
            isComplete: false,
            isStreaming: false,
            isNewTextBlock: true // Signal: new text block started
          })

          console.log(
            `[Agent][${conversationId}] ⏱️ Text block started (isNewTextBlock signal): ${Date.now() - t1}ms after send`
          )
        }

        // Text delta - accumulate locally, send delta to frontend
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          isStreamingTextBlock
        ) {
          const delta = event.delta.text || ''
          if (delta.length > 0) {
            hasStreamEventText = true
          }
          currentStreamingText += delta

          // Send delta immediately without throttling
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            delta,
            isComplete: false,
            isStreaming: true
          })
        }

        // Text block ended
        if (event.type === 'content_block_stop' && isStreamingTextBlock) {
          isStreamingTextBlock = false
          // Send final content of this block
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: currentStreamingText,
            isComplete: false,
            isStreaming: false
          })
          // Update accumulatedTextContent - append new text block
          accumulatedTextContent += (accumulatedTextContent ? '\n\n' : '') + currentStreamingText
          console.log(
            `[Agent][${conversationId}] Text block completed, length: ${currentStreamingText.length}`
          )
        }

        continue // stream_event handled, skip normal processing
      }

      // DEBUG: Log all SDK messages with timestamp
      const elapsed = Date.now() - t1
      console.log(
        `[Agent][${conversationId}] 🔵 +${elapsed}ms ${sdkMessage.type}:`,
        sdkMessage.type === 'assistant'
          ? JSON.stringify(
              Array.isArray((sdkMessage as any).message?.content)
                ? (sdkMessage as any).message.content.map((b: any) => ({
                    type: b.type,
                    id: b.id,
                    name: b.name,
                    textLen: b.text?.length,
                    thinkingLen: b.thinking?.length
                  }))
                : (sdkMessage as any).message?.content
            )
          : sdkMessage.type === 'user'
            ? `tool_result or input`
            : ''
      )

      // Extract single API call usage from assistant message (represents current context size)
      if (sdkMessage.type === 'assistant') {
        const assistantMsg = sdkMessage as any
        const msgUsage = assistantMsg.message?.usage
        if (msgUsage) {
          // Save last API call usage (overwrite each time, keep final one)
          lastSingleUsage = {
            inputTokens: msgUsage.input_tokens || 0,
            outputTokens: msgUsage.output_tokens || 0,
            cacheReadTokens: msgUsage.cache_read_input_tokens || 0,
            cacheCreationTokens: msgUsage.cache_creation_input_tokens || 0
          }
        }
      }

      if (sdkMessage.type === 'assistant') {
        const contentBlocks = (sdkMessage as any).message?.content
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (block.type === 'tool_use') {
              trackChangeFileFromToolUse(
                conversationId,
                block.name,
                block.input as { file_path?: string } | undefined
              )
            }
          }
        }
      }

      // Parse SDK message into Thought and send to renderer
      const thought = parseSDKMessage(sdkMessage)

      if (thought) {
        // Accumulate thought in backend session (Single Source of Truth)
        sessionState.thoughts.push(thought)

        // Send ALL thoughts to renderer for real-time display in thought process area
        // This includes text blocks - they appear in the timeline during generation
        sendToRenderer('agent:thought', spaceId, conversationId, { thought })

        // Handle specific thought types
        if (thought.type === 'text') {
          if (!hasStreamEventText) {
            // Accumulate text blocks - multi-step tasks may produce multiple text blocks
            accumulatedTextContent += (accumulatedTextContent ? '\n\n' : '') + thought.content

            // Send streaming update - frontend shows this during generation
            sendToRenderer('agent:message', spaceId, conversationId, {
              type: 'message',
              content: accumulatedTextContent,
              isComplete: false
            })
          }
        } else if (thought.type === 'tool_use') {
          trackChangeFileFromToolUse(
            conversationId,
            thought.toolName,
            thought.toolInput as { file_path?: string } | undefined
          )
          const isAskUserQuestion = thought.toolName?.toLowerCase() === 'askuserquestion'
          const toolCall: ToolCall = {
            id: thought.id,
            name: thought.toolName || '',
            status: isAskUserQuestion ? 'waiting_approval' : 'running',
            input: isAskUserQuestion
              ? normalizeAskUserQuestionInput(thought.toolInput || {})
              : (thought.toolInput || {}),
            requiresApproval: isAskUserQuestion ? false : undefined,
            description: isAskUserQuestion ? 'Waiting for user response' : undefined
          }
          sendToRenderer(
            'agent:tool-call',
            spaceId,
            conversationId,
            toolCall as unknown as Record<string, unknown>
          )
          if (isAskUserQuestion) {
            console.log(
              `[Agent][${conversationId}] AskUserQuestion tool-call sent: toolId=${thought.id}`
            )
          }
        } else if (thought.type === 'tool_result') {
          const isAskUserQuestionResult = sessionState.thoughts.some((existingThought) =>
            existingThought.type === 'tool_use' &&
            existingThought.id === thought.id &&
            existingThought.toolName?.toLowerCase() === 'askuserquestion'
          )
          if (isAskUserQuestionResult) {
            console.log(
              `[Agent][${conversationId}] AskUserQuestion tool-result received: toolId=${thought.id}, isError=${thought.isError || false}`
            )
          }
          // Send tool result event
          sendToRenderer('agent:tool-result', spaceId, conversationId, {
            type: 'tool_result',
            toolId: thought.id,
            result: thought.toolOutput || '',
            isError: thought.isError || false
          })
        } else if (thought.type === 'result') {
          // Final result - use accumulated text as the final reply
          const finalContent = accumulatedTextContent || thought.content
          sendToRenderer('agent:message', spaceId, conversationId, {
            type: 'message',
            content: finalContent,
            isComplete: true
          })
          // Fallback: if no text block was received, use result content for persistence
          if (!accumulatedTextContent && thought.content) {
            accumulatedTextContent = thought.content
          }
          // Note: updateLastMessage is called after loop to include tokenUsage
          console.log(
            `[Agent][${conversationId}] Result thought received, ${sessionState.thoughts.length} thoughts accumulated`
          )
        }
      }

      // Capture session ID and MCP status from system/result messages
      // Use type assertion for SDK message properties that may vary
      const msg = sdkMessage as Record<string, unknown>
      if (sdkMessage.type === 'system') {
        const subtype = msg.subtype as string | undefined
        const msgSessionId =
          msg.session_id || (msg.message as Record<string, unknown>)?.session_id
        if (msgSessionId) {
          capturedSessionId = msgSessionId as string
          console.log(`[Agent][${conversationId}] Captured session ID:`, capturedSessionId)
        }

        // Log skills and plugins from system init message
        const skills = msg.skills as string[] | undefined
        const plugins = msg.plugins as Array<{ name: string; path: string }> | undefined
        if (skills) {
          console.log(`[Agent][${conversationId}] Loaded skills:`, skills)
        }
        if (plugins) {
          console.log(`[Agent][${conversationId}] Loaded plugins:`, JSON.stringify(plugins))
        }

        // Handle compact_boundary - context compression notification
        if (subtype === 'compact_boundary') {
          const compactMetadata = msg.compact_metadata as
            | { trigger: 'manual' | 'auto'; pre_tokens: number }
            | undefined
          if (compactMetadata) {
            console.log(
              `[Agent][${conversationId}] Context compressed: trigger=${compactMetadata.trigger}, pre_tokens=${compactMetadata.pre_tokens}`
            )
            // Send compact notification to renderer
            sendToRenderer('agent:compact', spaceId, conversationId, {
              type: 'compact',
              trigger: compactMetadata.trigger,
              preTokens: compactMetadata.pre_tokens
            })
          }
        }

        // Extract MCP server status from system init message
        // SDKSystemMessage includes mcp_servers: { name: string; status: string }[]
        const mcpServers = msg.mcp_servers as Array<{ name: string; status: string }> | undefined
        if (mcpServers && mcpServers.length > 0) {
          console.log(
            `[Agent][${conversationId}] MCP server status:`,
            JSON.stringify(mcpServers)
          )
          // Broadcast MCP status to frontend (global event, not conversation-specific)
          broadcastMcpStatus(mcpServers)
        }

        // Also capture tools list if available
        const tools = msg.tools as string[] | undefined
        if (tools) {
          console.log(`[Agent][${conversationId}] Available tools: ${tools.length}`)
        }
      } else if (sdkMessage.type === 'result') {
        if (!capturedSessionId) {
          const msgSessionId =
            msg.session_id || (msg.message as Record<string, unknown>)?.session_id
          capturedSessionId = msgSessionId as string
        }

        // Get cumulative cost and contextWindow from result message
        const modelUsage = msg.modelUsage as Record<string, { contextWindow?: number }> | undefined
        const totalCostUsd = msg.total_cost_usd as number | undefined

        // Get context window from first model in modelUsage (usually only one model)
        let contextWindow = 200000 // Default to 200K
        if (modelUsage) {
          const firstModel = Object.values(modelUsage)[0]
          if (firstModel?.contextWindow) {
            contextWindow = firstModel.contextWindow
          }
        }

        // Use last API call usage (single) + cumulative cost
        if (lastSingleUsage) {
          tokenUsage = {
            ...lastSingleUsage,
            totalCostUsd: totalCostUsd || 0,
            contextWindow
          }
        } else {
          // Fallback: If no assistant message, use result.usage (cumulative, less accurate but has data)
          const usage = msg.usage as
            | {
                input_tokens?: number
                output_tokens?: number
                cache_read_input_tokens?: number
                cache_creation_input_tokens?: number
              }
            | undefined
          if (usage) {
            tokenUsage = {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cacheReadTokens: usage.cache_read_input_tokens || 0,
              cacheCreationTokens: usage.cache_creation_input_tokens || 0,
              totalCostUsd: totalCostUsd || 0,
              contextWindow
            }
          }
        }
        if (tokenUsage) {
          console.log(`[Agent][${conversationId}] Token usage (single API):`, tokenUsage)
        }
      }
    }

    // Save session ID for future resumption
    if (capturedSessionId) {
      saveSessionId(spaceId, conversationId, capturedSessionId)
      console.log(`[Agent][${conversationId}] Session ID saved:`, capturedSessionId)
    }

    // Ensure complete event is sent even if no result message was received
    if (accumulatedTextContent) {
      console.log(`[Agent][${conversationId}] Sending final complete event with accumulated text`)
      // Backend saves complete message with thoughts and tokenUsage (Single Source of Truth)
      const latestMessage = updateLastMessage(spaceId, conversationId, {
        content: accumulatedTextContent,
        thoughts: sessionState.thoughts.length > 0 ? [...sessionState.thoughts] : undefined,
        tokenUsage: tokenUsage || undefined, // Include token usage if available
        isPlan: planEnabled || undefined // Mark as plan mode response
      })
      finalizeChangeSet(spaceId, conversationId, latestMessage?.id)
      console.log(
        `[Agent][${conversationId}] Saved ${sessionState.thoughts.length} thoughts${tokenUsage ? ' with tokenUsage' : ''}${planEnabled ? ' (plan mode)' : ''} to backend`
      )
      sendToRenderer('agent:complete', spaceId, conversationId, {
        type: 'complete',
        duration: 0,
        tokenUsage, // Include token usage data
        isPlan: planEnabled || undefined // Pass plan flag to renderer
      })
    } else {
      console.log(`[Agent][${conversationId}] WARNING: No text content after SDK query completed`)
      finalizeChangeSet(spaceId, conversationId)
    }
  } catch (error: unknown) {
    const err = error as Error

    // Don't report abort as error
    if (err.name === 'AbortError') {
      console.log(`[Agent][${conversationId}] Aborted by user`)
      return
    }

    console.error(`[Agent][${conversationId}] Error:`, error)

    // Extract detailed error message from stderr if available
    let errorMessage = err.message || 'Unknown error occurred'

    // Windows: Check for Git Bash related errors
    if (process.platform === 'win32') {
      const isExitCode1 =
        errorMessage.includes('exited with code 1') ||
        errorMessage.includes('process exited') ||
        errorMessage.includes('spawn ENOENT')
      const isBashError =
        stderrBuffer?.includes('bash') ||
        stderrBuffer?.includes('ENOENT') ||
        errorMessage.includes('ENOENT')

      if (isExitCode1 || isBashError) {
        // Check if Git Bash is properly configured
        const { detectGitBash } = require('../git-bash.service')
        const gitBashStatus = detectGitBash()

        if (!gitBashStatus.found) {
          errorMessage =
            'Command execution environment not installed. Please restart the app and complete setup, or install manually in settings.'
        } else {
          // Git Bash found but still got error - could be path issue
          errorMessage =
            'Command execution failed. This may be an environment configuration issue, please try restarting the app.\n\n' +
            `Technical details: ${err.message}`
        }
      }
    }

    if (stderrBuffer && !errorMessage.includes('Command execution')) {
      // Try to extract the most useful error info from stderr
      const mcpErrorMatch = stderrBuffer.match(
        /Error: Invalid MCP configuration:[\s\S]*?(?=\n\s*at |$)/m
      )
      const genericErrorMatch = stderrBuffer.match(/Error: [\s\S]*?(?=\n\s*at |$)/m)
      if (mcpErrorMatch) {
        errorMessage = mcpErrorMatch[0].trim()
      } else if (genericErrorMatch) {
        errorMessage = genericErrorMatch[0].trim()
      }
    }

    sendToRenderer('agent:error', spaceId, conversationId, {
      type: 'error',
      error: errorMessage
    })

    // Close V2 session on error (it may be in a bad state)
    closeV2Session(conversationId)
  } finally {
    // Clean up active session state (but keep V2 session for reuse)
    deleteActiveSession(conversationId)
    clearPendingChangeSet(conversationId)
    console.log(
      `[Agent][${conversationId}] Active session state cleaned up. V2 sessions: ${getV2SessionsCount()}`
    )
  }
}

/**
 * Stop generation for a specific conversation
 */
export async function stopGeneration(conversationId?: string): Promise<void> {
  if (conversationId) {
    // Stop specific session
    const session = getActiveSession(conversationId)
    if (session) {
      session.pendingPermissionResolve = null
      session.pendingAskUserQuestionResolve = null
      session.abortController.abort()
      deleteActiveSession(conversationId)

      // Interrupt V2 Session and drain stale messages
      const v2SessionInfo = getV2SessionInfo(conversationId)
      if (v2SessionInfo) {
        try {
          await (v2SessionInfo.session as any).interrupt()
          console.log(`[Agent] V2 session interrupted, draining stale messages...`)

          // Drain stale messages until we hit the result
          for await (const msg of v2SessionInfo.session.stream()) {
            console.log(`[Agent] Drained: ${msg.type}`)
            if (msg.type === 'result') break
          }
          console.log(`[Agent] Drain complete for: ${conversationId}`)
        } catch (e) {
          console.error(`[Agent] Failed to interrupt/drain V2 session:`, e)
        }
      }

      console.log(`[Agent] Stopped generation for conversation: ${conversationId}`)
    }
  } else {
    // Stop all sessions (backward compatibility)
    const { getActiveSessions } = await import('./session.manager')
    for (const convId of getActiveSessions()) {
      const session = getActiveSession(convId)
      if (session) {
        session.pendingPermissionResolve = null
        session.pendingAskUserQuestionResolve = null
        session.abortController.abort()

        // Interrupt V2 Session
        const v2SessionInfo = getV2SessionInfo(convId)
        if (v2SessionInfo) {
          try {
            await (v2SessionInfo.session as any).interrupt()
          } catch (e) {
            console.error(`[Agent] Failed to interrupt V2 session ${convId}:`, e)
          }
        }

        console.log(`[Agent] Stopped generation for conversation: ${convId}`)
      }
    }
    // Clear all active sessions
    for (const convId of getActiveSessions()) {
      deleteActiveSession(convId)
    }
    console.log('[Agent] All generations stopped')
  }
}

/**
 * Handle tool approval from renderer for a specific conversation
 */
export function handleToolApproval(conversationId: string, approved: boolean): void {
  const session = getActiveSession(conversationId)
  if (session?.pendingPermissionResolve) {
    session.pendingPermissionResolve(approved)
    session.pendingPermissionResolve = null
  }
}

/**
 * Submit user answer for AskUserQuestion tool while the current turn is still running.
 * The SDK session consumes this as a normal user turn input and continues streaming.
 */
export async function handleAskUserQuestionResponse(
  conversationId: string,
  answer: string
): Promise<void> {
  const trimmedAnswer = answer.trim()
  if (!trimmedAnswer) {
    throw new Error('Answer cannot be empty')
  }

  const sessionState = getActiveSession(conversationId)
  const v2SessionInfo = getV2SessionInfo(conversationId)

  if (!sessionState || !v2SessionInfo) {
    throw new Error('No active session found for this conversation')
  }

  if (!sessionState.pendingAskUserQuestionResolve) {
    throw new Error('No pending AskUserQuestion found for this conversation')
  }

  const resolvePendingQuestion = sessionState.pendingAskUserQuestionResolve
  sessionState.pendingAskUserQuestionResolve = null
  resolvePendingQuestion(trimmedAnswer)

  // Send the answer to the session as a new message
  v2SessionInfo.session.send(trimmedAnswer)
  console.log(
    `[Agent][${conversationId}] AskUserQuestion answered (length=${trimmedAnswer.length})`
  )
}
