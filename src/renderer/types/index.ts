// ============================================
// Kite Type Definitions
// ============================================

// API Provider Configuration
// - 'anthropic': Official Anthropic API (api.anthropic.com)
// - 'anthropic-compat': Anthropic-compatible backends (OpenRouter, etc.) - direct connection, zero overhead
// - 'openai': OpenAI-compatible backends (GPT, Ollama, vLLM) - requires protocol conversion
// - 'zhipu': ZhipuAI (智谱) - Anthropic-compatible, direct connection
// - 'minimax': MiniMax - Anthropic-compatible, direct connection
// - 'custom': Legacy custom provider (treated as anthropic-compat)
export type ApiProvider = 'anthropic' | 'anthropic-compat' | 'openai' | 'zhipu' | 'minimax' | 'custom';

// Available Claude models
export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    description: 'Most powerful model, great for complex reasoning and architecture decisions'
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Balanced performance and cost, suitable for most tasks'
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Fast and lightweight, ideal for simple tasks'
  }
];

export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

// Permission Level
export type PermissionLevel = 'allow' | 'ask' | 'deny';

// Theme Mode
export type ThemeMode = 'light' | 'dark' | 'system';
export type ConfigSourceMode = 'kite' | 'claude';

// Tool Call Status
export type ToolStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'waiting_approval'
  | 'cancelled'
  | 'unknown';

// Message Role
export type MessageRole = 'user' | 'assistant' | 'system';

// ============================================
// Configuration Types
// ============================================

export interface ApiConfig {
  provider: ApiProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
}

export interface PermissionConfig {
  fileAccess: PermissionLevel;
  commandExecution: PermissionLevel;
  networkAccess: PermissionLevel;
  trustMode: boolean;
}

export interface AppearanceConfig {
  theme: ThemeMode;
}

// System configuration for auto-launch and tray behavior
export interface SystemConfig {
  autoLaunch: boolean;      // Launch on system startup
  minimizeToTray: boolean;  // Minimize to tray instead of quitting on window close
}

// Remote access configuration
export interface RemoteAccessConfig {
  enabled: boolean;
  port: number;
  trustedOrigins?: string[];  // Allowed CORS origins (in addition to localhost)
}

// ============================================
// MCP Server Configuration Types
// Format compatible with Cursor / Claude Desktop
// ============================================

// MCP stdio server (command-based, most common)
export interface McpStdioServerConfig {
  type?: 'stdio';  // Optional, defaults to stdio
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;  // milliseconds
  disabled?: boolean;  // Kite extension: temporarily disable this server
}

// MCP HTTP server (REST API)
export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;  // Kite extension: temporarily disable this server
}

// MCP SSE server (Server-Sent Events)
export interface McpSseServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;  // Kite extension: temporarily disable this server
}

// Union type for all MCP server configs
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

// MCP servers map (key is server name)
export type McpServersConfig = Record<string, McpServerConfig>;

// MCP server status (from SDK)
export type McpServerStatusType = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';

export interface McpServerStatus {
  name: string;
  status: McpServerStatusType;
  serverInfo?: {
    name: string;
    version: string;
  };
  error?: string;
}

// ============================================
// Claude Code Configuration Types
// ============================================

// Re-export shared types
export type {
  HooksConfig,
  HookDefinition,
  HookCommand,
  PluginsConfig,
  AgentsConfig,
  ClaudeCodeConfig
} from '../../shared/types/claude-code';

export interface KiteConfig {
  api: ApiConfig;
  permissions: PermissionConfig;
  appearance: AppearanceConfig;
  system: SystemConfig;
  remoteAccess: RemoteAccessConfig;
  mcpServers: McpServersConfig;  // MCP servers configuration
  isFirstLaunch: boolean;
  configSourceMode: ConfigSourceMode;
  claudeCode?: ClaudeCodeConfig;  // Claude Code configuration (plugins, hooks, agents)
}

// ============================================
// Space Types
// ============================================

export interface SpaceStats {
  artifactCount: number;
  conversationCount: number;
}

// Layout preferences for a space (persisted to meta.json)
export interface SpaceLayoutPreferences {
  artifactRailExpanded?: boolean;  // Whether rail stays expanded when canvas is open
  chatWidth?: number;              // Custom chat panel width when canvas is open
}

// Skills preferences for a space
export interface SpaceSkillsPreferences {
  favorites?: string[];  // Favorited skill names
  enabled?: string[];    // Enabled skill names for this space
  showOnlyEnabled?: boolean; // Whether to show only enabled skills
}

