/**
 * Preload Script - Exposes IPC to renderer
 */

import { contextBridge, ipcRenderer } from 'electron'

interface AskUserQuestionAnswerPayload {
  toolCallId: string
  answersByQuestionId: Record<string, string[]>
  skippedQuestionIds: string[]
  runId?: string
}

type ChatMode = 'code' | 'plan' | 'ask'

// Type definitions for exposed API
export interface KiteAPI {
  // Config
  getConfig: () => Promise<IpcResponse>
  setConfig: (updates: Record<string, unknown>) => Promise<IpcResponse>
  validateApi: (
    apiKey: string,
    apiUrl: string,
    provider: string,
    protocol?: string
  ) => Promise<IpcResponse>

  // Space
  getKiteSpace: () => Promise<IpcResponse>
  listSpaces: () => Promise<IpcResponse>
  createSpace: (input: { name: string; icon: string; customPath?: string }) => Promise<IpcResponse>
  deleteSpace: (spaceId: string) => Promise<IpcResponse>
  getSpace: (spaceId: string) => Promise<IpcResponse>
  openSpaceFolder: (spaceId: string) => Promise<IpcResponse>
  updateSpace: (spaceId: string, updates: { name?: string; icon?: string }) => Promise<IpcResponse>
  getDefaultSpacePath: () => Promise<IpcResponse>
  selectFolder: () => Promise<IpcResponse>
  updateSpacePreferences: (spaceId: string, preferences: {
    layout?: {
      artifactRailExpanded?: boolean
      chatWidth?: number
    }
    skills?: {
      favorites?: string[]
      enabled?: string[]
      showOnlyEnabled?: boolean
    }
    agents?: {
      enabled?: string[]
      showOnlyEnabled?: boolean
    }
  }) => Promise<IpcResponse>
  getSpacePreferences: (spaceId: string) => Promise<IpcResponse>

  // Conversation
  listConversations: (spaceId: string) => Promise<IpcResponse>
  createConversation: (spaceId: string, title?: string) => Promise<IpcResponse>
  getConversation: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  updateConversation: (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ) => Promise<IpcResponse>
  deleteConversation: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  addMessage: (
    spaceId: string,
    conversationId: string,
    message: { role: string; content: string }
  ) => Promise<IpcResponse>
  updateLastMessage: (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ) => Promise<IpcResponse>

