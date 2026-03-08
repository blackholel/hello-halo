import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  isElectronMock,
  httpRequestMock,
  subscribeToConversationMock
} = vi.hoisted(() => ({
  isElectronMock: vi.fn(),
  httpRequestMock: vi.fn(),
  subscribeToConversationMock: vi.fn()
}))

vi.mock('../transport', () => ({
  isElectron: (...args: unknown[]) => isElectronMock(...args),
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
  onEvent: vi.fn(() => () => {}),
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  subscribeToConversation: (...args: unknown[]) => subscribeToConversationMock(...args),
  unsubscribeFromConversation: vi.fn(),
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(() => null)
}))

describe('renderer api language passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    httpRequestMock.mockResolvedValue({ success: true })
  })

  it('sendMessage 在 HTTP 模式透传 responseLanguage', async () => {
    isElectronMock.mockReturnValue(false)
    const { api } = await import('..')

    const request = {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: 'hello',
      responseLanguage: 'zh-CN' as const
    }
    await api.sendMessage(request)

    expect(subscribeToConversationMock).toHaveBeenCalledWith('conv-1')
    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agent/message', request)
  })

  it('sendWorkflowStepMessage 在 HTTP fallback 保留 responseLanguage 且强制 interactive', async () => {
    isElectronMock.mockReturnValue(false)
    const { api } = await import('..')

    await api.sendWorkflowStepMessage({
      spaceId: 'space-1',
      conversationId: 'conv-2',
      message: 'run',
      responseLanguage: 'ja'
    })

    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agent/message', {
      spaceId: 'space-1',
      conversationId: 'conv-2',
      message: 'run',
      responseLanguage: 'ja',
      invocationContext: 'interactive'
    })
  })

  it('ensureSessionWarm 在 Electron 模式透传 responseLanguage', async () => {
    isElectronMock.mockReturnValue(true)
    const ensureSessionWarmMock = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window = {
      kite: {
        ensureSessionWarm: ensureSessionWarmMock
      }
    }

    const { api } = await import('..')
    const result = await api.ensureSessionWarm('space-1', 'conv-3', 'fr')

    expect(result.success).toBe(true)
    expect(ensureSessionWarmMock).toHaveBeenCalledWith('space-1', 'conv-3', 'fr')
  })

  it('ensureSessionWarm 在 Electron 模式可透传 waitForReady', async () => {
    isElectronMock.mockReturnValue(true)
    const ensureSessionWarmMock = vi.fn().mockResolvedValue({ success: true })
    ;(globalThis as any).window = {
      kite: {
        ensureSessionWarm: ensureSessionWarmMock
      }
    }

    const { api } = await import('..')
    const result = await api.ensureSessionWarm('space-1', 'conv-5', 'en', { waitForReady: true })

    expect(result.success).toBe(true)
    expect(ensureSessionWarmMock).toHaveBeenCalledWith('space-1', 'conv-5', 'en', { waitForReady: true })
  })

  it('ensureSessionWarm 在 HTTP 模式透传 responseLanguage', async () => {
    isElectronMock.mockReturnValue(false)
    const { api } = await import('..')

    await api.ensureSessionWarm('space-1', 'conv-4', 'de')

    expect(httpRequestMock).toHaveBeenCalledWith('POST', '/api/agent/warm', {
      spaceId: 'space-1',
      conversationId: 'conv-4',
      responseLanguage: 'de'
    })
  })
})