// Agents preferences for a space
export interface SpaceAgentsPreferences {
  enabled?: string[];    // Enabled agent names for this space
  showOnlyEnabled?: boolean; // Whether to show only enabled agents
}

// All space preferences (extensible for future features)
export interface SpacePreferences {
  layout?: SpaceLayoutPreferences;
  skills?: SpaceSkillsPreferences;
  agents?: SpaceAgentsPreferences;
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  path: string;
  isTemp: boolean;
  createdAt: string;
  updatedAt: string;
  stats: SpaceStats;
  preferences?: SpacePreferences;  // User preferences for this space
}

export interface CreateSpaceInput {
  name: string;
  icon: string;
  customPath?: string;
}

// ============================================
// Conversation Types
// ============================================

// Lightweight metadata for conversation list (no messages)
// Used by listConversations for fast loading
export interface ConversationMeta {
  id: string;
  spaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string;  // Last message preview (truncated)
}

// Full conversation with messages
// Loaded on-demand when selecting a conversation
export interface Conversation extends ConversationMeta {
  messages: Message[];
  sessionId?: string;
}

// ============================================
// Workflow Types
// ============================================

export interface WorkflowStep {
  id: string;
  type: 'skill' | 'agent' | 'message';
  name?: string;
  input?: string;
  args?: string;
  summarizeAfter?: boolean;
}

export interface Workflow {
  id: string;
  spaceId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  settings?: {
    thinkingEnabled?: boolean;
    aiBrowserEnabled?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastConversationId?: string;
}

export interface WorkflowMeta {
  id: string;
  spaceId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastConversationId?: string;
}

// ============================================
// Message Types
// ============================================

export interface ToolCall {
  id: string;
  name: string;
  status: ToolStatus;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  progress?: number;
  requiresApproval?: boolean;
  description?: string;
}

export interface AskUserQuestionAnswerPayload {
  toolCallId: string;
  answersByQuestionId: Record<string, string[]>;
  skippedQuestionIds: string[];
  runId?: string;
}

// ============================================
// Image Attachment Types (for multi-modal messages)
// ============================================

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// Image attachment for messages
export interface ImageAttachment {
  id: string;
  type: 'image';
  mediaType: ImageMediaType;
  data: string;  // Base64 encoded image data
  name?: string;  // Optional filename
  size?: number;  // File size in bytes
}

// File context attachment (for drag-drop files from file tree)
export interface FileContextAttachment {
  id: string;
  type: 'file-context';
  path: string;
  name: string;
  extension: string;
}

// Content block types for multi-modal messages (matches Claude API)
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string;
  };
}

export type MessageContentBlock = TextContentBlock | ImageContentBlock;

export interface Message {
  id: string;
  role: MessageRole;
  content: string;  // Text content (for backward compatibility)
  timestamp: string;
  toolCalls?: ToolCall[];
  thoughts?: Thought[];  // Agent's reasoning process for this message
  isStreaming?: boolean;
  images?: ImageAttachment[];  // Attached images
  tokenUsage?: TokenUsage;  // Token usage for this assistant message
  fileContexts?: FileContextAttachment[];  // File contexts for context injection (metadata only)
  isPlan?: boolean;  // Whether this message is a plan mode response
  terminalReason?: 'completed' | 'stopped' | 'error' | 'no_text';
}

// ============================================
// Change Set Types (File change review/rollback)
// ============================================

export type ChangeFileType = 'edit' | 'create' | 'delete';
export type ChangeFileStatus = 'accepted' | 'rolled_back';
export type ChangeSetStatus = 'applied' | 'partial_rollback' | 'rolled_back';

export interface ChangeFile {
  id: string;
  path: string;
  relativePath: string;
  fileName: string;
  type: ChangeFileType;
  status: ChangeFileStatus;
  beforeExists: boolean;
  afterExists: boolean;
  beforeContent?: string;
  afterContent?: string;
  beforeHash?: string;
  afterHash?: string;
  stats: { added: number; removed: number };
}

export interface ChangeSet {
  id: string;
  spaceId: string;
  conversationId: string;
  messageId?: string;
  createdAt: string;
  status: ChangeSetStatus;
  summary: { totalFiles: number; totalAdded: number; totalRemoved: number };
  files: ChangeFile[];
}

// ============================================
// Artifact Types
// ============================================

export type ArtifactType = 'file' | 'folder';

