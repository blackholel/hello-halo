import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  listSpaceSkillsMock,
  listSpaceAgentsMock,
  getSpaceMock
} = vi.hoisted(() => ({
  listSpaceSkillsMock: vi.fn(),
  listSpaceAgentsMock: vi.fn(),
  getSpaceMock: vi.fn()
}))

vi.mock('../skills.service', () => ({
  listSpaceSkills: listSpaceSkillsMock
}))

vi.mock('../agents.service', () => ({
  listSpaceAgents: listSpaceAgentsMock
}))

vi.mock('../space.service', () => ({
  getSpace: getSpaceMock
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

  it('rejects creating workflow when step references non-space skill', () => {
    const spacePath = createSpacePath()
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSpaceSkillsMock.mockReturnValue([{ name: 'space-skill', namespace: undefined }])
    listSpaceAgentsMock.mockReturnValue([{ name: 'space-agent', namespace: undefined }])

    expect(() => createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'invalid-flow',
      steps: [
        { id: 'step-1', type: 'skill', name: 'app-skill' }
      ]
    })).toThrow('Workflow contains non-space resources')
  })

  it('allows creating workflow when all skill/agent steps are space resources', () => {
    const spacePath = createSpacePath()
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSpaceSkillsMock.mockReturnValue([{ name: 'space-skill', namespace: undefined }])
    listSpaceAgentsMock.mockReturnValue([{ name: 'space-agent', namespace: undefined }])

    const workflow = createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'valid-flow',
      steps: [
        { id: 'step-1', type: 'skill', name: 'space-skill' },
        { id: 'step-2', type: 'agent', name: 'space-agent' },
        { id: 'step-3', type: 'message', input: 'hello' }
      ]
    })

    expect(workflow.name).toBe('valid-flow')
    expect(workflow.steps).toHaveLength(3)
  })

  it('returns null on update when new steps include non-space agent', () => {
    const spacePath = createSpacePath()
    getSpaceMock.mockReturnValue({ id: 'space-1', path: spacePath })
    listSpaceSkillsMock.mockReturnValue([{ name: 'space-skill', namespace: undefined }])
    listSpaceAgentsMock.mockReturnValue([{ name: 'space-agent', namespace: undefined }])

    const workflow = createWorkflow('space-1', {
      spaceId: 'space-1',
      name: 'update-target',
      steps: [{ id: 'step-1', type: 'skill', name: 'space-skill' }]
    })

    const result = updateWorkflow('space-1', workflow.id, {
      steps: [{ id: 'step-2', type: 'agent', name: 'app-agent' }]
    })

    expect(result).toBeNull()
  })
})
