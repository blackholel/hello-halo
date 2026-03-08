import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('monaco-editor', () => ({}))
vi.mock('@monaco-editor/react', () => ({
  loader: { config: vi.fn() },
  default: () => null
}))

import { createPlanDraftFlushController } from '../../../src/renderer/components/canvas/viewers/PlanEditor'

describe('PlanEditor draft flush controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('debounce 期间只保留最后一次输入并在超时后 flush', () => {
    const flushed: string[] = []
    const controller = createPlanDraftFlushController({
      debounceMs: 250,
      onFlush: (content) => flushed.push(content),
      setTimeoutFn: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      clearTimeoutFn: (handle) => clearTimeout(handle)
    })

    controller.schedule('draft-1')
    vi.advanceTimersByTime(100)
    controller.schedule('draft-2')
    vi.advanceTimersByTime(100)
    controller.schedule('draft-3')

    vi.advanceTimersByTime(249)
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(1)
    expect(flushed).toEqual(['draft-3'])
  })

  it('flushPending 会立刻提交待写入内容且不重复触发旧定时器', () => {
    const flushed: string[] = []
    const controller = createPlanDraftFlushController({
      debounceMs: 250,
      onFlush: (content) => flushed.push(content),
      setTimeoutFn: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      clearTimeoutFn: (handle) => clearTimeout(handle)
    })

    controller.schedule('draft-now')
    vi.advanceTimersByTime(80)
    controller.flushPending()

    expect(flushed).toEqual(['draft-now'])

    vi.advanceTimersByTime(500)
    expect(flushed).toEqual(['draft-now'])
  })

  it('clear 会丢弃待写入内容并取消后续 flush', () => {
    const flushed: string[] = []
    const controller = createPlanDraftFlushController({
      debounceMs: 250,
      onFlush: (content) => flushed.push(content),
      setTimeoutFn: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      clearTimeoutFn: (handle) => clearTimeout(handle)
    })

    controller.schedule('should-drop')
    controller.clear()

    vi.advanceTimersByTime(500)
    expect(flushed).toEqual([])
  })
})
