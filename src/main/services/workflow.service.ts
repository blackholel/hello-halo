/**
 * Workflow Service - Manages space-level workflows
 */

import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getSpace } from './space.service'
import { listSpaceSkills } from './skills.service'
import { listSpaceAgents } from './agents.service'

export interface WorkflowStep {
  id: string
  type: 'skill' | 'agent' | 'message'
  name?: string
  input?: string
  args?: string
  summarizeAfter?: boolean
}

export interface Workflow {
  id: string
  spaceId: string
  name: string
  description?: string
  steps: WorkflowStep[]
  settings?: {
    thinkingEnabled?: boolean
    aiBrowserEnabled?: boolean
  }
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastConversationId?: string
}

export interface WorkflowMeta {
  id: string
  spaceId: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastConversationId?: string
}

interface WorkflowIndex {
  version: number
  updatedAt: string
  workflows: WorkflowMeta[]
}

const INDEX_VERSION = 1

function ensureWorkflowsDir(spaceId: string): string | null {
  const space = getSpace(spaceId)
  if (!space) return null

  const workflowsDir = join(space.path, '.halo', 'workflows')
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true })
  }
  return workflowsDir
}

function getIndexPath(workflowsDir: string): string {
  return join(workflowsDir, 'index.json')
}

function readIndex(workflowsDir: string): WorkflowIndex | null {
  const indexPath = getIndexPath(workflowsDir)
  if (!existsSync(indexPath)) return null
  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf-8')) as WorkflowIndex
    if (raw.version !== INDEX_VERSION || !Array.isArray(raw.workflows)) return null
    return raw
  } catch {
    return null
  }
}

function writeIndex(workflowsDir: string, index: WorkflowIndex): void {
  writeFileSync(getIndexPath(workflowsDir), JSON.stringify(index, null, 2))
}

function workflowToMeta(workflow: Workflow): WorkflowMeta {
  return {
    id: workflow.id,
    spaceId: workflow.spaceId,
    name: workflow.name,
    description: workflow.description,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    lastRunAt: workflow.lastRunAt,
    lastConversationId: workflow.lastConversationId
  }
}

function buildIndexFromFiles(workflowsDir: string, spaceId: string): WorkflowIndex {
  const files = readdirSync(workflowsDir).filter(f => f.endsWith('.json') && f !== 'index.json')
  const workflows: WorkflowMeta[] = []

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(workflowsDir, file), 'utf-8')) as Workflow
      if (content && content.spaceId === spaceId) {
        workflows.push(workflowToMeta(content))
      }
    } catch {
      // ignore invalid files
    }
  }

  return {
    version: INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    workflows
  }
}

export function listWorkflows(spaceId: string): WorkflowMeta[] {
  const workflowsDir = ensureWorkflowsDir(spaceId)
  if (!workflowsDir) return []

  let index = readIndex(workflowsDir)
  if (!index) {
    index = buildIndexFromFiles(workflowsDir, spaceId)
    writeIndex(workflowsDir, index)
  }

  return index.workflows
}

export function getWorkflow(spaceId: string, workflowId: string): Workflow | null {
  const workflowsDir = ensureWorkflowsDir(spaceId)
  if (!workflowsDir) return null

  const filePath = join(workflowsDir, `${workflowId}.json`)
  if (!existsSync(filePath)) return null

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Workflow
  } catch {
    return null
  }
}

function normalizeSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map(step => ({
    id: step.id || uuidv4(),
    type: step.type,
    name: step.name,
    input: step.input,
    args: step.args,
    summarizeAfter: step.summarizeAfter
  }))
}

function parseDirectiveName(raw: string): { name: string; namespace?: string } | null {
  const value = raw.trim()
  if (!value) return null
  if (!value.includes(':')) return { name: value }

  const [namespace, name] = value.split(':', 2)
  if (!namespace || !name) return null
  return { namespace, name }
}

