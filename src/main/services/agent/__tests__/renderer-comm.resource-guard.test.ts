import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({
    permissions: {
      commandExecution: 'allow',
      trustMode: true
    }
  }))
}))

vi.mock('../../ai-browser', () => ({
  isAIBrowserTool: vi.fn(() => false)
}))

vi.mock('../../../http/websocket', () => ({
  broadcastToWebSocket: vi.fn()
}))

let policyMode: 'strict-space-only' | 'legacy' = 'strict-space-only'

vi.mock('../space-resource-policy.service', () => ({
  getSpaceResourcePolicy: vi.fn(() => ({
    version: 1,
    mode: policyMode
  })),
  isStrictSpaceOnlyPolicy: vi.fn((policy: { mode: string }) => policy.mode === 'strict-space-only')
}))

import { createCanUseTool } from '../renderer-comm'

function createHandler() {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined
  )
}

function createAskModeHandler() {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined,
    { mode: 'ask' }
  )
}

function createDynamicModeHandler(getMode: () => 'code' | 'ask') {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => ({ mode: getMode() } as any),
    { mode: 'code' }
  )
}

describe('renderer-comm resource-dir guard', () => {
  beforeEach(() => {
    policyMode = 'strict-space-only'
  })

  it('denies Write on protected skill directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '.claude/skills/demo/SKILL.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('.claude skills/agents/commands')
  })

  it('denies Edit on protected agent directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Edit',
      { file_path: '/workspace/project/.claude/agents/reviewer.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('.claude skills/agents/commands')
  })

  it('denies Bash touching protected command directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'echo "# cmd" > .claude/commands/release.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Bash cannot modify')
  })

  it('allows Bash when command does not touch protected directories', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'echo "hello world"' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Write on protected directory when policy is legacy', async () => {
    policyMode = 'legacy'
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '.claude/skills/demo/SKILL.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('ask mode denies all tools', async () => {
    const canUseTool = createAskModeHandler()
    const result = await canUseTool(
      'Read',
      { file_path: 'README.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('ASK mode')
  })

  it('switching to ask mode at runtime denies tools immediately', async () => {
    let mode: 'code' | 'ask' = 'code'
    const canUseTool = createDynamicModeHandler(() => mode)

    const beforeSwitch = await canUseTool(
      'Read',
      { file_path: 'README.md' },
      { signal: new AbortController().signal }
    )
    expect(beforeSwitch.behavior).toBe('allow')

    mode = 'ask'
    const afterSwitch = await canUseTool(
      'Read',
      { file_path: 'README.md' },
      { signal: new AbortController().signal }
    )
    expect(afterSwitch.behavior).toBe('deny')
    expect(afterSwitch.message).toContain('ASK mode')
  })
})
