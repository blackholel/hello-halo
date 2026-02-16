import { describe, expect, it } from 'vitest'
import { resolveFinalContent } from '../message-flow.service'

describe('resolveFinalContent priority', () => {
  it('prefers result content first', () => {
    const content = resolveFinalContent({
      resultContent: 'from-result',
      latestAssistantContent: 'from-session',
      accumulatedTextContent: 'from-accumulated',
      currentStreamingText: 'from-stream'
    })

    expect(content).toBe('from-result')
  })

  it('falls back to latest assistant content when result is empty', () => {
    const content = resolveFinalContent({
      resultContent: '   ',
      latestAssistantContent: 'from-session',
      accumulatedTextContent: 'from-accumulated',
      currentStreamingText: 'from-stream'
    })

    expect(content).toBe('from-session')
  })

  it('uses accumulated + current streaming text as terminal fallback', () => {
    const content = resolveFinalContent({
      accumulatedTextContent: 'chunk-1',
      currentStreamingText: 'chunk-2'
    })

    expect(content).toBe('chunk-1\n\nchunk-2')
  })
})
