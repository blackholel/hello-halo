/**
 * WorkflowEditorModal - Modal for creating and editing workflows
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Save, ListChecks, Plus, Trash2, GripVertical, Play } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { Workflow, WorkflowStep } from '../../types'
import { useWorkflowsStore } from '../../stores/workflows.store'
import { useSkillsStore } from '../../stores/skills.store'
import { useAgentsStore } from '../../stores/agents.store'
import { useSpaceStore } from '../../stores/space.store'

interface WorkflowEditorModalProps {
  spaceId: string
  workflow?: Workflow
  onClose: () => void
  onSaved?: (workflow: Workflow) => void
}

const DEFAULT_SETTINGS = {
  thinkingEnabled: false,
  aiBrowserEnabled: false
}

const NAME_PATTERN = /^[a-z0-9-]+$/
const MAX_NAME_LENGTH = 50

function createStepId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return `step-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function createEmptyStep(): WorkflowStep {
  return {
    id: createStepId(),
    type: 'skill',
    name: '',
    args: '',
    input: '',
    summarizeAfter: false
  }
}

function normalizeSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    name: step.name ?? '',
    args: step.args ?? '',
    input: step.input ?? '',
    summarizeAfter: step.summarizeAfter ?? false
  }))
}

export function WorkflowEditorModal({ spaceId, workflow, onClose, onSaved }: WorkflowEditorModalProps) {
  const { t } = useTranslation()
  const { currentSpace, spaces, haloSpace } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    spaces: state.spaces,
    haloSpace: state.haloSpace
  }))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<WorkflowStep[]>([createEmptyStep()])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [stepErrors, setStepErrors] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const { createWorkflow, updateWorkflow, runWorkflow } = useWorkflowsStore()
  const {
    skills,
    loadedWorkDir: loadedSkillsDir,
    isLoading: isLoadingSkills,
    loadSkills
  } = useSkillsStore()
  const {
    agents,
    loadedWorkDir: loadedAgentsDir,
    isLoading: isLoadingAgents,
    loadAgents
  } = useAgentsStore()
  const isEditMode = !!workflow
  const activeSpace = useMemo(() => {
    if (currentSpace?.id === spaceId) return currentSpace
    const matched = spaces.find(space => space.id === spaceId)
    if (matched) return matched
    if (haloSpace?.id === spaceId) return haloSpace
    return null
  }, [currentSpace, spaces, haloSpace, spaceId])
  const workDir = activeSpace?.path

  const clearErrors = useCallback(() => {
    setError(null)
    setValidationErrors([])
    setStepErrors({})
  }, [])

  useEffect(() => {
    if (workflow) {
      const normalized = workflow.steps.length
        ? normalizeSteps(workflow.steps)
        : [createEmptyStep()]
      setName(workflow.name)
      setDescription(workflow.description || '')
      setSteps(normalized)
      setSettings(workflow.settings || DEFAULT_SETTINGS)
      setSelectedStepId(normalized[0]?.id || null)
    } else {
      const initialStep = createEmptyStep()
      setName('')
      setDescription('')
      setSteps([initialStep])
      setSettings(DEFAULT_SETTINGS)
      setSelectedStepId(initialStep.id)
    }
    clearErrors()
  }, [workflow, clearErrors])

  useEffect(() => {
    if (!steps.length) return
    if (!selectedStepId || !steps.some(step => step.id === selectedStepId)) {
      setSelectedStepId(steps[0].id)
    }
  }, [steps, selectedStepId])

  useEffect(() => {
    if (workDir) {
      if (skills.length === 0 || loadedSkillsDir !== workDir) {
        loadSkills(workDir)
      }
      if (agents.length === 0 || loadedAgentsDir !== workDir) {
        loadAgents(workDir)
      }
    } else {
      if (skills.length === 0 && loadedSkillsDir !== null) {
        loadSkills()
      }
      if (agents.length === 0 && loadedAgentsDir !== null) {
        loadAgents()
      }
    }
  }, [
    workDir,
    skills.length,
    agents.length,
    loadedSkillsDir,
    loadedAgentsDir,
    loadSkills,
    loadAgents
  ])

  const selectedStep = useMemo(
    () => steps.find(step => step.id === selectedStepId) || null,
    [steps, selectedStepId]
  )

  const selectedIndex = useMemo(
    () => (selectedStep ? steps.findIndex(step => step.id === selectedStep.id) : -1),
    [steps, selectedStep]
  )

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills]
  )
  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  )
  const selectedSkillName = useMemo(() => {
    if (!selectedStep || selectedStep.type !== 'skill') return ''
    return sortedSkills.some(skill => skill.name === selectedStep.name) ? (selectedStep.name || '') : ''
  }, [selectedStep, sortedSkills])
  const selectedAgentName = useMemo(() => {
    if (!selectedStep || selectedStep.type !== 'agent') return ''
    return sortedAgents.some(agent => agent.name === selectedStep.name) ? (selectedStep.name || '') : ''
  }, [selectedStep, sortedAgents])

  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setSteps(prev => prev.map(step => step.id === stepId ? { ...step, ...updates } : step))
    clearErrors()
  }, [clearErrors])

  const handleAddStep = useCallback(() => {
    const nextStep = createEmptyStep()
    setSteps(prev => [...prev, nextStep])
    setSelectedStepId(nextStep.id)
    clearErrors()
  }, [clearErrors])

  const handleRemoveStep = useCallback((stepId: string) => {
    setSteps(prev => {
      const next = prev.filter(step => step.id !== stepId)
      const ensured = next.length ? next : [createEmptyStep()]
      setSelectedStepId(current => {
        if (current && current !== stepId && ensured.some(step => step.id === current)) {
          return current
        }
        return ensured[0].id
      })
      return ensured
    })
    clearErrors()
  }, [clearErrors])

  const handleDragStart = useCallback((event: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    const dragElement = event.currentTarget as HTMLElement
    if (dragElement) {
      event.dataTransfer.setDragImage(dragElement, dragElement.offsetWidth / 2, dragElement.offsetHeight / 2)
    }
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent, index: number) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (draggedIndex !== null && draggedIndex !== index) {
      setDropTargetIndex(index)
    }
  }, [draggedIndex])

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null)
  }, [])

  const handleDrop = useCallback((event: React.DragEvent, toIndex: number) => {
    event.preventDefault()
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      setSteps(prev => {
        const next = [...prev]
        const [moved] = next.splice(draggedIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
    }
    setDraggedIndex(null)
    setDropTargetIndex(null)
  }, [draggedIndex])

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null)
    setDropTargetIndex(null)
  }, [])

  const validateWorkflow = useCallback(() => {
    const errors: string[] = []
    const nextStepErrors: Record<string, string[]> = {}

    if (!name.trim()) {
      errors.push(t('Workflow name is required'))
    }

    if (!steps.length) {
      errors.push(t('At least one step is required'))
    }

    steps.forEach((step, index) => {
      const issues: string[] = []

      if (!step.type) {
        issues.push(t('Step type is required'))
      }

      if (step.type === 'skill' || step.type === 'agent') {
        const trimmedName = step.name?.trim() || ''
        if (!trimmedName) {
          issues.push(t('Step name is required'))
        } else if (!NAME_PATTERN.test(trimmedName)) {
          issues.push(t('Step name must use lowercase letters, numbers, and hyphens'))
        } else if (trimmedName.length > MAX_NAME_LENGTH) {
          issues.push(t('Step name must be {{count}} characters or less', { count: MAX_NAME_LENGTH }))
        }
      }

      if (step.type === 'message') {
        const trimmedInput = step.input?.trim() || ''
        if (!trimmedInput) {
          issues.push(t('Message input is required'))
        }
      }

      if (issues.length > 0) {
        nextStepErrors[step.id] = issues.map(issue => t('Step {{index}}: {{issue}}', { index: index + 1, issue }))
      }
    })

    return { errors, stepErrors: nextStepErrors }
  }, [name, steps, t])

  const buildPayload = useCallback(() => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const normalizedSteps = steps.map((step) => {
      const input = step.input?.trim() || ''
      const stepName = step.name?.trim() || ''
      const args = step.args?.trim() || ''

      if (step.type === 'message') {
        return {
          id: step.id,
          type: step.type,
          input,
          summarizeAfter: step.summarizeAfter
        }
      }

      if (step.type === 'agent') {
        return {
          id: step.id,
          type: step.type,
          name: stepName,
          input: input || undefined,
          summarizeAfter: step.summarizeAfter
        }
      }

      return {
        id: step.id,
        type: step.type,
        name: stepName,
        args: args || undefined,
        input: input || undefined,
        summarizeAfter: step.summarizeAfter
      }
    })

    return {
      name: trimmedName,
      description: trimmedDescription || undefined,
      steps: normalizedSteps,
      settings
    }
  }, [name, description, steps, settings])

  const handleSave = useCallback(async (mode: 'save' | 'run') => {
    clearErrors()

    const { errors, stepErrors: nextStepErrors } = validateWorkflow()
    if (errors.length > 0 || Object.keys(nextStepErrors).length > 0) {
      const flattened = [...errors]
      Object.values(nextStepErrors).forEach(messages => {
        flattened.push(...messages)
      })
      setValidationErrors(flattened)
      setStepErrors(nextStepErrors)
      return
    }

    const payload = buildPayload()
    setIsSaving(true)
    if (mode === 'run') setIsRunning(true)

    try {
      let result: Workflow | null = null
      if (isEditMode && workflow) {
        result = await updateWorkflow(spaceId, workflow.id, payload)
      } else {
        result = await createWorkflow(spaceId, payload)
      }

      if (!result) {
        setError(isEditMode ? t('Failed to update workflow') : t('Failed to create workflow'))
        return
      }

      if (mode === 'run') {
        await runWorkflow(spaceId, result.id)
      }

      onSaved?.(result)
      onClose()
    } finally {
      setIsSaving(false)
      setIsRunning(false)
    }
  }, [buildPayload, clearErrors, createWorkflow, isEditMode, onClose, onSaved, runWorkflow, spaceId, t, updateWorkflow, validateWorkflow, workflow])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault()
      handleSave('save')
    }
  }, [handleSave, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 glass-overlay animate-fade-in"
        onClick={onClose}
      />

      <div className="relative w-full max-w-5xl max-h-[85vh] mx-4 glass-dialog
        border border-border/50 shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ListChecks size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('Edit Workflow') : t('Create New Workflow')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('Build your workflow with visual steps')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('Workflow Name')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    clearErrors()
                  }}
                  placeholder={t('Enter workflow name')}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg
                    focus:outline-none focus:border-primary text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('Description')}
                </label>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    clearErrors()
                  }}
                  placeholder={t('Describe what this workflow does')}
                  className="w-full min-h-[80px] px-3 py-2 bg-input border border-border rounded-lg
                    focus:outline-none focus:border-primary text-sm resize-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <div className="border border-border/50 rounded-xl bg-muted/20 p-3">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t('Steps')}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {t('Drag to reorder')}
                    </p>
                  </div>
                  <button
                    onClick={handleAddStep}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium
                      bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    {t('Add step')}
                  </button>
                </div>

                <div className="space-y-2">
                  {steps.map((step, index) => {
                    const isSelected = step.id === selectedStepId
                    const isDropTarget = dropTargetIndex === index
                    const hasErrors = !!stepErrors[step.id]
                    const label = step.name?.trim() || step.input?.trim() || t('Untitled step')

                    return (
                      <div
                        key={step.id}
                        draggable
                        onDragStart={(event) => handleDragStart(event, index)}
                        onDragOver={(event) => handleDragOver(event, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(event) => handleDrop(event, index)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedStepId(step.id)}
                        className={`group flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left
                          transition-colors cursor-pointer
                          ${isSelected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/40'}
                          ${isDropTarget ? 'ring-1 ring-primary/40' : ''}
                          ${hasErrors ? 'border-destructive/60 bg-destructive/5' : ''}`}
                      >
                        <GripVertical size={14} className="text-muted-foreground mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-medium truncate ${hasErrors ? 'text-destructive' : 'text-foreground'}`}>
                              {index + 1}. {label}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {step.type}
                            </span>
                          </div>
                          {step.type !== 'message' && step.input?.trim() && (
                            <p className="text-[10px] text-muted-foreground mt-1 truncate">
                              {step.input}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRemoveStep(step.id)
                          }}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                          title={t('Delete step')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="border border-border/50 rounded-xl bg-card p-4">
                {selectedStep ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {t('Step {{index}} details', { index: selectedIndex + 1 })}
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                          {t('Configure the action for this step')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveStep(selectedStep.id)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px]
                          text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                      >
                        <Trash2 size={12} />
                        {t('Delete')}
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-2">
                        {t('Step Type')}
                      </label>
                      <select
                        value={selectedStep.type}
                        onChange={(event) => {
                          const nextType = event.target.value as WorkflowStep['type']
                          const updates: Partial<WorkflowStep> = { type: nextType }
                          if (nextType === 'message') {
                            updates.name = ''
                            updates.args = ''
                          }
                          if (nextType === 'agent') {
                            updates.args = ''
                          }
                          updateStep(selectedStep.id, updates)
                        }}
                        className="w-full px-3 py-2 bg-input border border-border rounded-lg
                          focus:outline-none focus:border-primary text-sm"
                      >
                        <option value="skill">{t('Skill')}</option>
                        <option value="agent">{t('Agent')}</option>
                        <option value="message">{t('Message')}</option>
                      </select>
                    </div>

                    {(selectedStep.type === 'skill' || selectedStep.type === 'agent') && (
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">
                          {t('Name')}
                        </label>
                        <input
                          type="text"
                          value={selectedStep.name || ''}
                          onChange={(event) => updateStep(selectedStep.id, { name: event.target.value })}
                          placeholder={selectedStep.type === 'skill' ? 'my-skill' : 'my-agent'}
                          className="w-full px-3 py-2 bg-input border border-border rounded-lg
                            focus:outline-none focus:border-primary text-sm font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {t('Lowercase letters, numbers, and hyphens only')}
                        </p>
                      </div>
                    )}

                    {(selectedStep.type === 'skill' || selectedStep.type === 'agent') && (
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">
                          {selectedStep.type === 'skill' ? t('Select a skill') : t('Select an agent')}
                        </label>
                        <select
                          value={selectedStep.type === 'skill' ? selectedSkillName : selectedAgentName}
                          onChange={(event) => {
                            const nextName = event.target.value
                            if (nextName) {
                              updateStep(selectedStep.id, { name: nextName })
                            }
                          }}
                          disabled={selectedStep.type === 'skill'
                            ? isLoadingSkills || sortedSkills.length === 0
                            : isLoadingAgents || sortedAgents.length === 0}
                          className="w-full px-3 py-2 bg-input border border-border rounded-lg
                            focus:outline-none focus:border-primary text-sm"
                        >
                          <option value="">
                            {selectedStep.type === 'skill'
                              ? (isLoadingSkills ? t('Loading skills...') : t('Select a skill'))
                              : (isLoadingAgents ? t('Loading agents...') : t('Select an agent'))}
                          </option>
                          {(selectedStep.type === 'skill' ? sortedSkills : sortedAgents).map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {selectedStep.type === 'skill' && (
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">
                          {t('Args')}
                        </label>
                        <input
                          type="text"
                          value={selectedStep.args || ''}
                          onChange={(event) => updateStep(selectedStep.id, { args: event.target.value })}
                          placeholder="--fast"
                          className="w-full px-3 py-2 bg-input border border-border rounded-lg
                            focus:outline-none focus:border-primary text-sm font-mono"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-2">
                        {selectedStep.type === 'message' ? t('Message') : t('Input')}
                      </label>
                      <textarea
                        value={selectedStep.input || ''}
                        onChange={(event) => updateStep(selectedStep.id, { input: event.target.value })}
                        placeholder={selectedStep.type === 'message'
                          ? t('Enter the message to send')
                          : t('Optional input for this step')}
                        className="w-full min-h-[120px] px-3 py-2 bg-input border border-border rounded-lg
                          focus:outline-none focus:border-primary text-sm resize-none"
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                        <input
                          type="checkbox"
                          checked={!!selectedStep.summarizeAfter}
                          onChange={(event) => updateStep(selectedStep.id, { summarizeAfter: event.target.checked })}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        {t('Summarize and start a new session after this step')}
                      </label>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t('Applies before the next step runs')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    {t('Select a step to edit')}
                  </div>
                )}
              </div>
            </div>

            {(validationErrors.length > 0 || error) && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                {validationErrors.length > 0 ? (
                  <ul className="text-sm text-destructive space-y-1">
                    {validationErrors.map((message, index) => (
                      <li key={`${message}-${index}`}>{message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/30 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground
              hover:bg-muted rounded-lg transition-colors"
          >
            {t('Cancel')}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave('run')}
              disabled={isSaving || isRunning}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg
                border border-border bg-background hover:bg-muted transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              ) : (
                <Play size={16} />
              )}
              <span>{t('Run')}</span>
            </button>
            <button
              onClick={() => handleSave('save')}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm
                bg-primary text-primary-foreground hover:bg-primary/90
                rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving && !isRunning ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <Save size={16} />
              )}
              <span>{t('Save')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
