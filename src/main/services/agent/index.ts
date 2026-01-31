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

// Re-export functions from main agent service
export {
  sendMessage,
  stopGeneration,
  isGenerating,
  getActiveSessions,
  getSessionState,
  handleToolApproval,
  ensureSessionWarm,
  closeV2Session,
  closeAllV2Sessions,
  reconnectMcpServer,
  toggleMcpServer,
  testMcpConnections,
  getCachedMcpStatus,
  _testBuildSdkOptionsEnv,
  _testBuildSettingSources
} from '../agent.service'
