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

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'waiting_approval'

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

export type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'system' | 'result' | 'error'

export interface Thought {
  id: string
  type: ThoughtType
  content: string
  timestamp: string
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
  pendingPermissionResolve: ((approved: boolean) => void) | null
  thoughts: Thought[]
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
  enabledPluginMcpsHash?: string
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
