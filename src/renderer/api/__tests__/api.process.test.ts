import { beforeEach, describe, expect, it, vi } from 'vitest'

const onEventMock = vi.fn(() => () => {})

vi.mock('../transport', () => ({
  isElectron: vi.fn(() => false),
  httpRequest: vi.fn(),
  onEvent: onEventMock,
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  subscribeToConversation: vi.fn(),
  unsubscribeFromConversation: vi.fn(),
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(() => null)
}))

describe('api.onAgentProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers process listener via transport.onEvent', async () => {
    const { api } = await import('..')
    const callback = vi.fn()

    const unsub = api.onAgentProcess(callback)

    expect(onEventMock).toHaveBeenCalledWith('agent:process', callback)
    expect(typeof unsub).toBe('function')
  })
})
