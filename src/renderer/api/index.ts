/**
 * Kite API - Unified interface for both IPC and HTTP modes
 * Automatically selects the appropriate transport
 */

import {
  isElectron,
  httpRequest,
  onEvent,
  connectWebSocket,
  disconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,
  setAuthToken,
  clearAuthToken,
  getAuthToken
} from './transport'
import type { InvocationContext, ResourceListView } from '../../shared/resource-access'

// Response type
interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  errorCode?: string
}

interface AskUserQuestionAnswerPayload {
  toolCallId: string
  answersByQuestionId: Record<string, string[]>
  skippedQuestionIds: string[]
  runId?: string
}

/**
 * API object - drop-in replacement for window.kite
 * Works in both Electron and remote web mode
 */
export const api = {
  // ===== Authentication (remote only) =====
  isRemoteMode: () => !isElectron(),
  isAuthenticated: () => !!getAuthToken(),

  login: async (token: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return { success: true }
    }

    const result = await httpRequest<void>('POST', '/api/remote/login', { token })
    if (result.success) {
      setAuthToken(token)
      connectWebSocket()
    }
    return result
  },

  logout: () => {
    clearAuthToken()
    disconnectWebSocket()
  },

  // ===== Config =====
  getConfig: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getConfig()
    }
    return httpRequest('GET', '/api/config')
  },

  setConfig: async (updates: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setConfig(updates)
    }
    return httpRequest('POST', '/api/config', updates)
  },

  validateApi: async (
    apiKey: string,
    apiUrl: string,
    provider: string,
    protocol?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.validateApi(apiKey, apiUrl, provider, protocol)
    }
    return httpRequest('POST', '/api/config/validate', { apiKey, apiUrl, provider, protocol })
  },

  // ===== Space =====
  getKiteSpace: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getKiteSpace()
    }
    return httpRequest('GET', '/api/spaces/kite')
  },

  listSpaces: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listSpaces()
    }
    return httpRequest('GET', '/api/spaces')
  },

  createSpace: async (input: {
    name: string
    icon: string
    customPath?: string
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createSpace(input)
    }
    return httpRequest('POST', '/api/spaces', input)
  },

  deleteSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteSpace(spaceId)
    }
    return httpRequest('DELETE', `/api/spaces/${spaceId}`)
  },

  getSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSpace(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}`)
  },

  openSpaceFolder: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openSpaceFolder(spaceId)
    }
    // In remote mode, just return the path (can't open folder remotely)
    return httpRequest('POST', `/api/spaces/${spaceId}/open`)
  },

  getDefaultSpacePath: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getDefaultSpacePath()
    }
    // In remote mode, get default path from server
    return httpRequest('GET', '/api/spaces/default-path')
  },

  selectFolder: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.selectFolder()
    }
    // Cannot select folder in remote mode
    return { success: false, error: 'Cannot select folder in remote mode' }
  },

  updateSpace: async (
    spaceId: string,
    updates: { name?: string; icon?: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSpace(spaceId, updates)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}`, updates)
  },

  // Update space preferences (layout settings)
  updateSpacePreferences: async (
    spaceId: string,
    preferences: {
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
    }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSpacePreferences(spaceId, preferences)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}/preferences`, preferences)
  },

  // Get space preferences
  getSpacePreferences: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSpacePreferences(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/preferences`)
  },

  // ===== Conversation =====
  listConversations: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listConversations(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations`)
  },

  createConversation: async (spaceId: string, title?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createConversation(spaceId, title)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/conversations`, { title })
  },

  getConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getConversation(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations/${conversationId}`)
  },

  updateConversation: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateConversation(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}`,
      updates
    )
  },

  deleteConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteConversation(spaceId, conversationId)
    }
    return httpRequest(
      'DELETE',
      `/api/spaces/${spaceId}/conversations/${conversationId}`
    )
  },

  addMessage: async (
    spaceId: string,
    conversationId: string,
    message: { role: string; content: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.addMessage(spaceId, conversationId, message)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages`,
      message
    )
  },

  updateLastMessage: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateLastMessage(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages/last`,
      updates
    )
  },

  // ===== Change Sets =====
  listChangeSets: async (spaceId: string, conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listChangeSets(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations/${conversationId}/change-sets`)
  },

  acceptChangeSet: async (params: {
    spaceId: string
    conversationId: string
    changeSetId: string
    filePath?: string
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.acceptChangeSet(params)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${params.spaceId}/conversations/${params.conversationId}/change-sets/accept`,
      { changeSetId: params.changeSetId, filePath: params.filePath }
    )
  },

  rollbackChangeSet: async (params: {
    spaceId: string
    conversationId: string
    changeSetId: string
    filePath?: string
    force?: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.rollbackChangeSet(params)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${params.spaceId}/conversations/${params.conversationId}/change-sets/rollback`,
      { changeSetId: params.changeSetId, filePath: params.filePath, force: params.force }
    )
  },

  // ===== Agent =====
  sendMessage: async (request: {
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
    invocationContext?: InvocationContext
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
    fileContexts?: Array<{  // File contexts for context injection
      id: string
      type: 'file-context'
      path: string
      name: string
      extension: string
    }>
  }): Promise<ApiResponse> => {
    // Subscribe to conversation events before sending
    if (!isElectron()) {
      subscribeToConversation(request.conversationId)
    }

    if (isElectron()) {
      return window.kite.sendMessage(request)
    }
    return httpRequest('POST', '/api/agent/message', request)
  },

  sendWorkflowStepMessage: async (request: {
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
    aiBrowserEnabled?: boolean
    thinkingEnabled?: boolean
    planEnabled?: boolean
    canvasContext?: {
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
  }): Promise<ApiResponse> => {
    if (!isElectron()) {
      subscribeToConversation(request.conversationId)
    }

    if (isElectron()) {
      return window.kite.sendWorkflowStepMessage(request)
    }
    return httpRequest('POST', '/api/agent/message', {
      ...request,
      invocationContext: 'interactive'
    })
  },

  stopGeneration: async (conversationId?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.stopGeneration(conversationId)
    }
    return httpRequest('POST', '/api/agent/stop', { conversationId })
  },

  approveTool: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.approveTool(conversationId)
    }
    return httpRequest('POST', '/api/agent/approve', { conversationId })
  },

  rejectTool: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.rejectTool(conversationId)
    }
    return httpRequest('POST', '/api/agent/reject', { conversationId })
  },

  answerQuestion: async (
    conversationId: string,
    answer: string | AskUserQuestionAnswerPayload
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      const bridge = (window as unknown as { kite?: { answerQuestion?: (id: string, payload: string | AskUserQuestionAnswerPayload) => Promise<ApiResponse> } }).kite
      if (!bridge || typeof bridge.answerQuestion !== 'function') {
        return {
          success: false,
          error: 'IPC bridge unavailable: answerQuestion'
        }
      }
      return bridge.answerQuestion(conversationId, answer)
    }
    if (typeof answer === 'string') {
      return httpRequest('POST', '/api/agent/answer-question', { conversationId, answer })
    }
    return httpRequest('POST', '/api/agent/answer-question', { conversationId, payload: answer })
  },

  // Get current session state for recovery after refresh
  getSessionState: async (conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSessionState(conversationId)
    }
    return httpRequest('GET', `/api/agent/session/${conversationId}`)
  },

  // Warm up V2 session - call when switching conversations to prepare for faster message sending
  ensureSessionWarm: async (spaceId: string, conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      // No need to wait, initialize in background
      window.kite.ensureSessionWarm(spaceId, conversationId).catch((error: unknown) => {
        console.error('[API] ensureSessionWarm error:', error)
      })
      return { success: true }
    }
    // HTTP mode: send warm-up request to backend
    return httpRequest('POST', '/api/agent/warm', { spaceId, conversationId }).catch(() => ({
      success: false // Warm-up failure should not block
    }))
  },

  getAgentResourceHash: async (
    params?: { spaceId?: string; workDir?: string; conversationId?: string }
  ): Promise<ApiResponse<{ hash: string; workDir?: string | null; sessionResourceHash?: string | null }>> => {
    if (isElectron()) {
      return window.kite.getAgentResourceHash(params)
    }
    const query = new URLSearchParams()
    if (params?.spaceId) query.append('spaceId', params.spaceId)
    if (params?.workDir) query.append('workDir', params.workDir)
    if (params?.conversationId) query.append('conversationId', params.conversationId)
    const suffix = query.toString()
    return httpRequest('GET', `/api/agent/resource-hash${suffix ? `?${suffix}` : ''}`)
  },

  // Test MCP server connections
  testMcpConnections: async (): Promise<{ success: boolean; servers: unknown[]; error?: string }> => {
    if (isElectron()) {
      return window.kite.testMcpConnections()
    }
    // HTTP mode: call backend endpoint
    const result = await httpRequest('POST', '/api/agent/test-mcp')
    return result as { success: boolean; servers: unknown[]; error?: string }
  },

  // ===== Artifact =====
  listArtifacts: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listArtifacts(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts`)
  },

  listArtifactsTree: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listArtifactsTree(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts/tree`)
  },

  openArtifact: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openArtifact(filePath)
    }
    // Can't open files remotely
    return { success: false, error: 'Cannot open files in remote mode' }
  },

  showArtifactInFolder: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showArtifactInFolder(filePath)
    }
    // Can't open folder remotely
    return { success: false, error: 'Cannot open folder in remote mode' }
  },

  // Download artifact (remote mode only - triggers browser download)
  downloadArtifact: (filePath: string): void => {
    if (isElectron()) {
      // In Electron, just open the file
      window.kite.openArtifact(filePath)
      return
    }
    // In remote mode, trigger download via browser with token in URL
    const token = getAuthToken()
    const url = `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
    const link = document.createElement('a')
    link.href = url
    link.download = filePath.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  },

  // Get download URL for an artifact (for use with fetch or direct links)
  getArtifactDownloadUrl: (filePath: string): string => {
    const token = getAuthToken()
    return `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
  },

  // Read artifact content for Content Canvas
  readArtifactContent: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.readArtifactContent(filePath)
    }
    // In remote mode, fetch content via API
    return httpRequest('GET', `/api/artifacts/content?path=${encodeURIComponent(filePath)}`)
  },

  // Write artifact content for Content Canvas editing
  writeArtifactContent: async (filePath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.writeArtifactContent(filePath, content)
    }
    // In remote mode, write content via API
    return httpRequest('POST', '/api/artifacts/content', { path: filePath, content })
  },

  // Create a new folder
  createFolder: async (folderPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createFolder(folderPath)
    }
    return httpRequest('POST', '/api/artifacts/folder', { path: folderPath })
  },

  // Create a new file
  createFile: async (filePath: string, content?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createFile(filePath, content)
    }
    return httpRequest('POST', '/api/artifacts/file', { path: filePath, content })
  },

  // Rename a file or folder
  renameArtifact: async (oldPath: string, newName: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.renameArtifact(oldPath, newName)
    }
    return httpRequest('POST', '/api/artifacts/rename', { oldPath, newName })
  },

  // Delete a file or folder
  deleteArtifact: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteArtifact(filePath)
    }
    return httpRequest('DELETE', `/api/artifacts?path=${encodeURIComponent(filePath)}`)
  },

  // Move a file or folder
  moveArtifact: async (sourcePath: string, targetDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.moveArtifact(sourcePath, targetDir)
    }
    return httpRequest('POST', '/api/artifacts/move', { sourcePath, targetDir })
  },

  // Copy a file or folder
  copyArtifact: async (sourcePath: string, targetDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyArtifact(sourcePath, targetDir)
    }
    return httpRequest('POST', '/api/artifacts/copy', { sourcePath, targetDir })
  },

  // ===== Onboarding =====
  writeOnboardingArtifact: async (
    spaceId: string,
    fileName: string,
    content: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.writeOnboardingArtifact(spaceId, fileName, content)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/artifact`, { fileName, content })
  },

  saveOnboardingConversation: async (
    spaceId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.saveOnboardingConversation(spaceId, userMessage, aiResponse)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/conversation`, { userMessage, aiResponse })
  },

  // ===== Skills =====
  listSkills: async (
    workDir: string | undefined,
    locale: string | undefined,
    view: ResourceListView
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listSkills(workDir, locale, view)
    }
    const params = new URLSearchParams()
    if (workDir) params.append('workDir', workDir)
    if (locale) params.append('locale', locale)
    params.append('view', view)
    const query = params.toString()
    return httpRequest('GET', `/api/skills${query ? `?${query}` : ''}`)
  },

  getSkillContent: async (name: string, workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSkillContent(name, workDir)
    }
    const params = new URLSearchParams({ name })
    if (workDir) params.append('workDir', workDir)
    return httpRequest('GET', `/api/skills/content?${params.toString()}`)
  },

  createSkill: async (workDir: string, name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createSkill(workDir, name, content)
    }
    return httpRequest('POST', '/api/skills', { workDir, name, content })
  },

  updateSkill: async (skillPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSkill(skillPath, content)
    }
    return httpRequest('PUT', '/api/skills', { skillPath, content })
  },

  deleteSkill: async (skillPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteSkill(skillPath)
    }
    return httpRequest('DELETE', `/api/skills?path=${encodeURIComponent(skillPath)}`)
  },

  copySkillToSpace: async (skillName: string, workDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copySkillToSpace(skillName, workDir)
    }
    return httpRequest('POST', '/api/skills/copy', { skillName, workDir })
  },

  copySkillToSpaceByRef: async (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copySkillToSpaceByRef(ref, workDir, options)
    }
    return httpRequest('POST', '/api/skills/copy-by-ref', { ref, workDir, options })
  },

  clearSkillsCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearSkillsCache()
    }
    return httpRequest('POST', '/api/skills/clear-cache')
  },

  refreshSkillsIndex: async (workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.refreshSkillsIndex(workDir)
    }
    return httpRequest('POST', '/api/skills/refresh', { workDir })
  },

  // ===== Commands =====
  listCommands: async (
    workDir: string | undefined,
    locale: string | undefined,
    view: ResourceListView
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listCommands(workDir, locale, view)
    }
    const params = new URLSearchParams()
    if (workDir) params.append('workDir', workDir)
    if (locale) params.append('locale', locale)
    params.append('view', view)
    const query = params.toString()
    return httpRequest('GET', `/api/commands${query ? `?${query}` : ''}`)
  },

  getCommandContent: async (name: string, workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getCommandContent(name, workDir)
    }
    const params = new URLSearchParams({ name })
    if (workDir) params.append('workDir', workDir)
    return httpRequest('GET', `/api/commands/content?${params.toString()}`)
  },

  createCommand: async (workDir: string, name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createCommand(workDir, name, content)
    }
    return httpRequest('POST', '/api/commands', { workDir, name, content })
  },

  updateCommand: async (commandPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateCommand(commandPath, content)
    }
    return httpRequest('PUT', '/api/commands', { commandPath, content })
  },

  deleteCommand: async (commandPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteCommand(commandPath)
    }
    return httpRequest('DELETE', `/api/commands?path=${encodeURIComponent(commandPath)}`)
  },

  copyCommandToSpace: async (commandName: string, workDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyCommandToSpace(commandName, workDir)
    }
    return httpRequest('POST', '/api/commands/copy', { commandName, workDir })
  },

  copyCommandToSpaceByRef: async (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyCommandToSpaceByRef(ref, workDir, options)
    }
    return httpRequest('POST', '/api/commands/copy-by-ref', { ref, workDir, options })
  },

  clearCommandsCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearCommandsCache()
    }
    return httpRequest('POST', '/api/commands/clear-cache')
  },

  // ===== Agents =====
  listAgents: async (
    workDir: string | undefined,
    locale: string | undefined,
    view: ResourceListView
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listAgents(workDir, locale, view)
    }
    const params = new URLSearchParams()
    if (workDir) params.append('workDir', workDir)
    if (locale) params.append('locale', locale)
    params.append('view', view)
    const query = params.toString()
    return httpRequest('GET', `/api/agents${query ? `?${query}` : ''}`)
  },

  getAgentContent: async (name: string, workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getAgentContent(name, workDir)
    }
    const params = new URLSearchParams({ name })
    if (workDir) params.append('workDir', workDir)
    return httpRequest('GET', `/api/agents/content?${params.toString()}`)
  },

  createAgent: async (workDir: string, name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createAgent(workDir, name, content)
    }
    return httpRequest('POST', '/api/agents', { workDir, name, content })
  },

  updateAgent: async (agentPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateAgent(agentPath, content)
    }
    return httpRequest('PUT', '/api/agents', { agentPath, content })
  },

  deleteAgent: async (agentPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteAgent(agentPath)
    }
    return httpRequest('DELETE', `/api/agents?path=${encodeURIComponent(agentPath)}`)
  },

  copyAgentToSpace: async (agentName: string, workDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyAgentToSpace(agentName, workDir)
    }
    return httpRequest('POST', '/api/agents/copy', { agentName, workDir })
  },

  copyAgentToSpaceByRef: async (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyAgentToSpaceByRef(ref, workDir, options)
    }
    return httpRequest('POST', '/api/agents/copy-by-ref', { ref, workDir, options })
  },

  clearAgentsCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearAgentsCache()
    }
    return httpRequest('POST', '/api/agents/clear-cache')
  },

  // ===== Scene Taxonomy =====
  getSceneTaxonomy: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSceneTaxonomy()
    }
    return httpRequest('GET', '/api/scene-taxonomy')
  },

  upsertSceneDefinition: async (definition: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.upsertSceneDefinition(definition)
    }
    return httpRequest('PUT', '/api/scene-taxonomy/definitions', definition)
  },

  removeSceneDefinition: async (key: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.removeSceneDefinition(key)
    }
    return httpRequest('DELETE', `/api/scene-taxonomy/definitions/${encodeURIComponent(key)}`)
  },

  setResourceSceneOverride: async (resourceKey: string, tags: string[]): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setResourceSceneOverride(resourceKey, tags)
    }
    return httpRequest('PUT', '/api/scene-taxonomy/overrides', { resourceKey, tags })
  },

  removeResourceSceneOverride: async (resourceKey: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.removeResourceSceneOverride(resourceKey)
    }
    return httpRequest('DELETE', `/api/scene-taxonomy/overrides?resourceKey=${encodeURIComponent(resourceKey)}`)
  },

  exportSceneTaxonomy: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.exportSceneTaxonomy()
    }
    return httpRequest('GET', '/api/scene-taxonomy/export')
  },

  importSceneTaxonomy: async (
    payload: Record<string, unknown>,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.importSceneTaxonomy(payload, mode)
    }
    return httpRequest('POST', '/api/scene-taxonomy/import', { payload, mode })
  },

  // ===== Toolkit =====
  getToolkit: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getToolkit(spaceId)
    }
    return httpRequest('GET', `/api/toolkit/${encodeURIComponent(spaceId)}`)
  },

  addToolkitResource: async (spaceId: string, directive: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.addToolkitResource(spaceId, directive)
    }
    return httpRequest('POST', `/api/toolkit/${encodeURIComponent(spaceId)}/add`, directive)
  },

  removeToolkitResource: async (spaceId: string, directive: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.removeToolkitResource(spaceId, directive)
    }
    return httpRequest('POST', `/api/toolkit/${encodeURIComponent(spaceId)}/remove`, directive)
  },

  clearToolkit: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearToolkit(spaceId)
    }
    return httpRequest('DELETE', `/api/toolkit/${encodeURIComponent(spaceId)}`)
  },

  migrateToToolkit: async (
    spaceId: string,
    skills: string[],
    agents: string[]
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.migrateToToolkit(spaceId, skills, agents)
    }
    return httpRequest('POST', `/api/toolkit/${encodeURIComponent(spaceId)}/migrate`, {
      skills,
      agents
    })
  },

  // ===== Presets =====
  listPresets: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listPresets()
    }
    return httpRequest('GET', '/api/presets')
  },

  getPreset: async (presetId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getPreset(presetId)
    }
    return httpRequest('GET', `/api/presets/${encodeURIComponent(presetId)}`)
  },

  // ===== Workflows =====
  listWorkflows: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listWorkflows(spaceId)
    }
    return httpRequest('GET', `/api/workflows?spaceId=${encodeURIComponent(spaceId)}`)
  },

  getWorkflow: async (spaceId: string, workflowId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getWorkflow(spaceId, workflowId)
    }
    return httpRequest('GET', `/api/workflows/${encodeURIComponent(workflowId)}?spaceId=${encodeURIComponent(spaceId)}`)
  },

  createWorkflow: async (spaceId: string, input: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createWorkflow(spaceId, input)
    }
    return httpRequest('POST', '/api/workflows', { spaceId, input })
  },

  updateWorkflow: async (spaceId: string, workflowId: string, updates: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateWorkflow(spaceId, workflowId, updates)
    }
    return httpRequest('PUT', `/api/workflows/${encodeURIComponent(workflowId)}`, { spaceId, updates })
  },

  deleteWorkflow: async (spaceId: string, workflowId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteWorkflow(spaceId, workflowId)
    }
    return httpRequest('DELETE', `/api/workflows/${encodeURIComponent(workflowId)}?spaceId=${encodeURIComponent(spaceId)}`)
  },

  // ===== Remote Access (Electron only) =====
  enableRemoteAccess: async (port?: number): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.enableRemoteAccess(port)
  },

  disableRemoteAccess: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.disableRemoteAccess()
  },

  enableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.enableTunnel()
  },

  disableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.disableTunnel()
  },

  getRemoteStatus: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getRemoteStatus()
  },

  getRemoteQRCode: async (includeToken?: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getRemoteQRCode(includeToken)
  },

  // ===== System Settings (Electron only) =====
  getAutoLaunch: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getAutoLaunch()
  },

  setAutoLaunch: async (enabled: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.setAutoLaunch(enabled)
  },

  getMinimizeToTray: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getMinimizeToTray()
  },

  setMinimizeToTray: async (enabled: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.setMinimizeToTray(enabled)
  },

  // ===== Window (Electron only) =====
  setTitleBarOverlay: async (options: {
    color: string
    symbolColor: string
  }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: true } // No-op in remote mode
    }
    return window.kite.setTitleBarOverlay(options)
  },

  maximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.maximizeWindow()
  },

  unmaximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.unmaximizeWindow()
  },

  isWindowMaximized: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.isWindowMaximized()
  },

  toggleMaximizeWindow: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.toggleMaximizeWindow()
  },

  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    if (!isElectron()) {
      return () => {} // No-op in remote mode
    }
    return window.kite.onWindowMaximizeChange(callback)
  },

  // ===== Event Listeners =====
  onAgentRunStart: (callback: (data: unknown) => void) =>
    onEvent('agent:run-start', callback),
  onAgentMessage: (callback: (data: unknown) => void) =>
    onEvent('agent:message', callback),
  onAgentToolCall: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-call', callback),
  onAgentToolResult: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-result', callback),
  onAgentProcess: (callback: (data: unknown) => void) =>
    onEvent('agent:process', callback),
  onAgentError: (callback: (data: unknown) => void) =>
    onEvent('agent:error', callback),
  onAgentComplete: (callback: (data: unknown) => void) =>
    onEvent('agent:complete', callback),
  onAgentThought: (callback: (data: unknown) => void) =>
    onEvent('agent:thought', callback),
  onAgentToolsAvailable: (callback: (data: unknown) => void) =>
    onEvent('agent:tools-available', callback),
  onAgentMcpStatus: (callback: (data: unknown) => void) =>
    onEvent('agent:mcp-status', callback),
  onAgentCompact: (callback: (data: unknown) => void) =>
    onEvent('agent:compact', callback),
  onSkillsChanged: (callback: (data: unknown) => void) =>
    onEvent('skills:changed', callback),
  onCommandsChanged: (callback: (data: unknown) => void) =>
    onEvent('commands:changed', callback),
  onAgentsChanged: (callback: (data: unknown) => void) =>
    onEvent('agents:changed', callback),
  onRemoteStatusChange: (callback: (data: unknown) => void) =>
    onEvent('remote:status-change', callback),

  // ===== WebSocket Control =====
  connectWebSocket,
  disconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,

  // ===== Browser (Embedded Browser for Content Canvas) =====
  // Note: Browser features only available in desktop app (not remote mode)

  createBrowserView: async (viewId: string, url?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createBrowserView(viewId, url)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  destroyBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.destroyBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  showBrowserView: async (
    viewId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showBrowserView(viewId, bounds)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  hideBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.hideBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  resizeBrowserView: async (
    viewId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.resizeBrowserView(viewId, bounds)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  navigateBrowserView: async (viewId: string, url: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.navigateBrowserView(viewId, url)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserGoBack: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.browserGoBack(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserGoForward: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.browserGoForward(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserReload: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.browserReload(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  browserStop: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.browserStop(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  getBrowserState: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getBrowserState(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  captureBrowserView: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.captureBrowserView(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  executeBrowserJS: async (viewId: string, code: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.executeBrowserJS(viewId, code)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  setBrowserZoom: async (viewId: string, level: number): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setBrowserZoom(viewId, level)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  toggleBrowserDevTools: async (viewId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.toggleBrowserDevTools(viewId)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  showBrowserContextMenu: async (options: { viewId: string; url?: string; zoomLevel: number }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showBrowserContextMenu(options)
    }
    return { success: false, error: 'Browser views only available in desktop app' }
  },

  onBrowserStateChange: (callback: (data: unknown) => void) =>
    onEvent('browser:state-change', callback),

  onBrowserZoomChanged: (callback: (data: { viewId: string; zoomLevel: number }) => void) =>
    onEvent('browser:zoom-changed', callback as (data: unknown) => void),

  // Canvas Tab Context Menu (native Electron menu)
  showCanvasTabContextMenu: async (options: {
    tabId: string
    tabIndex: number
    tabTitle: string
    tabPath?: string
    tabCount: number
    hasTabsToRight: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showCanvasTabContextMenu(options)
    }
    return { success: false, error: 'Native menu only available in desktop app' }
  },

  onCanvasTabAction: (callback: (data: {
    action: 'close' | 'closeOthers' | 'closeToRight' | 'copyPath' | 'refresh'
    tabId?: string
    tabIndex?: number
    tabPath?: string
  }) => void) =>
    onEvent('canvas:tab-action', callback as (data: unknown) => void),

  // AI Browser active view change notification
  // Sent when AI Browser tools create or select a view
  onAIBrowserActiveViewChanged: (callback: (data: { viewId: string; url: string | null; title: string | null }) => void) =>
    onEvent('ai-browser:active-view-changed', callback as (data: unknown) => void),

  // ===== Search =====
  search: async (
    query: string,
    scope: 'conversation' | 'space' | 'global',
    conversationId?: string,
    spaceId?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.search(query, scope, conversationId, spaceId)
    }
    return httpRequest('POST', '/api/search', {
      query,
      scope,
      conversationId,
      spaceId
    })
  },

  cancelSearch: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.cancelSearch()
    }
    return httpRequest('POST', '/api/search/cancel')
  },

  onSearchProgress: (callback: (data: { current: number; total: number; searchId: string }) => void) =>
    onEvent('search:progress', callback),

  onSearchCancelled: (callback: () => void) =>
    onEvent('search:cancelled', callback),

  // ===== Updater (Electron only) =====
  checkForUpdates: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.checkForUpdates()
  },

  installUpdate: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.installUpdate()
  },

  getVersion: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getVersion()
  },

  onUpdaterStatus: (callback: (data: {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
    version?: string
    percent?: number
    message?: string
    releaseNotes?: string | { version: string; note: string }[]
  }) => void) => {
    if (!isElectron()) {
      return () => {} // No-op in remote mode
    }
    return window.kite.onUpdaterStatus(callback)
  },

  // ===== Overlay (Electron only) =====
  // Used for floating UI elements that need to render above BrowserViews
  showChatCapsuleOverlay: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.showChatCapsuleOverlay()
  },

  hideChatCapsuleOverlay: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.hideChatCapsuleOverlay()
  },

  onCanvasExitMaximized: (callback: () => void) => {
    if (!isElectron()) {
      return () => {} // No-op in remote mode
    }
    return window.kite.onCanvasExitMaximized(callback)
  },

  // ===== Performance Monitoring (Electron only, Developer Tools) =====
  perfStart: async (config?: { sampleInterval?: number; maxSamples?: number }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfStart(config)
  },

  perfStop: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfStop()
  },

  perfGetState: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfGetState()
  },

  perfGetHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfGetHistory()
  },

  perfClearHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfClearHistory()
  },

  perfSetConfig: async (config: { enabled?: boolean; sampleInterval?: number; warnOnThreshold?: boolean }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfSetConfig(config)
  },

  perfExport: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfExport()
  },

  onPerfSnapshot: (callback: (data: unknown) => void) =>
    onEvent('perf:snapshot', callback),

  onPerfWarning: (callback: (data: unknown) => void) =>
    onEvent('perf:warning', callback),

  // Report renderer metrics to main process (for combined monitoring)
  perfReportRendererMetrics: (metrics: {
    fps: number
    frameTime: number
    renderCount: number
    domNodes: number
    eventListeners: number
    jsHeapUsed: number
    jsHeapLimit: number
    longTasks: number
  }): void => {
    if (isElectron()) {
      window.kite.perfReportRendererMetrics(metrics)
    }
  },

  // ===== Git Bash (Windows only, Electron only) =====
  getGitBashStatus: async (): Promise<ApiResponse<{
    found: boolean
    path: string | null
    source: 'system' | 'app-local' | 'env-var' | null
  }>> => {
    if (!isElectron()) {
      // In remote mode, assume Git Bash is available (server handles it)
      return { success: true, data: { found: true, path: null, source: null } }
    }
    return window.kite.getGitBashStatus()
  },

  installGitBash: async (onProgress: (progress: {
    phase: 'downloading' | 'extracting' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  }) => void): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.installGitBash(onProgress)
  },

  openExternal: async (url: string): Promise<void> => {
    if (!isElectron()) {
      // In remote mode, open in new tab
      window.open(url, '_blank')
      return
    }
    return window.kite.openExternal(url)
  },
}

// Export type for the API
export type KiteApi = typeof api
