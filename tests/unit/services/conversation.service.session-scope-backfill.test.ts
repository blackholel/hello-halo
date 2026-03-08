import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const getSpaceMock = vi.hoisted(() => vi.fn())
const getTempSpacePathMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/main/services/space.service', () => ({
  getSpace: (...args: unknown[]) => getSpaceMock(...args)
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    ai: { defaultProfileId: 'profile-default' }
  })),
  getTempSpacePath: (...args: unknown[]) => getTempSpacePathMock(...args)
}))

import { getConversation } from '../../../src/main/services/conversation.service'

function createConversationFixture(params: {
  filePath: string
  id: string
  spaceId: string
}): void {
  const payload = {
    id: params.id,
    spaceId: params.spaceId,
    title: 'Session Scope Backfill',
    mode: 'code',
    createdAt: '2026-03-08T10:00:00.000Z',
    updatedAt: '2026-03-08T10:00:00.000Z',
    messageCount: 1,
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        timestamp: '2026-03-08T10:00:00.000Z'
      }
    ],
    sessionId: 'session-legacy'
  }
  writeFileSync(params.filePath, JSON.stringify(payload, null, 2))
}

describe('conversation.service sessionScope backfill', () => {
  let tempRoot = ''

  beforeEach(() => {
    vi.clearAllMocks()
    tempRoot = mkdtempSync(join(tmpdir(), 'kite-conv-backfill-'))
  })

  afterEach(() => {
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('普通空间: sessionId 存在且 sessionScope 缺失时自动回填为 space.path 并持久化', () => {
    const spacePath = join(tempRoot, 'space-a')
    const conversationsDir = join(spacePath, '.kite', 'conversations')
    mkdirSync(conversationsDir, { recursive: true })
    const filePath = join(conversationsDir, 'conv-1.json')
    createConversationFixture({ filePath, id: 'conv-1', spaceId: 'space-1' })

    getSpaceMock.mockImplementation((spaceId: string) => {
      if (spaceId === 'space-1') {
        return {
          id: 'space-1',
          name: 'Space 1',
          path: spacePath,
          isTemp: false
        }
      }
      return null
    })
    getTempSpacePathMock.mockReturnValue(join(tempRoot, 'temp-unused'))

    const conversation = getConversation('space-1', 'conv-1')
    expect(conversation?.sessionScope?.spaceId).toBe('space-1')
    expect(conversation?.sessionScope?.workDir).toBe(spacePath)

    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      sessionScope?: { spaceId?: string; workDir?: string }
    }
    expect(persisted.sessionScope?.spaceId).toBe('space-1')
    expect(persisted.sessionScope?.workDir).toBe(spacePath)
  })

  it('kite-temp: 回填 workDir 指向 getTempSpacePath()/artifacts', () => {
    const tempSpacePath = join(tempRoot, 'kite-temp-space')
    const conversationsDir = join(tempSpacePath, 'conversations')
    mkdirSync(conversationsDir, { recursive: true })
    const filePath = join(conversationsDir, 'conv-temp.json')
    createConversationFixture({ filePath, id: 'conv-temp', spaceId: 'kite-temp' })

    getSpaceMock.mockImplementation((spaceId: string) => {
      if (spaceId === 'kite-temp') {
        return {
          id: 'kite-temp',
          name: 'Temp',
          path: tempSpacePath,
          isTemp: true
        }
      }
      return null
    })
    getTempSpacePathMock.mockReturnValue(tempSpacePath)

    const conversation = getConversation('kite-temp', 'conv-temp')
    expect(conversation?.sessionScope?.spaceId).toBe('kite-temp')
    expect(conversation?.sessionScope?.workDir).toBe(join(tempSpacePath, 'artifacts'))

    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      sessionScope?: { spaceId?: string; workDir?: string }
    }
    expect(persisted.sessionScope?.spaceId).toBe('kite-temp')
    expect(persisted.sessionScope?.workDir).toBe(join(tempSpacePath, 'artifacts'))
  })
})