export interface Artifact {
  id: string;
  spaceId: string;
  conversationId: string;
  name: string;
  type: ArtifactType;
  path: string;
  extension: string;
  icon: string;
  createdAt: string;
  preview?: string;
  size?: number;
}

// Tree node structure for developer view
export interface ArtifactTreeNode {
  id: string;
  name: string;
  type: ArtifactType;
  path: string;
  extension: string;
  icon: string;
  size?: number;
  children?: ArtifactTreeNode[];
  depth: number;
}

// View mode for artifact display
export type ArtifactViewMode = 'card' | 'tree';

// ============================================
// Thought Process Types (Agent's real-time reasoning)
// ============================================

export type ThoughtType = 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'system' | 'result' | 'error';

// Thought execution status
export type ThoughtStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'unknown';

export interface Thought {
  id: string;
  type: ThoughtType;
  content: string;
  timestamp: string;
  // For tool-related thoughts
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  // For result thoughts
  duration?: number;

  // === Sub-agent and parallel operation support ===

  // Parent tool use ID - identifies which sub-agent this thought belongs to
  // null = main agent, string = sub-agent (Task tool)
  parentToolUseId?: string | null;

  // Parallel group ID - thoughts with same ID are executed in parallel
  parallelGroupId?: string;

  // Execution status for real-time updates
  status?: ThoughtStatus;

  // Sub-agent metadata (only for Task tool calls)
  agentMeta?: {
    description: string;  // Task tool's description parameter
    prompt?: string;      // Task tool's prompt parameter
    subagentType?: string; // Task tool's subagent_type parameter
  };
}

// Tree node for hierarchical thought display
export interface ThoughtTreeNode {
  thought: Thought;
  children: ThoughtTreeNode[];  // Sub-agent's thoughts
  isExpanded?: boolean;         // UI expansion state
}

// Parallel operation group
export interface ParallelGroup {
  id: string;
  thoughts: Thought[];          // Tool calls executed in parallel
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'partial_error';
}

// Legacy alias for backwards compatibility
export interface ThinkingBlock {
  id: string;
  content: string;
  timestamp: string;
  isComplete: boolean;
}

// ============================================
// Task Panel Types (Global task tracking)
// ============================================

// Task status (same as TodoWrite for compatibility)
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'paused';

// Individual task item for global task panel
export interface TaskItem {
  id: string;
  content: string;                    // Task description (imperative form)
  status: TaskStatus;
  activeForm?: string;                // Present continuous form for in_progress display
  linkedAgentId?: string;             // Associated sub-agent ID (Task tool)
  parentTaskId?: string;              // Support for task hierarchy
  createdAt: string;
  updatedAt: string;
  sourceThoughtId?: string;           // The TodoWrite thought that created this task
}

// Global task state for task panel
export interface TaskState {
  tasks: TaskItem[];
  activeTaskId: string | null;        // Currently executing task
  lastUpdated: string | null;
}

// ============================================
// Canvas Context Types (AI awareness of user's open tabs)
// ============================================

/**
 * Canvas Context - Provides AI with awareness of user's currently open tabs
 * Injected into messages to enable natural language understanding of user context
 */
export interface CanvasContext {
  isOpen: boolean;
  tabCount: number;
  activeTab: {
    type: string;  // 'browser' | 'code' | 'markdown' | 'image' | 'pdf' | 'text' | 'json' | 'csv'
    title: string;
    url?: string;   // For browser/pdf tabs
    path?: string;  // For file tabs
  } | null;
  tabs: Array<{
    type: string;
    title: string;
    url?: string;
    path?: string;
    isActive: boolean;
  }>;
}

// ============================================
// Agent Event Types
// All events now include spaceId and conversationId for multi-session support
// ============================================

// Base event with session identifiers
export interface AgentEventBase {
  spaceId: string;
  conversationId: string;
  runId?: string;
}

export type AgentRunLifecycle = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

export interface AgentMessageEvent extends AgentEventBase {
  type: 'message';
  content: string;
  isComplete: boolean;
  timestamp?: number;
}

export interface AgentThinkingEvent extends AgentEventBase {
  type: 'thinking';
  thinking: ThinkingBlock;
}

export interface AgentToolCallEvent extends AgentEventBase {
  type: 'tool_call';
  toolCall: ToolCall;
}

export interface AgentToolResultEvent extends AgentEventBase {
  type: 'tool_result';
  toolCallId: string;
  toolId?: string; // Backward compatibility alias
  result: string;
  isError: boolean;
}

export interface AgentErrorEvent extends AgentEventBase {
  type: 'error';
  error: string;
}

