/**
 * Agent Service Types
 *
 * Shared type definitions for the agent service modules.
 * These types are used internally by the main process agent service.
 *
 * Note: Renderer-facing types are defined in src/renderer/types/index.ts
 * and src/shared/types/ for cross-process sharing.
 */

// ============================================
// Image and Attachment Types
// ============================================

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export interface ImageAttachment {
  id: string
  type: 'image'
  mediaType: ImageMediaType
  data: string  // Base64 encoded
  name?: string
  size?: number
}

export interface FileContextAttachment {
  id: string
  type: 'file-context'
  path: string
  name: string
  extension: string
}

// ============================================
// Canvas Context
// ============================================

/**
 * Canvas Context - Injected into messages to provide AI awareness of user's open tabs
 */
export interface CanvasContext {
  isOpen: boolean
  tabCount: number
  activeTab: {
    type: string
    title: string
    url?: string
    path?: string
  } | null
  tabs: Array<{
    type: string
    title: string
    url?: string
    path?: string
    isActive: boolean
  }>
}

// ============================================
// Agent Request
// ============================================

export interface AgentRequest {
  spaceId: string
  conversationId: string
  message: string
  resumeSessionId?: string
  images?: ImageAttachment[]
  aiBrowserEnabled?: boolean
  thinkingEnabled?: boolean
  planEnabled?: boolean
  model?: string
  canvasContext?: CanvasContext
  fileContexts?: FileContextAttachment[]
}

// ============================================
// Tool and Thought Types
// ============================================

export type ToolCallStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'waiting_approval'
  | 'cancelled'

export interface ToolCall {
  id: string
  name: string
  status: ToolCallStatus
  input: Record<string, unknown>
  output?: string
  error?: string
  progress?: number
  requiresApproval?: boolean
  description?: string
}

export type AskUserQuestionMode = 'sdk_allow_updated_input' | 'legacy_deny_send'

export interface AskUserQuestionAnswerPayload {
  toolCallId: string
  answersByQuestionId: Record<string, string[]>
  skippedQuestionIds: string[]
  runId?: string
}

export type AskUserQuestionAnswerInput = AskUserQuestionAnswerPayload | string

export interface CanUseToolDecision {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}

export interface PendingAskUserQuestionContext {
  resolve: (decision: CanUseToolDecision) => void
  inputSnapshot: Record<string, unknown>
  expectedToolCallId: string | null
  runId: string
  createdAt: number
  mode: AskUserQuestionMode
}

export type SessionLifecycle = 'running' | 'terminal'
export type SessionTerminalReason = 'completed' | 'stopped' | 'error' | 'no_text' | null

export type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'system' | 'result' | 'error'
export type ProcessVisibility = 'user' | 'debug'

export interface ProcessTraceNode {
  type: string
  kind?: string
  ts?: string
  timestamp?: string
  visibility?: ProcessVisibility
  payload?: Record<string, unknown>
}

export interface Thought {
  id: string
  type: ThoughtType
  content: string
  timestamp: string
  visibility?: ProcessVisibility
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  isError?: boolean
  duration?: number
  // Sub-agent support
  parentToolUseId?: string | null
  status?: ToolCallStatus
  agentMeta?: {
    description: string
    prompt?: string
    subagentType?: string
  }
}

// ============================================
// Session Management
// ============================================

export interface SessionState {
  abortController: AbortController
  spaceId: string
  conversationId: string
  runId: string
  startedAt: number
  latestAssistantContent: string
  lifecycle: SessionLifecycle
  terminalReason: SessionTerminalReason
  terminalAt: string | null
  finalized: boolean
  toolCallSeq: number
  toolsById: Map<string, ToolCall>
  askUserQuestionModeByToolCallId: Map<string, AskUserQuestionMode>
  pendingPermissionResolve: ((approved: boolean) => void) | null
  pendingAskUserQuestion: PendingAskUserQuestionContext | null
  thoughts: Thought[]
  processTrace: ProcessTraceNode[]
}

/**
 * V2 SDK Session interface
 * SDK 0.2.22+ natively supports all required methods
 */
export interface V2SDKSession {
  readonly sessionId?: string
  send: (message: unknown) => void
  stream: () => AsyncIterable<unknown>
  close: () => void
  interrupt?: () => Promise<void> | void
  setModel?: (model: string | undefined) => Promise<void>
  setMaxThinkingTokens?: (maxThinkingTokens: number | null) => Promise<void>
  setPermissionMode?: (mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk') => Promise<void>
  reconnectMcpServer?: (serverName: string) => Promise<void>
  toggleMcpServer?: (serverName: string, enabled: boolean) => Promise<void>
}

/**
 * Session configuration that requires session rebuild when changed
 */
export interface SessionConfig {
  aiBrowserEnabled: boolean
  skillsLazyLoad: boolean
  toolkitHash?: string
  enabledPluginMcpsHash?: string
  hasCanUseTool?: boolean // Track if session has canUseTool callback
}

export interface V2SessionInfo {
  session: V2SDKSession
  spaceId: string
  conversationId: string
  createdAt: number
  lastUsedAt: number
  config: SessionConfig
}

// ============================================
// MCP Server Types
// ============================================

export type McpServerStatus = 'connected' | 'connecting' | 'disconnected' | 'error' | 'disabled' | 'failed' | 'needs-auth' | 'pending'

export interface McpServerStatusInfo {
  name: string
  status: McpServerStatus
  error?: string
  toolCount?: number
  resourceCount?: number
  promptCount?: number
  serverInfo?: {
    name: string
    version: string
  }
}

// ============================================
// Plugin and Setting Types
// ============================================

export type PluginConfig = { type: 'local'; path: string }

export type SettingSource = 'user' | 'project' | 'local'

// ============================================
// Directive Types (used by toolkit, skills, commands, agents)
// ============================================

export type DirectiveType = 'skill' | 'command' | 'agent'

export interface DirectiveRef {
  id: string
  type: DirectiveType
  name: string
  namespace?: string
  source?: string
  args?: string
}
