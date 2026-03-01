import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        enabled: true,
        globalPaths: ['/global/plugins'],
        loadDefaultPaths: true
      },
      skillsLazyLoad: false
    }
  })),
  getTempSpacePath: vi.fn(() => '/tmp/kite-temp')
}))

vi.mock('../../space-config.service', () => ({
  getSpaceConfig: vi.fn((workDir: string) => ({
    resourcePolicy: {
      version: 1,
      mode: 'strict-space-only'
    },
    claudeCode: {
      plugins: {
        paths: ['.local-plugins']
      }
    }
  })),
  updateSpaceConfig: vi.fn()
}))

const MOCK_HOOKS = {
  PreToolUse: [
    {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo test-hook' }]
    }
  ]
}

vi.mock('../../hooks.service', () => ({
  buildHooksConfig: vi.fn(() => MOCK_HOOKS)
}))

vi.mock('../../toolkit.service', () => ({
  getSpaceToolkit: vi.fn(() => null)
}))

vi.mock('../../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [{ installPath: '/enabled/plugin-a' }])
}))

vi.mock('../../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../space.service', () => ({
  getSpace: vi.fn(() => null)
}))

vi.mock('../../ai-browser', () => ({
  createAIBrowserMcpServer: vi.fn(),
  AI_BROWSER_SYSTEM_PROMPT: ''
}))

vi.mock('../../skills-mcp-server', () => ({
  SKILLS_LAZY_SYSTEM_PROMPT: ''
}))

vi.mock('../../plugin-mcp.service', () => ({
  buildPluginMcpServers: vi.fn(() => ({}))
}))

vi.mock('../../../utils/path-validation', () => ({
  isValidDirectoryPath: vi.fn(() => true)
}))

import { getSpaceConfig, updateSpaceConfig } from '../../space-config.service'
import { getConfig } from '../../config.service'
import { buildHooksConfig } from '../../hooks.service'
import {
  buildPluginsConfig,
  buildSdkOptions,
  buildSettingSources,
  buildSystemPromptAppend
} from '../sdk-config.builder'
import { ensureSpaceResourcePolicy, getExecutionLayerAllowedSources } from '../space-resource-policy.service'

function createBuildSdkOptionsParams(workDir: string = '/workspace/project') {
  return {
    spaceId: 'space-1',
    conversationId: 'conversation-1',
    workDir,
    config: {
      api: { provider: 'anthropic' },
      claudeCode: {
        plugins: {
          enabled: true,
          globalPaths: ['/global/plugins'],
          loadDefaultPaths: true
        },
        skillsLazyLoad: false
      }
    },
    abortController: new AbortController(),
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://api.anthropic.com',
    sdkModel: 'claude-test',
    electronPath: '/usr/bin/electron'
  } as any
}

describe('sdk-config.builder strict space-only', () => {
  it('forces settingSources to local under strict policy', () => {
    const sources = buildSettingSources('/workspace/project')
    expect(sources).toEqual(['local'])
  })

  it('loads global and space plugin directories under strict policy', () => {
    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/enabled/plugin-a')
    expect(paths).toContain('/home/test/.kite')
    expect(paths).toContain('/workspace/project/.local-plugins')
    expect(paths).toContain('/workspace/project/.claude')
    expect(paths).not.toContain('/global/plugins')
  })

  it('falls back to legacy behavior when policy is explicitly legacy', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy'
      },
      claudeCode: {
        plugins: {
          paths: ['.local-plugins']
        }
      }
    } as any)

    const sources = buildSettingSources('/workspace/project')
    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(sources).toEqual(['user', 'project'])
    expect(paths).toContain('/enabled/plugin-a')
    expect(paths).toContain('/global/plugins')
    expect(paths).toContain('/home/test/.kite')
    expect(paths).toContain('/workspace/project/.local-plugins')
    expect(paths).toContain('/workspace/project/.claude')
  })

  it('ignores enableSystemSkills and never injects ~/.claude user root', () => {
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        enableSystemSkills: true,
        plugins: {
          enabled: true,
          globalPaths: ['/global/plugins'],
          loadDefaultPaths: true
        },
        skillsLazyLoad: false
      }
    } as any)

    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy'
      },
      claudeCode: {
        plugins: {
          paths: []
        }
      }
    } as any)

    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/home/test/.kite')
    expect(paths).not.toContain('/home/test/.claude')
  })

  it('keeps hooks configurable through buildHooksConfig under strict policy', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'strict-space-only'
      },
      claudeCode: {
        plugins: {
          paths: ['.local-plugins']
        }
      }
    } as any)

    const sdkOptions = buildSdkOptions(createBuildSdkOptionsParams())

    expect(vi.mocked(buildHooksConfig)).toHaveBeenCalledWith('/workspace/project')
    expect(sdkOptions.hooks).toEqual(MOCK_HOOKS)
  })

  it('preserves explicit legacy resource policy during ensure migration', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy',
        allowMcp: true
      }
    } as any)

    const policy = ensureSpaceResourcePolicy('/workspace/project')

    expect(policy.mode).toBe('legacy')
    expect(vi.mocked(updateSpaceConfig)).not.toHaveBeenCalled()
  })

  it('keeps execution-layer directive sources available for global and space resources', () => {
    expect(getExecutionLayerAllowedSources()).toEqual(['app', 'global', 'space', 'installed', 'plugin'])
  })

  it('compat 场景会注入 ANTHROPIC_MODEL 与默认模型 env', () => {
    const sdkOptions = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      useAnthropicCompatModelMapping: true,
      effectiveModel: 'kimi-k2-0905-preview'
    })

    expect(sdkOptions.env.ANTHROPIC_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('kimi-k2-0905-preview')
  })

  it('system prompt append includes blocking-batch AskUserQuestion policy', () => {
    const append = buildSystemPromptAppend('/workspace/project')

    expect(append).toContain('execution-blocking gaps')
    expect(append).toContain('at most 3 questions')
    expect(append).toContain('Avoid duplicate question texts and duplicate option labels')
    expect(append).not.toContain('Do NOT use resources outside this list.')
  })
})