function validateWorkflowSteps(spaceId: string, steps: WorkflowStep[]): void {
  const space = getSpace(spaceId)
  if (!space) {
    throw new Error('Space not found')
  }

  const availableSkills = listSpaceSkills(space.path)
  const availableAgents = listSpaceAgents(space.path)

  const missing: string[] = []
  for (const [index, step] of steps.entries()) {
    const parsed = parseDirectiveName(step.name || '')
    if (!parsed || step.type === 'message') continue

    if (step.type === 'skill') {
      const ok = availableSkills.some(skill => (
        skill.name === parsed.name &&
        (skill.namespace || undefined) === (parsed.namespace || undefined)
      ))
      if (!ok) missing.push(`Step ${index + 1}: skill ${step.name}`)
    }

    if (step.type === 'agent') {
      const ok = availableAgents.some(agent => (
        agent.name === parsed.name &&
        (agent.namespace || undefined) === (parsed.namespace || undefined)
      ))
      if (!ok) missing.push(`Step ${index + 1}: agent ${step.name}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Workflow contains non-space resources: ${missing.join(', ')}`)
  }
}

export function createWorkflow(spaceId: string, input: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Workflow {
  const workflowsDir = ensureWorkflowsDir(spaceId)
  if (!workflowsDir) {
    throw new Error('Space not found')
  }

  if (!input.name || !input.steps || !Array.isArray(input.steps)) {
    throw new Error('Invalid workflow input')
  }
  validateWorkflowSteps(spaceId, input.steps)

  const now = new Date().toISOString()
  const workflow: Workflow = {
    ...input,
    id: uuidv4(),
    spaceId,
    steps: normalizeSteps(input.steps),
    createdAt: now,
    updatedAt: now
  }

  const filePath = join(workflowsDir, `${workflow.id}.json`)
  writeFileSync(filePath, JSON.stringify(workflow, null, 2))

  const index = readIndex(workflowsDir) || buildIndexFromFiles(workflowsDir, spaceId)
  index.workflows.push(workflowToMeta(workflow))
  index.updatedAt = now
  writeIndex(workflowsDir, index)

  return workflow
}

export function updateWorkflow(spaceId: string, workflowId: string, updates: Partial<Workflow>): Workflow | null {
  const workflowsDir = ensureWorkflowsDir(spaceId)
  if (!workflowsDir) return null

  const filePath = join(workflowsDir, `${workflowId}.json`)
  if (!existsSync(filePath)) return null

  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Workflow
    if (updates.steps) {
      validateWorkflowSteps(spaceId, updates.steps)
    }
    const updated: Workflow = {
      ...existing,
      ...updates,
      id: existing.id,
      spaceId: existing.spaceId,
      steps: updates.steps ? normalizeSteps(updates.steps) : existing.steps,
      updatedAt: new Date().toISOString()
    }

    writeFileSync(filePath, JSON.stringify(updated, null, 2))

    const index = readIndex(workflowsDir) || buildIndexFromFiles(workflowsDir, spaceId)
    index.workflows = index.workflows.map(w => w.id === workflowId ? workflowToMeta(updated) : w)
    index.updatedAt = updated.updatedAt
    writeIndex(workflowsDir, index)

    return updated
  } catch {
    return null
  }
}

export function deleteWorkflow(spaceId: string, workflowId: string): boolean {
  const workflowsDir = ensureWorkflowsDir(spaceId)
  if (!workflowsDir) return false

  const filePath = join(workflowsDir, `${workflowId}.json`)
  if (!existsSync(filePath)) return false

  try {
    rmSync(filePath)
    const index = readIndex(workflowsDir) || buildIndexFromFiles(workflowsDir, spaceId)
    index.workflows = index.workflows.filter(w => w.id !== workflowId)
    index.updatedAt = new Date().toISOString()
    writeIndex(workflowsDir, index)
    return true
  } catch {
    return false
  }
}
