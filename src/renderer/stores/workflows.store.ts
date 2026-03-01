/**
 * Workflows Store - Workflow state management and runner
 */

import { create } from 'zustand'
import { api } from '../api'
import { getCurrentLanguage } from '../i18n'
import type { Workflow, WorkflowMeta, WorkflowStep } from '../types'
import { useChatStore } from './chat.store'
import { useSpaceStore } from './space.store'

export interface WorkflowRunStepState {
  id: string
  status: 'pending' | 'running' | 'completed' | 'error'
  output?: string
  startedAt?: string
  endedAt?: string
}

export interface WorkflowRunState {
  workflow: Workflow
  spaceId: string
  conversationId: string
  currentStepIndex: number
  steps: WorkflowRunStepState[]
  isRunning: boolean
  startedAt: string
  endedAt?: string
  phase: 'step' | 'summary' | 'summary-inject'
  summaryText?: string
}

interface WorkflowsState {
  workflows: WorkflowMeta[]
  loadedSpaceId: string | null
  activeWorkflow: Workflow | null
  activeRun: WorkflowRunState | null
  isLoading: boolean
  error: string | null

  loadWorkflows: (spaceId: string) => Promise<void>
  loadWorkflow: (spaceId: string, workflowId: string) => Promise<Workflow | null>
  createWorkflow: (spaceId: string, input: Record<string, unknown>) => Promise<Workflow | null>
  updateWorkflow: (spaceId: string, workflowId: string, updates: Record<string, unknown>) => Promise<Workflow | null>
  deleteWorkflow: (spaceId: string, workflowId: string) => Promise<boolean>

  runWorkflow: (spaceId: string, workflowId: string) => Promise<void>
  stopRun: () => Promise<void>
  handleAgentComplete: (event: { spaceId: string; conversationId: string }) => Promise<void>
}

function buildMessageForStep(step: WorkflowStep): string {
  if (step.type === 'command') {
    const input = step.input ? ` ${step.input}` : ''
    return `/${step.name}${input}`.trim()
  }
  if (step.type === 'skill') {
    const args = step.args ? ` ${step.args}` : ''
    const input = step.input ? ` ${step.input}` : ''
    return `/${step.name}${args}${input}`.trim()
  }
  if (step.type === 'agent') {
    const input = step.input ? ` ${step.input}` : ''
    return `@${step.name}${input}`.trim()
  }
  return step.input || ''
}

const SUMMARY_PROMPT = [
  'Summarize the conversation so far for a clean handoff to the next step.',
  'Return concise bullet points covering goals, decisions, constraints, key outputs, and open questions.',
  'Use the same language as the conversation. Do not add extra commentary.'
].join(' ')

function buildSummaryInjectionMessage(summary: string): string {
  return `Context summary from previous steps:\n\n${summary.trim()}\n\nAcknowledge briefly and wait.`
}

function getLastAssistantContent(conversationId: string): string | undefined {
  const conversation = useChatStore.getState().getCachedConversation(conversationId)
  const lastAssistant = conversation?.messages?.slice().reverse().find(m => m.role === 'assistant')
  return lastAssistant?.content?.trim()
}

function shouldSummarizeAfterStep(step: WorkflowStep, stepIndex: number, totalSteps: number): boolean {
  return !!step.summarizeAfter && stepIndex < totalSteps - 1
}

