/**
 * Agent Service - Public API
 *
 * Re-exports all public functions and types from the agent service modules.
 * This file serves as the main entry point for the agent service.
 */

// Re-export types
export type {
  ImageMediaType,
  ImageAttachment,
  FileContextAttachment,
  CanvasContext,
  AgentRequest,
  ToolCallStatus,
  ToolCall,
  ThoughtType,
  Thought,
  SessionState,
  V2SDKSession,
  SessionConfig,
  V2SessionInfo,
  McpServerStatus,
  McpServerStatusInfo,
  PluginConfig,
  SettingSource
} from './types'

// Re-export from electron-path
export { getHeadlessElectronPath } from './electron-path'

// Re-export from provider-resolver
export { resolveProvider, inferOpenAIWireApi } from './provider-resolver'
export type { ApiConfig, ResolvedProvider } from './provider-resolver'

// Re-export from message-parser
export { parseSDKMessage, parseSDKMessages, formatCanvasContext, buildMessageContent } from './message-parser'

// Re-export from renderer-comm
export { setMainWindow, getMainWindow, sendToRenderer, createCanUseTool } from './renderer-comm'

// Re-export from sdk-config.builder
export {
  getWorkingDir,
  buildPluginsConfig,
  buildSettingSources,
  getEnabledMcpServers,
  buildSystemPromptAppend,
  buildSdkOptions,
  _testBuildSdkOptionsEnv,
  _testBuildSettingSources
} from './sdk-config.builder'
export type { CanUseToolHandler, BuildSdkOptionsParams } from './sdk-config.builder'

// Re-export from mcp-status.service
export {
  getCachedMcpStatus,
  broadcastMcpStatus,
  testMcpConnections
} from './mcp-status.service'

// Re-export from session.manager
export {
  getOrCreateV2Session,
  ensureSessionWarm,
  closeV2Session,
  closeAllV2Sessions,
  reconnectMcpServer,
  toggleMcpServer,
  getActiveSession,
  setActiveSession,
  deleteActiveSession,
  isGenerating,
  getActiveSessions,
  getSessionState,
  getV2SessionInfo,
  getV2SessionsCount
} from './session.manager'

// Re-export from message-flow.service
export {
  sendMessage,
  stopGeneration,
  handleToolApproval,
  handleAskUserQuestionResponse
} from './message-flow.service'
