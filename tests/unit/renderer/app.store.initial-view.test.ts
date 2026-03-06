import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetConfig = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    getGitBashStatus: vi.fn().mockResolvedValue({
      success: true,
      data: { found: true, source: 'mock', mockMode: false }
    }),
    installGitBash: vi.fn(),
    setTitleBarOverlay: vi.fn().mockResolvedValue(undefined)
  }
}))

import { useAppStore } from '../../../src/renderer/stores/app.store'

describe('app.store initialize view routing', () => {
  beforeEach(() => {
    mockGetConfig.mockReset()
    useAppStore.setState({
      view: 'splash',
      previousView: null,
      isLoading: true,
      error: null,
      config: null
    } as any)
    ;(globalThis as unknown as { window?: { platform?: { isWindows?: boolean } } }).window = {
      platform: { isWindows: false }
    }
  })

  it('routes first-launch config to home instead of setup', async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      data: {
        isFirstLaunch: true,
        api: {
          provider: 'anthropic',
          apiKey: '',
          apiUrl: 'https://api.anthropic.com',
          model: 'claude-opus-4-5-20251101'
        },
        ai: {
          profiles: [
            {
              id: 'p1',
              name: 'Default',
              vendor: 'anthropic',
              protocol: 'anthropic_official',
              apiUrl: 'https://api.anthropic.com',
              apiKey: '',
              defaultModel: 'claude-opus-4-5-20251101',
              modelCatalog: ['claude-opus-4-5-20251101'],
              enabled: true
            }
          ],
          defaultProfileId: 'p1'
        }
      }
    })

    await useAppStore.getState().initialize()

    expect(useAppStore.getState().view).toBe('home')
  })
})
