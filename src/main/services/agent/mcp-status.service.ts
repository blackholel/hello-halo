/**
 * MCP Status Service
 *
 * Manages MCP server status caching and broadcasting.
 */

import { BrowserWindow } from 'electron'
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import { getConfig, getTempSpacePath } from '../config.service'
import { getMainWindow, setMainWindow } from './renderer-comm'
import { broadcastToAll } from '../../http/websocket'
import { getHeadlessElectronPath } from './electron-path'
import {
  buildAnthropicCompatEnvDefaults,
  resolveProvider,
  shouldEnableAnthropicCompatEnvDefaults
} from './provider-resolver'
import { resolveEffectiveConversationAi } from './ai-config-resolver'
import { getEnabledMcpServers } from './sdk-config.builder'
import type { McpServerStatusInfo } from './types'

// Cached MCP status - updated when SDK reports status during conversation
let cachedMcpStatus: McpServerStatusInfo[] = []
let lastMcpStatusUpdate: number = 0

// MCP test in progress flag
let mcpTestInProgress = false

/**
 * Get cached MCP status
 */
export function getCachedMcpStatus(): McpServerStatusInfo[] {
  return cachedMcpStatus
}

/**
 * Broadcast MCP status to all renderers (global, not conversation-specific)
 */
export function broadcastMcpStatus(mcpServers: Array<{ name: string; status: string }>): void {
  // Convert to our status type
  cachedMcpStatus = mcpServers.map((s) => ({
    name: s.name,
    status: s.status as McpServerStatusInfo['status']
  }))
  lastMcpStatusUpdate = Date.now()

  const eventData = {
    servers: cachedMcpStatus,
    timestamp: lastMcpStatusUpdate
  }

  // 1. Send to Electron renderer via IPC (global event)
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:mcp-status', eventData)
    console.log(`[Agent] Broadcast MCP status: ${cachedMcpStatus.length} servers`)
  }

  // 2. Broadcast to remote WebSocket clients
  try {
    // MCP status is a global event (not conversation-scoped), so send to all authenticated WS clients.
    broadcastToAll('agent:mcp-status', eventData)
  } catch (error) {
    // WebSocket module might not be initialized yet, ignore
  }
}

/**
 * Test MCP connections manually
 * Starts a temporary SDK query just to get MCP status
 */
export async function testMcpConnections(
  mainWindow?: BrowserWindow | null
): Promise<{ success: boolean; servers: McpServerStatusInfo[]; error?: string }> {
  if (mcpTestInProgress) {
    return { success: false, servers: cachedMcpStatus, error: 'Test already in progress' }
  }

  // Set currentMainWindow if provided (for broadcasting status to renderer)
  if (mainWindow) {
    setMainWindow(mainWindow)
  }

  mcpTestInProgress = true
  console.log('[Agent] Starting MCP connection test...')

  try {
    const config = getConfig()

    if (config.claudeCode?.mcpEnabled === false) {
      return { success: true, servers: [], error: 'MCP disabled by configuration' }
    }

    // Get enabled MCP servers from config
    const enabledMcpServers = getEnabledMcpServers(config.mcpServers || {})
    if (!enabledMcpServers || Object.keys(enabledMcpServers).length === 0) {
      return { success: true, servers: [], error: 'No MCP servers configured' }
    }

    console.log('[Agent] MCP servers to test:', Object.keys(enabledMcpServers).join(', '))

    // Use a temp space path for the query
    const cwd = getTempSpacePath()

    // Use the same electron path as sendMessage (prevents Dock icon on macOS)
    const electronPath = getHeadlessElectronPath()

    // Resolve provider configuration from effective conversation AI (falls back to default profile).
    const effectiveAi = resolveEffectiveConversationAi('kite-temp', 'mcp-status-test')
    if (!effectiveAi.profile.apiKey || effectiveAi.profile.apiKey.trim().length === 0) {
      return { success: false, servers: [], error: 'API key not configured' }
    }
    const resolved = await resolveProvider(effectiveAi.profile, effectiveAi.effectiveModel)
    const shouldInjectAnthropicCompatEnvDefaults = shouldEnableAnthropicCompatEnvDefaults(
      resolved.protocol,
      resolved.vendor,
      resolved.useAnthropicCompatModelMapping
    )

    // Create query with proper configuration (matching sendMessage)
    // Use a simple prompt that will get a quick response
    const abortController = new AbortController()
    const queryIterator = claudeQuery({
      prompt: 'hi', // Simple prompt to trigger MCP connection
      options: {
        apiKey: resolved.anthropicApiKey,
        model: resolved.sdkModel,
        anthropicBaseUrl: resolved.anthropicBaseUrl,
        cwd,
        executable: electronPath,
        executableArgs: ['--no-warnings'],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ELECTRON_NO_ATTACH_CONSOLE: '1',
          ANTHROPIC_API_KEY: resolved.anthropicApiKey,
          ANTHROPIC_AUTH_TOKEN: resolved.anthropicApiKey,
          ANTHROPIC_BASE_URL: resolved.anthropicBaseUrl,
          ...(shouldInjectAnthropicCompatEnvDefaults
            ? buildAnthropicCompatEnvDefaults(resolved.effectiveModel)
            : {}),
          NO_PROXY: 'localhost,127.0.0.1',
          no_proxy: 'localhost,127.0.0.1'
        },
        permissionMode: 'bypassPermissions',
        abortController,
        mcpServers: enabledMcpServers,
        maxTurns: 1 // Only need one turn to get MCP status
      } as any
    })

    // Iterate through messages looking for system message with MCP status
    let foundStatus = false
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        abortController.abort()
        reject(new Error('MCP test timeout'))
      }, 30000) // 30s timeout
    })

    const iteratePromise = (async () => {
      for await (const msg of queryIterator) {
        console.log('[Agent] MCP test received msg type:', msg.type)

        // Check for system message which contains MCP status
        if (msg.type === 'system') {
          const mcpServers = (msg as any).mcp_servers as
            | Array<{ name: string; status: string }>
            | undefined
          console.log('[Agent] MCP test mcp_servers field:', mcpServers)

          if (mcpServers) {
            console.log('[Agent] MCP test got status:', JSON.stringify(mcpServers))
            broadcastMcpStatus(mcpServers)
            foundStatus = true
          }
          // After getting system message with MCP status, abort to save resources
          abortController.abort()
          break
        }

        // If we get a result before system message, something is wrong
        if (msg.type === 'result') {
          break
        }
      }
    })()

    try {
      await Promise.race([iteratePromise, timeoutPromise])
    } catch (e) {
      // Ignore abort errors, they're expected
      if ((e as Error).name !== 'AbortError') {
        throw e
      }
    }

    if (foundStatus) {
      return { success: true, servers: cachedMcpStatus }
    } else {
      return { success: true, servers: [], error: 'No MCP status received from SDK' }
    }
  } catch (error) {
    const err = error as Error
    console.error('[Agent] MCP test error:', err)
    return { success: false, servers: cachedMcpStatus, error: err.message }
  } finally {
    mcpTestInProgress = false
  }
}
