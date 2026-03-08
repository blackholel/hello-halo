import { describe, expect, it } from 'vitest'
import {
  buildConversationHistoryBootstrap,
  buildForcedAssumptionResponse,
  resolveFinalContent
} from '../message-flow.service'

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

describe('buildForcedAssumptionResponse', () => {
  it('uses Chinese content when response language is zh-CN', () => {
    const content = buildForcedAssumptionResponse('plan', 'zh-CN')

    expect(content).toContain('澄清预算已用尽')
    expect(content).toContain('## 默认假设下的计划')
  })

  it('uses English content when response language is en', () => {
    const content = buildForcedAssumptionResponse('code', 'en')

    expect(content).toContain('Clarification budget is exhausted')
    expect(content).toContain('## Default Assumption Execution')
  })
})

describe('buildConversationHistoryBootstrap', () => {
  it('当单个 turn 超过预算时，不应强制塞入 fallback turn', () => {
    const result = buildConversationHistoryBootstrap({
      historyMessages: [
        {
          role: 'user',
          content: 'x'.repeat(30000),
          images: [{ type: 'image', data: 'y'.repeat(20000) }]
        }
      ],
      maxBootstrapTokens: 10
    })

    expect(result.block).toBe('')
    expect(result.tokenEstimate).toBe(0)
    expect(result.appliedTurnCount).toBe(0)
  })
})
