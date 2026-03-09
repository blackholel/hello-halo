import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../space-resource-policy.service', () => ({
  getSpaceResourcePolicy: vi.fn(() => ({
    version: 1,
    mode: 'strict-space-only'
  })),
  isStrictSpaceOnlyPolicy: vi.fn(() => true)
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

function createHandlerWithToolObserver(onToolUse: (toolName: string, input: Record<string, unknown>) => void) {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined,
    { onToolUse }
  )
}

describe('renderer-comm resource-dir guard', () => {
  it('allows Write on protected skill directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '.claude/skills/demo/SKILL.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Edit on protected agent directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Edit',
      { file_path: '/workspace/project/.claude/agents/reviewer.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Bash touching protected command directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'echo "# cmd" > .claude/commands/release.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
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

  it('denies Bash absolute path outside current workDir in strict space mode', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'open /Users/dl/ProjectSpace/ownerAgent/hello-halo/README.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Strict space mode')
  })

  it('denies Bash directory traversal in strict space mode', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'cd ../ && ls' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Strict space mode')
  })

  it('denies Write outside current workDir', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '../other-workspace/README.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('current space')
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

  it('invokes onToolUse callback for allowed mutation tools', async () => {
    const onToolUse = vi.fn()
    const canUseTool = createHandlerWithToolObserver(onToolUse)

    const result = await canUseTool(
      'Write',
      { file_path: 'src/main.ts', content: 'hello' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(onToolUse).toHaveBeenCalledWith('Write', {
      file_path: 'src/main.ts',
      content: 'hello'
    })
  })
})