// Token usage statistics from SDK result message
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  contextWindow: number;
}

export interface AgentCompleteEvent extends AgentEventBase {
  type: 'complete';
  duration?: number;
  durationMs?: number;
  reason?: 'completed' | 'stopped' | 'error' | 'no_text';
  terminalAt?: string;
  tokenUsage?: TokenUsage | null;
  isPlan?: boolean;
}

export interface AgentRunStartEvent extends AgentEventBase {
  type: 'run_start';
  runId: string;
  startedAt: string;
}

export interface AgentToolsAvailableEvent extends AgentEventBase {
  type: 'tools_available';
  runId: string;
  snapshotVersion: number;
  emittedAt: string;
  tools: string[];
  toolCount: number;
}

export interface AgentThoughtEvent extends AgentEventBase {
  thought: Thought;
}

// Compact notification info (context compression)
export interface CompactInfo {
  trigger: 'manual' | 'auto';
  preTokens: number;
}

export interface AgentCompactEvent extends AgentEventBase {
  type: 'compact';
  trigger: 'manual' | 'auto';
  preTokens: number;
}

export type AgentEvent =
  | AgentRunStartEvent
  | AgentMessageEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentErrorEvent
  | AgentCompleteEvent
  | AgentCompactEvent
  | AgentToolsAvailableEvent;

// ============================================
// App State Types
// ============================================

export type AppView = 'splash' | 'gitBashSetup' | 'setup' | 'home' | 'space' | 'settings';

export interface AppState {
  view: AppView;
  isLoading: boolean;
  error: string | null;
  config: KiteConfig | null;
}

// ============================================
// IPC Types
// ============================================

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================
// Utility Types
// ============================================

export interface ValidationResult {
  valid: boolean;
  message?: string;
  model?: string;
}

// Default values
export const DEFAULT_CONFIG: KiteConfig = {
  api: {
    provider: 'anthropic',
    apiKey: '',
    apiUrl: 'https://api.anthropic.com',
    model: DEFAULT_MODEL
  },
  permissions: {
    fileAccess: 'allow',
    commandExecution: 'ask',
    networkAccess: 'allow',
    trustMode: false
  },
  appearance: {
    theme: 'system'
  },
  system: {
    autoLaunch: false,
    minimizeToTray: false
  },
  remoteAccess: {
    enabled: false,
    port: 3456
  },
  mcpServers: {},  // Empty by default
  isFirstLaunch: true,
  configSourceMode: 'kite'
};

// Icon options for spaces (using icon IDs that map to Lucide icons)
export const SPACE_ICONS = [
  'folder', 'code', 'globe', 'chart', 'file-text', 'palette',
  'gamepad', 'wrench', 'smartphone', 'lightbulb', 'rocket', 'star'
] as const;

export type SpaceIconId = typeof SPACE_ICONS[number];

// Default space icon
export const DEFAULT_SPACE_ICON: SpaceIconId = 'folder';

// File type to icon ID mapping (maps to Lucide icon names)
export const FILE_ICON_IDS: Record<string, string> = {
  html: 'globe',
  htm: 'globe',
  css: 'palette',
  scss: 'palette',
  less: 'palette',
  js: 'file-code',
  jsx: 'file-code',
  ts: 'file-code',
  tsx: 'file-code',
  json: 'file-json',
  md: 'book',
  markdown: 'book',
  txt: 'file-text',
  py: 'file-code',
  rs: 'cpu',
  go: 'file-code',
  java: 'coffee',
  cpp: 'cpu',
  c: 'cpu',
  h: 'cpu',
  hpp: 'cpu',
  rb: 'gem',
  swift: 'apple',
  sql: 'database',
  sh: 'terminal',
  bash: 'terminal',
  zsh: 'terminal',
  yaml: 'file-json',
  yml: 'file-json',
  xml: 'file-json',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  pdf: 'book',
  doc: 'file-text',
  docx: 'file-text',
  xls: 'database',
  xlsx: 'database',
  zip: 'package',
  tar: 'package',
  gz: 'package',
  rar: 'package',
  default: 'file-text'
};

export function getFileIconId(extension: string): string {
  return FILE_ICON_IDS[extension.toLowerCase()] || FILE_ICON_IDS.default;
}

// ============================================
// Toolkit Types (mirrored from main process)
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

export interface SpaceToolkit {
  skills: DirectiveRef[]
  commands: DirectiveRef[]
  agents: DirectiveRef[]
}
