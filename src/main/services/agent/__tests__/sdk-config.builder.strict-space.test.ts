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
  getSpace: vi.fn(() => null),
  getAllSpacePaths: vi.fn(() => ['/workspace/project', '/workspace/space-b', '/workspace/space-a'])
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
  buildSystemPromptAppend,
  getEnabledMcpServers,
  getWorkingDir
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
  it('does not force settingSources to local under strict policy', () => {
    const sources = buildSettingSources('/workspace/project')
    expect(sources).toEqual(['user', 'project'])
  })

  it('keeps global plugin directories available under strict policy', () => {
    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/enabled/plugin-a')
    expect(paths).toContain('/global/plugins')
    expect(paths).toContain('/home/test/.kite')
    expect(paths).toContain('/workspace/project/.local-plugins')
    expect(paths).toContain('/workspace/project/.claude')
  })

  it('full-mesh 运行时降级后不再聚合其他 space 的 .claude 目录', () => {
    const plugins = buildPluginsConfig('/workspace/project', {
      resourceRuntimePolicy: 'full-mesh'
    })
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/workspace/project/.claude')
    expect(paths).not.toContain('/workspace/space-a/.claude')
    expect(paths).not.toContain('/workspace/space-b/.claude')
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

  it('full-mesh 降级后仍注入 disable-slash-commands', () => {
    const sdkOptionsDefault = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'app-single-source'
    })
    const sdkOptionsFullMesh = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'full-mesh'
    })

    expect(sdkOptionsDefault.extraArgs['disable-slash-commands']).toBeNull()
    expect(sdkOptionsFullMesh.extraArgs['disable-slash-commands']).toBeNull()
  })

  it('full-mesh 降级后 allowedTools 不再包含 Skill', () => {
    const sdkOptionsDefault = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'app-single-source'
    })
    const sdkOptionsFullMesh = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'full-mesh'
    })

    expect(sdkOptionsDefault.allowedTools).not.toContain('Skill')
    expect(sdkOptionsFullMesh.allowedTools).not.toContain('Skill')
  })

  it('会过滤不符合 schema 的 MCP 配置，仅保留有效项', () => {
    const enabled = getEnabledMcpServers(
      {
        demo: { env: {} },
        stdioOk: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc', NUM: 1 } },
        httpBad: { type: 'http', headers: { Authorization: 'Bearer x' } },
        sseOk: { type: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x', Retry: 3 } },
        disabledServer: { command: 'python', disabled: true }
      } as any,
      '/workspace/project'
    )

    expect(enabled).toEqual({
      stdioOk: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc' } },
      sseOk: { type: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x' } }
    })
  })

  it('system prompt append includes blocking-batch AskUserQuestion policy', () => {
    const append = buildSystemPromptAppend('/workspace/project', 'zh-CN')

    expect(append).toContain('execution-blocking gaps')
    expect(append).toContain('higher priority than plain-text clarification')
    expect(append).toContain('at most 3 questions')
    expect(append).toContain('Avoid duplicate question texts and duplicate option labels')
    expect(append).toContain('plain-text clarification is allowed only once per conversation')
    expect(append).toContain('Language policy')
    expect(append).toContain('zh-CN')
    expect(append).not.toContain('Do NOT use resources outside this list.')
  })

  it('getWorkingDir throws explicit SPACE_NOT_FOUND_FOR_WORKDIR for missing normal space', () => {
    expect(() => getWorkingDir('missing-space')).toThrow(/missing-space/)

    try {
      getWorkingDir('missing-space')
    } catch (error) {
      const typedError = error as Error & { errorCode?: string }
      expect(typedError.errorCode).toBe('SPACE_NOT_FOUND_FOR_WORKDIR')
    }
  })
})
