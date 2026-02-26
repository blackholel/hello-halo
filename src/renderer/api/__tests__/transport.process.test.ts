import { beforeEach, describe, expect, it, vi } from 'vitest'

function createLocalStorageMock(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
}

describe('transport.onEvent agent:process', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('electron mode maps to window.kite.onAgentProcess', async () => {
    const unsub = vi.fn()
    const onAgentProcess = vi.fn(() => unsub)

    ;(globalThis as any).window = {
      kite: {
        onAgentProcess
      }
    }

    const { onEvent } = await import('../transport')
    const callback = vi.fn()

    const returnedUnsub = onEvent('agent:process', callback)

    expect(onAgentProcess).toHaveBeenCalledTimes(1)
    expect(onAgentProcess).toHaveBeenCalledWith(callback)
    expect(returnedUnsub).toBe(unsub)
  })

  it('remote mode dispatches websocket event to agent:process listeners', async () => {
    class MockWebSocket {
      static OPEN = 1
      static latest: MockWebSocket | null = null
      readyState = MockWebSocket.OPEN
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      sent: string[] = []
      url: string

      constructor(url: string) {
        this.url = url
        MockWebSocket.latest = this
      }

      send(data: string): void {
        this.sent.push(data)
      }

      close(): void {
        this.readyState = 3
      }
    }

    ;(globalThis as any).WebSocket = MockWebSocket
    ;(globalThis as any).localStorage = createLocalStorageMock({ kite_remote_token: 'token-1' })
    ;(globalThis as any).window = {
      location: {
        origin: 'http://localhost:3456',
        reload: vi.fn()
      }
    }

    const { connectWebSocket, onEvent } = await import('../transport')
    const callback = vi.fn()

    const unsubscribe = onEvent('agent:process', callback)
    connectWebSocket()

    const ws = MockWebSocket.latest
    expect(ws).not.toBeNull()
    ws?.onopen?.()
    ws?.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'agent:process',
        data: { runId: 'run-1', kind: 'thought' }
      })
    })

    expect(callback).toHaveBeenCalledWith({ runId: 'run-1', kind: 'thought' })

    unsubscribe()
    ws?.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'agent:process',
        data: { runId: 'run-2', kind: 'thought' }
      })
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })
})

describe('transport.onEvent agent:mode', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('electron mode maps to window.kite.onAgentMode', async () => {
    const unsub = vi.fn()
    const onAgentMode = vi.fn(() => unsub)

    ;(globalThis as any).window = {
      kite: {
        onAgentMode
      }
    }

    const { onEvent } = await import('../transport')
    const callback = vi.fn()

    const returnedUnsub = onEvent('agent:mode', callback)

    expect(onAgentMode).toHaveBeenCalledTimes(1)
    expect(onAgentMode).toHaveBeenCalledWith(callback)
    expect(returnedUnsub).toBe(unsub)
  })
})
