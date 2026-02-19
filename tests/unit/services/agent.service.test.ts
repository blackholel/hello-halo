/**
 * Agent Service Tests - CLAUDE_CONFIG_DIR and settingSources
 *
 * Tests for the configuration isolation mechanism:
 * - CLAUDE_CONFIG_DIR should be set to ~/.kite/ in SDK env
 * - strict only-space policy should force settingSources to ['local']
 *
 * These tests verify that Halo uses ~/.halo/ as its config directory
 * instead of ~/.claude/, providing complete isolation from system Claude Code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'

// Mock dependencies before importing the module under test
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/mock/userData'
      if (name === 'home') return '/mock/home'
      return '/mock'
    }),
    isPackaged: false
  },
  BrowserWindow: vi.fn()
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    api: {
      provider: 'anthropic',
      apiKey: 'test-key',
      apiUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514'
    },
    permissions: {
      commandExecution: 'allow',
      trustMode: true,
      fileAccess: 'allow',
      networkAccess: 'allow'
    },
    mcpServers: {},
    appearance: { theme: 'system' },
    system: { autoLaunch: false, minimizeToTray: false },
    remoteAccess: { enabled: false, port: 3000 },
    onboarding: { completed: true },
    isFirstLaunch: false
  })),
  getHaloDir: vi.fn(() => join(homedir(), '.halo')),
  getTempSpacePath: vi.fn(() => '/mock/temp'),
  onApiConfigChange: vi.fn(() => () => {})
}))

vi.mock('../../../src/main/services/space-config.service', () => ({
  getSpaceConfig: vi.fn(() => null)
}))

vi.mock('../../../src/main/services/hooks.service', () => ({
  buildHooksConfig: vi.fn(() => ({}))
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  getInstalledPluginPaths: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/conversation.service', () => ({
  getConversation: vi.fn(() => null),
  saveSessionId: vi.fn(),
  addMessage: vi.fn(),
  updateLastMessage: vi.fn()
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getSpace: vi.fn(() => ({ id: 'test-space', name: 'Test', path: '/test/workspace' }))
}))

vi.mock('../../../src/main/services/python.service', () => ({
  getEmbeddedPythonDir: vi.fn(() => '/mock/python'),
  getPythonEnhancedPath: vi.fn(() => '/mock/python/bin:/usr/bin')
}))

vi.mock('../../../src/main/http/websocket', () => ({
  broadcastToAll: vi.fn(),
  broadcastToWebSocket: vi.fn()
}))

vi.mock('../../../src/main/openai-compat-router', () => ({
  ensureOpenAICompatRouter: vi.fn(),
  encodeBackendConfig: vi.fn()
}))

vi.mock('../../../src/main/services/ai-browser', () => ({
  isAIBrowserTool: vi.fn(() => false),
  AI_BROWSER_SYSTEM_PROMPT: '',
  createAIBrowserMcpServer: vi.fn()
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  unstable_v2_createSession: vi.fn()
}))

// Import after mocks are set up
import { getConfig } from '../../../src/main/services/config.service'
import { getSpaceConfig } from '../../../src/main/services/space-config.service'

// Import the exported test helpers
import {
  _testBuildSettingSources,
  _testBuildSdkOptionsEnv
} from '../../../src/main/services/agent'

describe('Agent Service - CLAUDE_CONFIG_DIR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildSdkOptions env.CLAUDE_CONFIG_DIR', () => {
    it('should set CLAUDE_CONFIG_DIR to ~/.halo/ in env', () => {
      // This test verifies that the SDK options include CLAUDE_CONFIG_DIR
      // pointing to ~/.halo/ so SDK loads config from there instead of ~/.claude/

      const env = _testBuildSdkOptionsEnv()

      expect(env.CLAUDE_CONFIG_DIR).toBeDefined()
      expect(env.CLAUDE_CONFIG_DIR).toBe(join(homedir(), '.halo'))
    })

    it('should NOT point CLAUDE_CONFIG_DIR to ~/.claude/', () => {
      const env = _testBuildSdkOptionsEnv()

      expect(env.CLAUDE_CONFIG_DIR).not.toContain('.claude')
    })
  })

  describe('buildSettingSources', () => {
    it('should return ["local"] by default in strict space-only mode', () => {
      const sources = _testBuildSettingSources('/test/workspace')
      expect(sources).toEqual(['local'])
    })

    it('should remain ["local"] when project settings are disabled under strict mode', () => {
      vi.mocked(getSpaceConfig).mockReturnValue({
        claudeCode: {
          enableProjectSettings: false
        }
      } as any)

      const sources = _testBuildSettingSources('/test/workspace')
      expect(sources).toEqual(['local'])
    })

    it('should keep legacy behavior when resource policy is explicitly legacy', () => {
      vi.mocked(getSpaceConfig).mockReturnValue({
        resourcePolicy: {
          version: 1,
          mode: 'legacy'
        }
      } as any)

      const sources = _testBuildSettingSources('/test/workspace')
      expect(sources).toEqual(['user', 'project'])
    })

    it('should exclude "project" in legacy mode when explicitly disabled', () => {
      vi.mocked(getSpaceConfig).mockReturnValue({
        resourcePolicy: {
          version: 1,
          mode: 'legacy'
        },
        claudeCode: {
          enableProjectSettings: false
        }
      } as any)

      const sources = _testBuildSettingSources('/test/workspace')
      expect(sources).toEqual(['user'])
    })
  })
})

describe('Agent Service - Configuration Isolation', () => {
  it('should use ~/.halo/ as the config directory via CLAUDE_CONFIG_DIR', () => {
    const env = _testBuildSdkOptionsEnv()

    // Should point to ~/.halo/, not ~/.claude/
    expect(env.CLAUDE_CONFIG_DIR).not.toContain('.claude')
    expect(env.CLAUDE_CONFIG_DIR).toContain('.halo')
  })

  it('should force local settings source by default in strict mode', () => {
    const sources = _testBuildSettingSources('/test/workspace')
    expect(sources).toEqual(['local'])
  })
})
