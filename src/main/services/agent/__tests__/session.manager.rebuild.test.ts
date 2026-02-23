import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  unstable_v2_createSession: vi.fn()
}))

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({})),
  onApiConfigChange: vi.fn()
}))

vi.mock('../../toolkit.service', () => ({
  getToolkitHash: vi.fn(() => 'toolkit-hash')
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn(() => null)
}))

vi.mock('../electron-path', () => ({
  getHeadlessElectronPath: vi.fn(() => '/tmp/electron')
}))

vi.mock('../provider-resolver', () => ({
  resolveProvider: vi.fn()
}))

vi.mock('../ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn()
}))

vi.mock('../sdk-config.builder', () => ({
  buildSdkOptions: vi.fn(),
  getWorkingDir: vi.fn(),
  getEffectiveSkillsLazyLoad: vi.fn(() => ({ effectiveLazyLoad: false, toolkit: [] }))
}))

vi.mock('../renderer-comm', () => ({
  createCanUseTool: vi.fn()
}))

vi.mock('../../plugin-mcp.service', () => ({
  getEnabledPluginMcpHash: vi.fn(() => 'mcp-hash'),
  getEnabledPluginMcpList: vi.fn(() => [])
}))

import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import { closeAllV2Sessions, getOrCreateV2Session } from '../session.manager'
import type { SessionConfig } from '../types'

describe('session.manager rebuild', () => {
  const closeFirst = vi.fn()
  const closeSecond = vi.fn()

  beforeEach(() => {
    vi.mocked(unstable_v2_createSession)
      .mockResolvedValueOnce({ close: closeFirst } as any)
      .mockResolvedValueOnce({ close: closeSecond } as any)
  })

  afterEach(() => {
    closeAllV2Sessions()
    vi.clearAllMocks()
  })

  it('配置不变复用 session，配置变化触发重建', async () => {
    const configA: SessionConfig = {
      aiBrowserEnabled: false,
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      toolkitHash: 'toolkit-1',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    const configB: SessionConfig = {
      ...configA,
      effectiveModel: 'model-b'
    }

    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configB)

    expect(unstable_v2_createSession).toHaveBeenCalledTimes(2)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(closeSecond).not.toHaveBeenCalled()
  })
})