  // Change Sets
  listChangeSets: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  acceptChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string }) => Promise<IpcResponse>
  rollbackChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string; force?: boolean }) => Promise<IpcResponse>

  // Agent
  sendMessage: (request: {
    spaceId: string
    conversationId: string
    message: string
    resumeSessionId?: string
    modelOverride?: string
    model?: string
    images?: Array<{
      id: string
      type: 'image'
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      data: string
      name?: string
      size?: number
    }>
    aiBrowserEnabled?: boolean  // Enable AI Browser tools
    thinkingEnabled?: boolean  // Enable extended thinking mode
    planEnabled?: boolean  // Enable plan mode (no tool execution)
    mode?: ChatMode
    canvasContext?: {  // Canvas context for AI awareness
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
    fileContexts?: Array<{
      id: string
      type: 'file-context'
      path: string
      name: string
      extension: string
    }>
  }) => Promise<IpcResponse>
  setAgentMode: (
    conversationId: string,
    mode: ChatMode,
    runId?: string
  ) => Promise<IpcResponse<{ applied: boolean; mode: ChatMode; runId?: string; reason?: string; error?: string }>>
  stopGeneration: (conversationId?: string) => Promise<IpcResponse>
  approveTool: (conversationId: string) => Promise<IpcResponse>
  rejectTool: (conversationId: string) => Promise<IpcResponse>
  answerQuestion: (
    conversationId: string,
    answer: string | AskUserQuestionAnswerPayload
  ) => Promise<IpcResponse>
  getSessionState: (conversationId: string) => Promise<IpcResponse>
  ensureSessionWarm: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  testMcpConnections: () => Promise<{ success: boolean; servers: unknown[]; error?: string }>
  reconnectMcpServer: (conversationId: string, serverName: string) => Promise<{ success: boolean; error?: string }>
  toggleMcpServer: (conversationId: string, serverName: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // Event listeners
  onAgentRunStart: (callback: (data: unknown) => void) => () => void
  onAgentMessage: (callback: (data: unknown) => void) => () => void
  onAgentToolCall: (callback: (data: unknown) => void) => () => void
  onAgentToolResult: (callback: (data: unknown) => void) => () => void
  onAgentProcess: (callback: (data: unknown) => void) => () => void
  onAgentError: (callback: (data: unknown) => void) => () => void
  onAgentComplete: (callback: (data: unknown) => void) => () => void
  onAgentMode: (callback: (data: unknown) => void) => () => void
  onAgentThinking: (callback: (data: unknown) => void) => () => void
  onAgentThought: (callback: (data: unknown) => void) => () => void
  onAgentToolsAvailable: (callback: (data: unknown) => void) => () => void
  onAgentMcpStatus: (callback: (data: unknown) => void) => () => void
  onAgentCompact: (callback: (data: unknown) => void) => () => void
  onSkillsChanged: (callback: (data: unknown) => void) => () => void
  onCommandsChanged: (callback: (data: unknown) => void) => () => void
  onAgentsChanged: (callback: (data: unknown) => void) => () => void

  // Artifact
  listArtifacts: (spaceId: string) => Promise<IpcResponse>
  listArtifactsTree: (spaceId: string) => Promise<IpcResponse>
  openArtifact: (filePath: string) => Promise<IpcResponse>
  showArtifactInFolder: (filePath: string) => Promise<IpcResponse>
  readArtifactContent: (filePath: string) => Promise<IpcResponse>
  writeArtifactContent: (filePath: string, content: string) => Promise<IpcResponse>
  createFolder: (folderPath: string) => Promise<IpcResponse>
  createFile: (filePath: string, content?: string) => Promise<IpcResponse>
  renameArtifact: (oldPath: string, newName: string) => Promise<IpcResponse>
  deleteArtifact: (filePath: string) => Promise<IpcResponse>
  moveArtifact: (sourcePath: string, targetDir: string) => Promise<IpcResponse>
  copyArtifact: (sourcePath: string, targetDir: string) => Promise<IpcResponse>

  // Onboarding
  writeOnboardingArtifact: (spaceId: string, filename: string, content: string) => Promise<IpcResponse>
  saveOnboardingConversation: (spaceId: string, userPrompt: string, aiResponse: string) => Promise<IpcResponse>

  // Skills
  listSkills: (workDir?: string, locale?: string) => Promise<IpcResponse>
  getSkillContent: (name: string, workDir?: string) => Promise<IpcResponse>
  createSkill: (workDir: string, name: string, content: string) => Promise<IpcResponse>
  updateSkill: (skillPath: string, content: string) => Promise<IpcResponse>
  deleteSkill: (skillPath: string) => Promise<IpcResponse>
  copySkillToSpace: (skillName: string, workDir: string) => Promise<IpcResponse>
  copySkillToSpaceByRef: (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<IpcResponse>
  clearSkillsCache: () => Promise<IpcResponse>

  // Commands
  listCommands: (workDir?: string, locale?: string) => Promise<IpcResponse>
  getCommandContent: (name: string, workDir?: string) => Promise<IpcResponse>
  createCommand: (workDir: string, name: string, content: string) => Promise<IpcResponse>
  updateCommand: (commandPath: string, content: string) => Promise<IpcResponse>
  deleteCommand: (commandPath: string) => Promise<IpcResponse>
  copyCommandToSpace: (commandName: string, workDir: string) => Promise<IpcResponse>
  copyCommandToSpaceByRef: (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<IpcResponse>
  clearCommandsCache: () => Promise<IpcResponse>

  // Agents
  listAgents: (workDir?: string, locale?: string) => Promise<IpcResponse>
  getAgentContent: (name: string, workDir?: string) => Promise<IpcResponse>
  createAgent: (workDir: string, name: string, content: string) => Promise<IpcResponse>
  updateAgent: (agentPath: string, content: string) => Promise<IpcResponse>
  deleteAgent: (agentPath: string) => Promise<IpcResponse>
  copyAgentToSpace: (agentName: string, workDir: string) => Promise<IpcResponse>
  copyAgentToSpaceByRef: (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<IpcResponse>
  clearAgentsCache: () => Promise<IpcResponse>

  // Scene Taxonomy
  getSceneTaxonomy: () => Promise<IpcResponse>
  upsertSceneDefinition: (definition: Record<string, unknown>) => Promise<IpcResponse>
  removeSceneDefinition: (key: string) => Promise<IpcResponse>
  setResourceSceneOverride: (resourceKey: string, tags: string[]) => Promise<IpcResponse>
  removeResourceSceneOverride: (resourceKey: string) => Promise<IpcResponse>
  exportSceneTaxonomy: () => Promise<IpcResponse>
  importSceneTaxonomy: (payload: Record<string, unknown>, mode?: 'merge' | 'replace') => Promise<IpcResponse>

  // Toolkit
  getToolkit: (spaceId: string) => Promise<IpcResponse>
  addToolkitResource: (spaceId: string, directive: Record<string, unknown>) => Promise<IpcResponse>
  removeToolkitResource: (spaceId: string, directive: Record<string, unknown>) => Promise<IpcResponse>
  clearToolkit: (spaceId: string) => Promise<IpcResponse>
  migrateToToolkit: (spaceId: string, skills: string[], agents: string[]) => Promise<IpcResponse>

  // Presets
  listPresets: () => Promise<IpcResponse>
  getPreset: (presetId: string) => Promise<IpcResponse>

  // Workflows
  listWorkflows: (spaceId: string) => Promise<IpcResponse>
  getWorkflow: (spaceId: string, workflowId: string) => Promise<IpcResponse>
  createWorkflow: (spaceId: string, input: Record<string, unknown>) => Promise<IpcResponse>
  updateWorkflow: (spaceId: string, workflowId: string, updates: Record<string, unknown>) => Promise<IpcResponse>
  deleteWorkflow: (spaceId: string, workflowId: string) => Promise<IpcResponse>

  // Remote Access
  enableRemoteAccess: (port?: number) => Promise<IpcResponse>
  disableRemoteAccess: () => Promise<IpcResponse>
  enableTunnel: () => Promise<IpcResponse>
  disableTunnel: () => Promise<IpcResponse>
  getRemoteStatus: () => Promise<IpcResponse>
  getRemoteQRCode: (includeToken?: boolean) => Promise<IpcResponse>
  onRemoteStatusChange: (callback: (data: unknown) => void) => () => void

  // System Settings
  getAutoLaunch: () => Promise<IpcResponse>
  setAutoLaunch: (enabled: boolean) => Promise<IpcResponse>
  getMinimizeToTray: () => Promise<IpcResponse>
  setMinimizeToTray: (enabled: boolean) => Promise<IpcResponse>

  // Window
  setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<IpcResponse>
  maximizeWindow: () => Promise<IpcResponse>
  unmaximizeWindow: () => Promise<IpcResponse>
  isWindowMaximized: () => Promise<IpcResponse<boolean>>
  toggleMaximizeWindow: () => Promise<IpcResponse<boolean>>
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void

  // Search
  search: (
    query: string,
    scope: 'conversation' | 'space' | 'global',
    conversationId?: string,
    spaceId?: string
  ) => Promise<IpcResponse>
  cancelSearch: () => Promise<IpcResponse>
  onSearchProgress: (callback: (data: unknown) => void) => () => void
  onSearchCancelled: (callback: () => void) => () => void

  // Updater
  checkForUpdates: () => Promise<IpcResponse>
  installUpdate: () => Promise<IpcResponse>
  getVersion: () => Promise<IpcResponse>
  onUpdaterStatus: (callback: (data: unknown) => void) => () => void

  // Browser (embedded browser for Content Canvas)
  createBrowserView: (viewId: string, url?: string) => Promise<IpcResponse>
  destroyBrowserView: (viewId: string) => Promise<IpcResponse>
  showBrowserView: (viewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<IpcResponse>
  hideBrowserView: (viewId: string) => Promise<IpcResponse>
  resizeBrowserView: (viewId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<IpcResponse>
  navigateBrowserView: (viewId: string, url: string) => Promise<IpcResponse>
  browserGoBack: (viewId: string) => Promise<IpcResponse>
  browserGoForward: (viewId: string) => Promise<IpcResponse>
  browserReload: (viewId: string) => Promise<IpcResponse>
  browserStop: (viewId: string) => Promise<IpcResponse>
  getBrowserState: (viewId: string) => Promise<IpcResponse>
  captureBrowserView: (viewId: string) => Promise<IpcResponse>
  executeBrowserJS: (viewId: string, code: string) => Promise<IpcResponse>
  setBrowserZoom: (viewId: string, level: number) => Promise<IpcResponse>
  toggleBrowserDevTools: (viewId: string) => Promise<IpcResponse>
  showBrowserContextMenu: (options: { viewId: string; url?: string; zoomLevel: number }) => Promise<IpcResponse>
  onBrowserStateChange: (callback: (data: unknown) => void) => () => void
  onBrowserZoomChanged: (callback: (data: { viewId: string; zoomLevel: number }) => void) => () => void

  // Canvas Tab Menu
  showCanvasTabContextMenu: (options: {
    tabId: string
    tabIndex: number
    tabTitle: string
    tabPath?: string
    tabCount: number
    hasTabsToRight: boolean
  }) => Promise<IpcResponse>
  onCanvasTabAction: (callback: (data: {
    action: 'close' | 'closeOthers' | 'closeToRight' | 'copyPath' | 'refresh'
    tabId?: string
    tabIndex?: number
    tabPath?: string
  }) => void) => () => void

  // AI Browser
  onAIBrowserActiveViewChanged: (callback: (data: { viewId: string; url: string | null; title: string | null }) => void) => () => void

  // Overlay (for floating UI above BrowserView)
  showChatCapsuleOverlay: () => Promise<IpcResponse>
  hideChatCapsuleOverlay: () => Promise<IpcResponse>
  onCanvasExitMaximized: (callback: () => void) => () => void

  // Performance Monitoring (Developer Tools)
  perfStart: (config?: { sampleInterval?: number; maxSamples?: number }) => Promise<IpcResponse>
  perfStop: () => Promise<IpcResponse>
  perfGetState: () => Promise<IpcResponse>
  perfGetHistory: () => Promise<IpcResponse>
  perfClearHistory: () => Promise<IpcResponse>
  perfSetConfig: (config: { enabled?: boolean; sampleInterval?: number; warnOnThreshold?: boolean }) => Promise<IpcResponse>
  perfExport: () => Promise<IpcResponse<string>>
  perfReportRendererMetrics: (metrics: {
    fps: number
    frameTime: number
    renderCount: number
    domNodes: number
    eventListeners: number
    jsHeapUsed: number
    jsHeapLimit: number
    longTasks: number
  }) => void
  onPerfSnapshot: (callback: (data: unknown) => void) => () => void
  onPerfWarning: (callback: (data: unknown) => void) => () => void

  // Git Bash (Windows only)
  getGitBashStatus: () => Promise<IpcResponse<{
    found: boolean
    path: string | null
    source: 'system' | 'app-local' | 'env-var' | null
  }>>
  installGitBash: (onProgress: (progress: {
    phase: 'downloading' | 'extracting' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  }) => void) => Promise<{ success: boolean; path?: string; error?: string }>
  openExternal: (url: string) => Promise<void>
}

interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Create event listener with cleanup
function createEventListener(channel: string, callback: (data: unknown) => void): () => void {
  console.log(`[Preload] Creating event listener for channel: ${channel}`)

  const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
    console.log(`[Preload] Received event on channel: ${channel}`, data)
    callback(data)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    console.log(`[Preload] Removing event listener for channel: ${channel}`)
    ipcRenderer.removeListener(channel, handler)
  }
}

// Generic IPC invoke with progress callback
async function invokeWithProgress<TResult, TProgress>(
  channel: string,
  request: Record<string, unknown>,
  onProgress: (progress: TProgress) => void,
  progressChannelPrefix: string
): Promise<TResult> {
  const progressChannel = `${progressChannelPrefix}-${Date.now()}`
  const progressHandler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
    onProgress(progress as TProgress)
  }
  ipcRenderer.on(progressChannel, progressHandler)
  try {
    const result = await ipcRenderer.invoke(channel, { ...request, progressChannel })
    return result as TResult
  } finally {
    ipcRenderer.removeListener(progressChannel, progressHandler)
  }
}

// Expose API to renderer
const api: KiteAPI = {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (updates) => ipcRenderer.invoke('config:set', updates),
  validateApi: (apiKey, apiUrl, provider, protocol) =>
    ipcRenderer.invoke('config:validate-api', apiKey, apiUrl, provider, protocol),

  // Space
  getKiteSpace: () => ipcRenderer.invoke('space:get-kite'),
  listSpaces: () => ipcRenderer.invoke('space:list'),
  createSpace: (input) => ipcRenderer.invoke('space:create', input),
  deleteSpace: (spaceId) => ipcRenderer.invoke('space:delete', spaceId),
  getSpace: (spaceId) => ipcRenderer.invoke('space:get', spaceId),
  openSpaceFolder: (spaceId) => ipcRenderer.invoke('space:open-folder', spaceId),
  updateSpace: (spaceId, updates) => ipcRenderer.invoke('space:update', spaceId, updates),
  getDefaultSpacePath: () => ipcRenderer.invoke('space:get-default-path'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  updateSpacePreferences: (spaceId, preferences) =>
    ipcRenderer.invoke('space:update-preferences', spaceId, preferences),
  getSpacePreferences: (spaceId) => ipcRenderer.invoke('space:get-preferences', spaceId),

  // Conversation
  listConversations: (spaceId) => ipcRenderer.invoke('conversation:list', spaceId),
  createConversation: (spaceId, title) => ipcRenderer.invoke('conversation:create', spaceId, title),
  getConversation: (spaceId, conversationId) =>
    ipcRenderer.invoke('conversation:get', spaceId, conversationId),
  updateConversation: (spaceId, conversationId, updates) =>
    ipcRenderer.invoke('conversation:update', spaceId, conversationId, updates),
  deleteConversation: (spaceId, conversationId) =>
    ipcRenderer.invoke('conversation:delete', spaceId, conversationId),
  addMessage: (spaceId, conversationId, message) =>
    ipcRenderer.invoke('conversation:add-message', spaceId, conversationId, message),
  updateLastMessage: (spaceId, conversationId, updates) =>
    ipcRenderer.invoke('conversation:update-last-message', spaceId, conversationId, updates),

  // Change Sets
  listChangeSets: (spaceId, conversationId) =>
    ipcRenderer.invoke('change-set:list', spaceId, conversationId),
  acceptChangeSet: (params) => ipcRenderer.invoke('change-set:accept', params),
  rollbackChangeSet: (params) => ipcRenderer.invoke('change-set:rollback', params),

  // Agent
  sendMessage: (request) => ipcRenderer.invoke('agent:send-message', request),
  setAgentMode: (conversationId, mode, runId) =>
    ipcRenderer.invoke('agent:set-mode', { conversationId, mode, runId }),
  stopGeneration: (conversationId) => ipcRenderer.invoke('agent:stop', conversationId),
  approveTool: (conversationId) => ipcRenderer.invoke('agent:approve-tool', conversationId),
  rejectTool: (conversationId) => ipcRenderer.invoke('agent:reject-tool', conversationId),
  answerQuestion: (conversationId, answer) =>
    ipcRenderer.invoke('agent:answer-question', conversationId, answer),
  getSessionState: (conversationId) => ipcRenderer.invoke('agent:get-session-state', conversationId),
  ensureSessionWarm: (spaceId, conversationId) => ipcRenderer.invoke('agent:ensure-session-warm', spaceId, conversationId),
  testMcpConnections: () => ipcRenderer.invoke('agent:test-mcp'),
  reconnectMcpServer: (conversationId, serverName) => ipcRenderer.invoke('agent:reconnect-mcp', conversationId, serverName),
  toggleMcpServer: (conversationId, serverName, enabled) => ipcRenderer.invoke('agent:toggle-mcp', conversationId, serverName, enabled),

  // Event listeners
  onAgentRunStart: (callback) => createEventListener('agent:run-start', callback),
  onAgentMessage: (callback) => createEventListener('agent:message', callback),
  onAgentToolCall: (callback) => createEventListener('agent:tool-call', callback),
  onAgentToolResult: (callback) => createEventListener('agent:tool-result', callback),
  onAgentProcess: (callback) => createEventListener('agent:process', callback),
  onAgentError: (callback) => createEventListener('agent:error', callback),
  onAgentComplete: (callback) => createEventListener('agent:complete', callback),
  onAgentMode: (callback) => createEventListener('agent:mode', callback),
  onAgentThinking: (callback) => createEventListener('agent:thinking', callback),
  onAgentThought: (callback) => createEventListener('agent:thought', callback),
  onAgentToolsAvailable: (callback) => createEventListener('agent:tools-available', callback),
  onAgentMcpStatus: (callback) => createEventListener('agent:mcp-status', callback),
  onAgentCompact: (callback) => createEventListener('agent:compact', callback),
  onSkillsChanged: (callback) => createEventListener('skills:changed', callback),
  onCommandsChanged: (callback) => createEventListener('commands:changed', callback),
  onAgentsChanged: (callback) => createEventListener('agents:changed', callback),

  // Artifact
  listArtifacts: (spaceId) => ipcRenderer.invoke('artifact:list', spaceId),
  listArtifactsTree: (spaceId) => ipcRenderer.invoke('artifact:list-tree', spaceId),
  openArtifact: (filePath) => ipcRenderer.invoke('artifact:open', filePath),
  showArtifactInFolder: (filePath) => ipcRenderer.invoke('artifact:show-in-folder', filePath),
  readArtifactContent: (filePath) => ipcRenderer.invoke('artifact:read-content', filePath),
  writeArtifactContent: (filePath, content) => ipcRenderer.invoke('artifact:write-content', filePath, content),
  createFolder: (folderPath) => ipcRenderer.invoke('artifact:create-folder', folderPath),
  createFile: (filePath, content) => ipcRenderer.invoke('artifact:create-file', filePath, content),
  renameArtifact: (oldPath, newName) => ipcRenderer.invoke('artifact:rename', oldPath, newName),
  deleteArtifact: (filePath) => ipcRenderer.invoke('artifact:delete', filePath),
  moveArtifact: (sourcePath, targetDir) => ipcRenderer.invoke('artifact:move', sourcePath, targetDir),
  copyArtifact: (sourcePath, targetDir) => ipcRenderer.invoke('artifact:copy', sourcePath, targetDir),

  // Onboarding
  writeOnboardingArtifact: (spaceId, filename, content) =>
    ipcRenderer.invoke('onboarding:write-artifact', spaceId, filename, content),
  saveOnboardingConversation: (spaceId, userPrompt, aiResponse) =>
    ipcRenderer.invoke('onboarding:save-conversation', spaceId, userPrompt, aiResponse),

  // Skills
  listSkills: (workDir, locale) => ipcRenderer.invoke('skills:list', workDir, locale),
  getSkillContent: (name, workDir) => ipcRenderer.invoke('skills:get-content', name, workDir),
  createSkill: (workDir, name, content) => ipcRenderer.invoke('skills:create', workDir, name, content),
  updateSkill: (skillPath, content) => ipcRenderer.invoke('skills:update', skillPath, content),
  deleteSkill: (skillPath) => ipcRenderer.invoke('skills:delete', skillPath),
  copySkillToSpace: (skillName, workDir) => ipcRenderer.invoke('skills:copy-to-space', skillName, workDir),
  copySkillToSpaceByRef: (ref, workDir, options) => ipcRenderer.invoke('skills:copy-to-space-by-ref', ref, workDir, options),
  clearSkillsCache: () => ipcRenderer.invoke('skills:clear-cache'),

  // Commands
  listCommands: (workDir, locale) => ipcRenderer.invoke('commands:list', workDir, locale),
  getCommandContent: (name, workDir) => ipcRenderer.invoke('commands:get-content', name, workDir),
  createCommand: (workDir, name, content) => ipcRenderer.invoke('commands:create', workDir, name, content),
  updateCommand: (commandPath, content) => ipcRenderer.invoke('commands:update', commandPath, content),
  deleteCommand: (commandPath) => ipcRenderer.invoke('commands:delete', commandPath),
  copyCommandToSpace: (commandName, workDir) => ipcRenderer.invoke('commands:copy-to-space', commandName, workDir),
  copyCommandToSpaceByRef: (ref, workDir, options) => ipcRenderer.invoke('commands:copy-to-space-by-ref', ref, workDir, options),
  clearCommandsCache: () => ipcRenderer.invoke('commands:clear-cache'),

  // Agents
  listAgents: (workDir, locale) => ipcRenderer.invoke('agents:list', workDir, locale),
  getAgentContent: (name, workDir) => ipcRenderer.invoke('agents:get-content', name, workDir),
  createAgent: (workDir, name, content) => ipcRenderer.invoke('agents:create', workDir, name, content),
  updateAgent: (agentPath, content) => ipcRenderer.invoke('agents:update', agentPath, content),
  deleteAgent: (agentPath) => ipcRenderer.invoke('agents:delete', agentPath),
  copyAgentToSpace: (agentName, workDir) => ipcRenderer.invoke('agents:copy-to-space', agentName, workDir),
  copyAgentToSpaceByRef: (ref, workDir, options) => ipcRenderer.invoke('agents:copy-to-space-by-ref', ref, workDir, options),
  clearAgentsCache: () => ipcRenderer.invoke('agents:clear-cache'),

  // Scene Taxonomy
  getSceneTaxonomy: () => ipcRenderer.invoke('scene-taxonomy:get'),
  upsertSceneDefinition: (definition) => ipcRenderer.invoke('scene-taxonomy:upsert-definition', definition),
  removeSceneDefinition: (key) => ipcRenderer.invoke('scene-taxonomy:remove-definition', key),
  setResourceSceneOverride: (resourceKey, tags) => ipcRenderer.invoke('scene-taxonomy:set-override', resourceKey, tags),
  removeResourceSceneOverride: (resourceKey) => ipcRenderer.invoke('scene-taxonomy:remove-override', resourceKey),
  exportSceneTaxonomy: () => ipcRenderer.invoke('scene-taxonomy:export'),
  importSceneTaxonomy: (payload, mode = 'merge') => ipcRenderer.invoke('scene-taxonomy:import', payload, mode),

  // Toolkit
  getToolkit: (spaceId) => ipcRenderer.invoke('toolkit:get', spaceId),
  addToolkitResource: (spaceId, directive) => ipcRenderer.invoke('toolkit:add', spaceId, directive),
  removeToolkitResource: (spaceId, directive) => ipcRenderer.invoke('toolkit:remove', spaceId, directive),
  clearToolkit: (spaceId) => ipcRenderer.invoke('toolkit:clear', spaceId),
  migrateToToolkit: (spaceId, skills, agents) => ipcRenderer.invoke('toolkit:migrate', spaceId, skills, agents),

  // Presets
  listPresets: () => ipcRenderer.invoke('preset:list'),
  getPreset: (presetId) => ipcRenderer.invoke('preset:get', presetId),

  // Workflows
  listWorkflows: (spaceId) => ipcRenderer.invoke('workflow:list', spaceId),
  getWorkflow: (spaceId, workflowId) => ipcRenderer.invoke('workflow:get', spaceId, workflowId),
  createWorkflow: (spaceId, input) => ipcRenderer.invoke('workflow:create', spaceId, input),
  updateWorkflow: (spaceId, workflowId, updates) => ipcRenderer.invoke('workflow:update', spaceId, workflowId, updates),
  deleteWorkflow: (spaceId, workflowId) => ipcRenderer.invoke('workflow:delete', spaceId, workflowId),

  // Remote Access
  enableRemoteAccess: (port) => ipcRenderer.invoke('remote:enable', port),
  disableRemoteAccess: () => ipcRenderer.invoke('remote:disable'),
  enableTunnel: () => ipcRenderer.invoke('remote:tunnel:enable'),
  disableTunnel: () => ipcRenderer.invoke('remote:tunnel:disable'),
  getRemoteStatus: () => ipcRenderer.invoke('remote:status'),
  getRemoteQRCode: (includeToken) => ipcRenderer.invoke('remote:qrcode', includeToken),
  onRemoteStatusChange: (callback) => createEventListener('remote:status-change', callback),

  // System Settings
  getAutoLaunch: () => ipcRenderer.invoke('system:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('system:set-auto-launch', enabled),
  getMinimizeToTray: () => ipcRenderer.invoke('system:get-minimize-to-tray'),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('system:set-minimize-to-tray', enabled),

  // Window
  setTitleBarOverlay: (options) => ipcRenderer.invoke('window:set-title-bar-overlay', options),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  onWindowMaximizeChange: (callback) => createEventListener('window:maximize-change', callback as (data: unknown) => void),

  // Search
  search: (query, scope, conversationId, spaceId) =>
    ipcRenderer.invoke('search:execute', query, scope, conversationId, spaceId),
  cancelSearch: () => ipcRenderer.invoke('search:cancel'),
  onSearchProgress: (callback) => createEventListener('search:progress', callback),
  onSearchCancelled: (callback) => createEventListener('search:cancelled', callback),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getVersion: () => ipcRenderer.invoke('updater:get-version'),
  onUpdaterStatus: (callback) => createEventListener('updater:status', callback),

  // Browser (embedded browser for Content Canvas)
  createBrowserView: (viewId, url) => ipcRenderer.invoke('browser:create', { viewId, url }),
  destroyBrowserView: (viewId) => ipcRenderer.invoke('browser:destroy', { viewId }),
  showBrowserView: (viewId, bounds) => ipcRenderer.invoke('browser:show', { viewId, bounds }),
  hideBrowserView: (viewId) => ipcRenderer.invoke('browser:hide', { viewId }),
  resizeBrowserView: (viewId, bounds) => ipcRenderer.invoke('browser:resize', { viewId, bounds }),
  navigateBrowserView: (viewId, url) => ipcRenderer.invoke('browser:navigate', { viewId, url }),
  browserGoBack: (viewId) => ipcRenderer.invoke('browser:go-back', { viewId }),
  browserGoForward: (viewId) => ipcRenderer.invoke('browser:go-forward', { viewId }),
  browserReload: (viewId) => ipcRenderer.invoke('browser:reload', { viewId }),
  browserStop: (viewId) => ipcRenderer.invoke('browser:stop', { viewId }),
  getBrowserState: (viewId) => ipcRenderer.invoke('browser:get-state', { viewId }),
  captureBrowserView: (viewId) => ipcRenderer.invoke('browser:capture', { viewId }),
  executeBrowserJS: (viewId, code) => ipcRenderer.invoke('browser:execute-js', { viewId, code }),
  setBrowserZoom: (viewId, level) => ipcRenderer.invoke('browser:zoom', { viewId, level }),
  toggleBrowserDevTools: (viewId) => ipcRenderer.invoke('browser:dev-tools', { viewId }),
  showBrowserContextMenu: (options) => ipcRenderer.invoke('browser:show-context-menu', options),
  onBrowserStateChange: (callback) => createEventListener('browser:state-change', callback),
  onBrowserZoomChanged: (callback) => createEventListener('browser:zoom-changed', callback as (data: unknown) => void),

  // Canvas Tab Menu (native Electron menu)
  showCanvasTabContextMenu: (options) => ipcRenderer.invoke('canvas:show-tab-context-menu', options),
  onCanvasTabAction: (callback) => createEventListener('canvas:tab-action', callback as (data: unknown) => void),

  // AI Browser - active view change notification from main process
  onAIBrowserActiveViewChanged: (callback) => createEventListener('ai-browser:active-view-changed', callback as (data: unknown) => void),

  // Overlay (for floating UI above BrowserView)
  showChatCapsuleOverlay: () => ipcRenderer.invoke('overlay:show-chat-capsule'),
  hideChatCapsuleOverlay: () => ipcRenderer.invoke('overlay:hide-chat-capsule'),
  onCanvasExitMaximized: (callback) => createEventListener('canvas:exit-maximized', callback as (data: unknown) => void),

  // Performance Monitoring (Developer Tools)
  perfStart: (config) => ipcRenderer.invoke('perf:start', config),
  perfStop: () => ipcRenderer.invoke('perf:stop'),
  perfGetState: () => ipcRenderer.invoke('perf:get-state'),
  perfGetHistory: () => ipcRenderer.invoke('perf:get-history'),
  perfClearHistory: () => ipcRenderer.invoke('perf:clear-history'),
  perfSetConfig: (config) => ipcRenderer.invoke('perf:set-config', config),
  perfExport: () => ipcRenderer.invoke('perf:export'),
  perfReportRendererMetrics: (metrics) => ipcRenderer.send('perf:renderer-metrics', metrics),
  onPerfSnapshot: (callback) => createEventListener('perf:snapshot', callback),
  onPerfWarning: (callback) => createEventListener('perf:warning', callback),

  // Git Bash (Windows only)
  getGitBashStatus: () => ipcRenderer.invoke('git-bash:status'),
  installGitBash: (onProgress) =>
    invokeWithProgress<
      { success: boolean; path?: string; error?: string },
      Parameters<typeof onProgress>[0]
    >('git-bash:install', {}, onProgress, 'git-bash:install-progress'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
}

contextBridge.exposeInMainWorld('kite', api)

// Analytics: Listen for tracking events from main process
// Baidu Tongji SDK is loaded in index.html, we just need to call _hmt.push()
// Note: _hmt is initialized as an array in index.html before SDK loads
// The SDK will process queued commands when it loads
ipcRenderer.on('analytics:track', (_event, data: {
  type: string
  category: string
  action: string
  label?: string
  value?: number
  customVars?: Record<string, unknown>
}) => {
  try {
    // _hmt is defined in index.html as: var _hmt = _hmt || []
    // We can push commands to it before SDK fully loads - SDK will process them
    const win = window as unknown as { _hmt?: unknown[][] }

    // Ensure _hmt exists
    if (!win._hmt) {
      win._hmt = []
    }

    if (data.type === 'trackEvent') {
      // _hmt.push(['_trackEvent', category, action, opt_label, opt_value])
      win._hmt.push(['_trackEvent', data.category, data.action, data.label || '', data.value || 0])
      console.log('[Analytics] Baidu event queued:', data.action)
    }
  } catch (error) {
    console.warn('[Analytics] Failed to track Baidu event:', error)
  }
})

// Expose platform info for cross-platform UI adjustments
const platformInfo = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
}

contextBridge.exposeInMainWorld('platform', platformInfo)

// Expose basic electron IPC for overlay SPA
// This is used by the overlay window which doesn't need the full kite API
const electronAPI = {
  ipcRenderer: {
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    },
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.removeListener(channel, callback as (...args: unknown[]) => void)
    },
    send: (channel: string, ...args: unknown[]) => {
      ipcRenderer.send(channel, ...args)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)

// TypeScript declaration for window.kite and window.platform
declare global {
  interface Window {
    kite: KiteAPI
    platform: {
      platform: 'darwin' | 'win32' | 'linux'
      isMac: boolean
      isWindows: boolean
      isLinux: boolean
    }
    // For overlay SPA - access via contextBridge
    electron?: {
      ipcRenderer: {
        on: (channel: string, callback: (...args: unknown[]) => void) => void
        removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
        send: (channel: string, ...args: unknown[]) => void
      }
    }
  }
}
