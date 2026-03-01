import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  listSkillsMock,
  listAgentsMock,
  listCommandsMock,
  getSpaceMock,
  getConfigMock
} = vi.hoisted(() => ({
  listSkillsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listCommandsMock: vi.fn(),
  getSpaceMock: vi.fn(),
  getConfigMock: vi.fn()
}))

vi.mock('../skills.service', () => ({
  listSkills: listSkillsMock
}))

vi.mock('../agents.service', () => ({
  listAgents: listAgentsMock
}))

vi.mock('../commands.service', () => ({
  listCommands: listCommandsMock
}))

vi.mock('../space.service', () => ({
  getSpace: getSpaceMock
}))

vi.mock('../config.service', () => ({
  getConfig: getConfigMock
}))

import { createWorkflow, updateWorkflow } from '../workflow.service'

describe('workflow.service space-only validation', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    tempDirs.length = 0
    vi.clearAllMocks()
  })

  function createSpacePath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kite-workflow-space-'))
    tempDirs.push(dir)
    return dir
  }

  it('rejects creating workflow when step references unavailable skill', () => {
    const spacePath = createSpacePath()
    getConfigMock.mockReturnValue({ workflow: { allowLegacyInternalDirect: true } })
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSkillsMock.mockReturnValue([{ name: 'space-skill', namespace: undefined, exposure: 'public' }])
    listAgentsMock.mockReturnValue([{ name: 'space-agent', namespace: undefined, exposure: 'public' }])
    listCommandsMock.mockReturnValue([{ name: 'space-command', namespace: undefined, exposure: 'public' }])

    expect(() => createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'invalid-flow',
      steps: [
        { id: 'step-1', type: 'skill', name: 'missing-skill' }
      ]
    })).toThrow('Workflow contains unavailable resources')
  })

  it('allows creating workflow when steps reference space and global resources', () => {
    const spacePath = createSpacePath()
    getConfigMock.mockReturnValue({ workflow: { allowLegacyInternalDirect: true } })
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSkillsMock.mockReturnValue([
      { name: 'space-skill', namespace: undefined, exposure: 'public' },
      { name: 'app-skill', namespace: undefined, exposure: 'public' }
    ])
    listAgentsMock.mockReturnValue([
      { name: 'space-agent', namespace: undefined, exposure: 'public' },
      { name: 'app-agent', namespace: undefined, exposure: 'public' }
    ])
    listCommandsMock.mockReturnValue([{ name: 'space-command', namespace: undefined, exposure: 'public' }])

    const workflow = createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'valid-flow',
      steps: [
        { id: 'step-1', type: 'skill', name: 'app-skill' },
        { id: 'step-2', type: 'agent', name: 'space-agent' },
        { id: 'step-3', type: 'agent', name: 'app-agent' }
      ]
    })

    expect(workflow.name).toBe('valid-flow')
    expect(workflow.steps).toHaveLength(3)
  })

  it('returns null on update when new steps include unavailable agent', () => {
    const spacePath = createSpacePath()
    getConfigMock.mockReturnValue({ workflow: { allowLegacyInternalDirect: true } })
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSkillsMock.mockReturnValue([{ name: 'space-skill', namespace: undefined, exposure: 'public' }])
    listAgentsMock.mockReturnValue([{ name: 'space-agent', namespace: undefined, exposure: 'public' }])
    listCommandsMock.mockReturnValue([{ name: 'space-command', namespace: undefined, exposure: 'public' }])

    const workflow = createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'update-target',
      steps: [{ id: 'step-1', type: 'skill', name: 'space-skill' }]
    })

    const result = updateWorkflow('space-1', workflow.id, {
      steps: [{ id: 'step-2', type: 'agent', name: 'missing-agent' }]
    })

    expect(result).toBeNull()
  })

  it('rejects internal-only direct step when legacy access is disabled', () => {
    const spacePath = createSpacePath()
    getConfigMock.mockReturnValue({ workflow: { allowLegacyInternalDirect: false } })
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSkillsMock.mockReturnValue([{ name: 'app-skill', namespace: undefined, exposure: 'internal-only' }])
    listAgentsMock.mockReturnValue([])
    listCommandsMock.mockReturnValue([])

    expect(() => createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'invalid-internal-flow',
      steps: [
        { id: 'step-1', type: 'skill', name: 'app-skill' }
      ]
    })).toThrow('Workflow contains unavailable resources')
  })
})