function hasAvailableResource(
  name: string,
  refs: Array<{ name: string; namespace?: string }>
): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false

  if (!trimmed.includes(':')) {
    return refs.some((ref) => ref.name === trimmed && !ref.namespace)
      || refs.some((ref) => ref.name === trimmed)
  }

  const [namespace, resourceName] = trimmed.split(':', 2)
  if (!namespace || !resourceName) return false
  return refs.some((ref) => ref.name === resourceName && ref.namespace === namespace)
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflows: [],
  loadedSpaceId: null,
  activeWorkflow: null,
  activeRun: null,
  isLoading: false,
  error: null,

  loadWorkflows: async (spaceId) => {
    try {
      set({ isLoading: true, error: null })
      const response = await api.listWorkflows(spaceId)
      if (response.success && response.data) {
        set({ workflows: response.data as WorkflowMeta[], loadedSpaceId: spaceId })
      } else {
        set({ error: response.error || 'Failed to load workflows' })
      }
    } catch (error) {
      console.error('[WorkflowsStore] Failed to load workflows:', error)
      set({ error: 'Failed to load workflows' })
    } finally {
      set({ isLoading: false })
    }
  },

  loadWorkflow: async (spaceId, workflowId) => {
    try {
      const response = await api.getWorkflow(spaceId, workflowId)
      if (response.success && response.data) {
        const workflow = response.data as Workflow
        set({ activeWorkflow: workflow })
        return workflow
      }
      set({ error: response.error || 'Failed to load workflow' })
      return null
    } catch (error) {
      console.error('[WorkflowsStore] Failed to load workflow:', error)
      set({ error: 'Failed to load workflow' })
      return null
    }
  },

  createWorkflow: async (spaceId, input) => {
    try {
      const response = await api.createWorkflow(spaceId, input)
      if (response.success && response.data) {
        const workflow = response.data as Workflow
        set((state) => ({ workflows: [workflow, ...state.workflows] }))
        return workflow
      }
      set({ error: response.error || 'Failed to create workflow' })
      return null
    } catch (error) {
      console.error('[WorkflowsStore] Failed to create workflow:', error)
      set({ error: 'Failed to create workflow' })
      return null
    }
  },

  updateWorkflow: async (spaceId, workflowId, updates) => {
    try {
      const response = await api.updateWorkflow(spaceId, workflowId, updates)
      if (response.success && response.data) {
        const workflow = response.data as Workflow
        set((state) => ({
          workflows: state.workflows.map(w => w.id === workflowId ? workflow : w),
          activeWorkflow: state.activeWorkflow?.id === workflowId ? workflow : state.activeWorkflow
        }))
        return workflow
      }
      set({ error: response.error || 'Failed to update workflow' })
      return null
    } catch (error) {
      console.error('[WorkflowsStore] Failed to update workflow:', error)
      set({ error: 'Failed to update workflow' })
      return null
    }
  },

  deleteWorkflow: async (spaceId, workflowId) => {
    try {
      const response = await api.deleteWorkflow(spaceId, workflowId)
      if (response.success) {
        set((state) => ({
          workflows: state.workflows.filter(w => w.id !== workflowId),
          activeWorkflow: state.activeWorkflow?.id === workflowId ? null : state.activeWorkflow
        }))
        return true
      }
      set({ error: response.error || 'Failed to delete workflow' })
      return false
    } catch (error) {
      console.error('[WorkflowsStore] Failed to delete workflow:', error)
      set({ error: 'Failed to delete workflow' })
      return false
    }
  },

  runWorkflow: async (spaceId, workflowId) => {
    const { activeRun } = get()
    if (activeRun?.isRunning) return

    const workflow = await get().loadWorkflow(spaceId, workflowId)
    if (!workflow) return

    const currentSpace = useSpaceStore.getState().currentSpace
    const knownSpace = currentSpace?.id === spaceId
      ? currentSpace
      : useSpaceStore.getState().spaces.find(space => space.id === spaceId)
    if (knownSpace?.path) {
      const locale = getCurrentLanguage()
      const [skillsResponse, agentsResponse, commandsResponse] = await Promise.all([
        api.listSkills(knownSpace.path, locale, 'workflow-validation'),
        api.listAgents(knownSpace.path, locale, 'workflow-validation'),
        api.listCommands(knownSpace.path, locale, 'workflow-validation')
      ])

      const availableSkills = (skillsResponse.success ? (skillsResponse.data as Array<{ name: string; namespace?: string }>) : [])
      const availableAgents = (agentsResponse.success ? (agentsResponse.data as Array<{ name: string; namespace?: string }>) : [])
      const availableCommands = (commandsResponse.success ? (commandsResponse.data as Array<{ name: string; namespace?: string }>) : [])

      const missingSteps: string[] = []
      workflow.steps.forEach((step, index) => {
        const stepName = step.name?.trim()
        if (!stepName) return
        if (step.type === 'skill' && !hasAvailableResource(stepName, availableSkills)) {
          missingSteps.push(`Step ${index + 1}: skill ${stepName}`)
        }
        if (step.type === 'agent' && !hasAvailableResource(stepName, availableAgents)) {
          missingSteps.push(`Step ${index + 1}: agent ${stepName}`)
        }
        if (step.type === 'command' && !hasAvailableResource(stepName, availableCommands)) {
          missingSteps.push(`Step ${index + 1}: command ${stepName}`)
        }
      })

      if (missingSteps.length > 0) {
        const message = `Workflow contains unavailable resources: ${missingSteps.join(', ')}`
        console.warn('[WorkflowsStore]', message)
        set({ error: message })
        return
      }
    }

    const conversation = await useChatStore.getState().createConversation(spaceId, workflow.name)
    if (!conversation) {
      set({ error: 'Failed to create workflow conversation' })
      return
    }

    const now = new Date().toISOString()
    const steps: WorkflowRunStepState[] = workflow.steps.map(step => ({
      id: step.id,
      status: 'pending'
    }))

    set({
      activeRun: {
        workflow,
        spaceId,
        conversationId: conversation.id,
        currentStepIndex: 0,
        steps,
        isRunning: true,
        startedAt: now,
        phase: 'step'
      }
    })

    // Update workflow metadata
    await get().updateWorkflow(spaceId, workflowId, {
      lastRunAt: now,
      lastConversationId: conversation.id
    })

    await startStep(get, set)
  },

  stopRun: async () => {
    const run = get().activeRun
    if (!run) return
    await api.stopGeneration(run.conversationId)
    set({
      activeRun: {
        ...run,
        isRunning: false,
        endedAt: new Date().toISOString()
      }
    })
  },

  handleAgentComplete: async (event) => {
    const run = get().activeRun
    if (!run || !run.isRunning) return
    if (event.conversationId !== run.conversationId || event.spaceId !== run.spaceId) return

    const stepIndex = run.currentStepIndex
    const updatedSteps = [...run.steps]
    const step = updatedSteps[stepIndex]
    if (run.phase === 'summary') {
      const summaryText = getLastAssistantContent(run.conversationId)
      if (!summaryText) {
        updatedSteps[stepIndex] = {
          ...updatedSteps[stepIndex],
          status: 'error',
          endedAt: new Date().toISOString()
        }
        set({
          activeRun: {
            ...run,
            steps: updatedSteps,
            isRunning: false,
            endedAt: new Date().toISOString()
          }
        })
        return
      }

      const nextConversation = await useChatStore.getState().createConversation(
        run.spaceId,
        `${run.workflow.name} (Step ${stepIndex + 2})`
      )
      if (!nextConversation) {
        set({
          activeRun: {
            ...run,
            steps: updatedSteps,
            isRunning: false,
            endedAt: new Date().toISOString()
          }
        })
        return
      }

      set({
        activeRun: {
          ...run,
          conversationId: nextConversation.id,
          phase: 'summary-inject',
          summaryText
        }
      })

      await useChatStore.getState().sendMessageToConversation(
        run.spaceId,
        nextConversation.id,
        buildSummaryInjectionMessage(summaryText),
        undefined,
        false,
        undefined,
        false,
        false,
        'workflow-step'
      )
      return
    }

    if (run.phase === 'summary-inject') {
      const nextIndex = stepIndex + 1
      if (nextIndex >= run.workflow.steps.length) {
        set({
          activeRun: {
            ...run,
            steps: updatedSteps,
            isRunning: false,
            currentStepIndex: nextIndex,
            endedAt: new Date().toISOString(),
            phase: 'step',
            summaryText: undefined
          }
        })
        return
      }

      set({
        activeRun: {
          ...run,
          steps: updatedSteps,
          currentStepIndex: nextIndex,
          phase: 'step',
          summaryText: undefined
        }
      })

      void startStep(get, set)
      return
    }

    if (step) {
      updatedSteps[stepIndex] = {
        ...step,
        status: 'completed',
        output: getLastAssistantContent(run.conversationId),
        endedAt: new Date().toISOString()
      }
    }

    if (step && shouldSummarizeAfterStep(step, stepIndex, run.workflow.steps.length)) {
      set({
        activeRun: {
          ...run,
          steps: updatedSteps,
          phase: 'summary'
        }
      })

      await useChatStore.getState().sendMessageToConversation(
        run.spaceId,
        run.conversationId,
        SUMMARY_PROMPT,
        undefined,
        false,
        undefined,
        false,
        false,
        'workflow-step'
      )
      return
    }

    const nextIndex = stepIndex + 1
    if (nextIndex >= run.workflow.steps.length) {
      set({
        activeRun: {
          ...run,
          steps: updatedSteps,
          isRunning: false,
          currentStepIndex: nextIndex,
          endedAt: new Date().toISOString(),
          phase: 'step',
          summaryText: undefined
        }
      })
      return
    }

    set({
      activeRun: {
        ...run,
        steps: updatedSteps,
        currentStepIndex: nextIndex,
        phase: 'step',
        summaryText: undefined
      }
    })

    void startStep(get, set)
  }
}))

async function startStep(get: () => WorkflowsState, set: (partial: Partial<WorkflowsState>) => void): Promise<void> {
  const run = get().activeRun
  if (!run || !run.isRunning || run.phase !== 'step') return

  const step = run.workflow.steps[run.currentStepIndex]
  if (!step) return

  const updatedSteps = [...run.steps]
  updatedSteps[run.currentStepIndex] = {
    ...updatedSteps[run.currentStepIndex],
    status: 'running',
    startedAt: new Date().toISOString()
  }

  set({
    activeRun: {
      ...run,
      steps: updatedSteps
    }
  })

  const message = buildMessageForStep(step)
  if (!message) {
    updatedSteps[run.currentStepIndex] = {
      ...updatedSteps[run.currentStepIndex],
      status: 'error',
      endedAt: new Date().toISOString()
    }
    set({
      activeRun: {
        ...run,
        steps: updatedSteps,
        isRunning: false
      }
    })
    return
  }

  await useChatStore.getState().sendMessageToConversation(
    run.spaceId,
    run.conversationId,
    message,
    undefined,
    run.workflow.settings?.thinkingEnabled,
    undefined,
    run.workflow.settings?.aiBrowserEnabled,
    undefined,
    'workflow-step'
  )
}
