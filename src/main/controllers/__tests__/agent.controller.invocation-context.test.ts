import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendMessageMock = vi.hoisted(() => vi.fn())

vi.mock('../../services/agent', () => ({
  sendMessage: sendMessageMock,
  stopGeneration: vi.fn(),
  handleToolApproval: vi.fn(),
  handleAskUserQuestionResponse: vi.fn(),
  isGenerating: vi.fn(() => false),
  getActiveSessions: vi.fn(() => []),
  getSessionState: vi.fn(() => null),
  testMcpConnections: vi.fn(async () => ({ success: true, servers: [] }))
}))

import { sendMessage, sendWorkflowStepMessage } from '../agent.controller'

describe('agent.controller invocation context hardening', () => {
  beforeEach(() => {
    sendMessageMock.mockReset()
    sendMessageMock.mockResolvedValue(undefined)
  })

  it('forces interactive context for external sendMessage calls', async () => {
    const result = await sendMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '/skill',
      invocationContext: 'command-dependency'
    } as any)

    expect(result.success).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock.mock.calls[0]?.[1]?.invocationContext).toBe('interactive')
  })

  it('uses workflow-step context for workflow step messages', async () => {
    const result = await sendWorkflowStepMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: '/skill',
      invocationContext: 'interactive'
    } as any)

    expect(result.success).toBe(true)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock.mock.calls[0]?.[1]?.invocationContext).toBe('workflow-step')
  })
})

