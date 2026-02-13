import { describe, expect, it } from 'vitest'
import type { Thought } from '../types'
import { normalizeAskUserQuestionToolResultThought } from '../message-flow.service'

function createToolResultThought(overrides: Partial<Thought> = {}): Thought {
  return {
    id: 'tool-ask-1',
    type: 'tool_result',
    content: 'Tool execution failed',
    timestamp: new Date().toISOString(),
    toolOutput: 'User answered: option-a',
    isError: true,
    status: 'error',
    ...overrides
  }
}

describe('message-flow AskUserQuestion tool_result normalization', () => {
  it('normalizes AskUserQuestion denied tool_result to success state', () => {
    const rawThought = createToolResultThought()
    const normalized = normalizeAskUserQuestionToolResultThought(rawThought, true)

    expect(normalized.isError).toBe(false)
    expect(normalized.status).toBe('success')
    expect(normalized.content).toBe('Tool execution succeeded')
    expect(normalized.toolOutput).toBe('User answered: option-a')
  })

  it('keeps non-AskUserQuestion tool_result error unchanged', () => {
    const rawThought = createToolResultThought({
      id: 'tool-read-1',
      toolOutput: 'ENOENT'
    })
    const normalized = normalizeAskUserQuestionToolResultThought(rawThought, false)

    expect(normalized).toEqual(rawThought)
  })

  it('keeps successful AskUserQuestion tool_result unchanged', () => {
    const rawThought = createToolResultThought({
      isError: false,
      status: 'success',
      content: 'Tool execution succeeded'
    })
    const normalized = normalizeAskUserQuestionToolResultThought(rawThought, true)

    expect(normalized).toEqual(rawThought)
  })
})

