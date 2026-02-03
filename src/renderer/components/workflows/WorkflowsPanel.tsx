/**
 * WorkflowsPanel - Collapsible panel for managing workflows
 */

import { useEffect, useMemo, useState } from 'react'
import { ListChecks, ChevronDown, Play, Trash2, Plus, Edit2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useWorkflowsStore } from '../../stores/workflows.store'
import type { WorkflowMeta, Workflow } from '../../types'
import { WorkflowEditorModal } from './WorkflowEditorModal'

interface WorkflowsPanelProps {
  spaceId: string
}

export function WorkflowsPanel({ spaceId }: WorkflowsPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const {
    workflows,
    loadedSpaceId,
    isLoading,
    loadWorkflows,
    loadWorkflow,
    deleteWorkflow,
    runWorkflow,
    activeRun
  } = useWorkflowsStore()

  useEffect(() => {
    if (isExpanded && loadedSpaceId !== spaceId) {
      loadWorkflows(spaceId)
    }
  }, [isExpanded, loadedSpaceId, spaceId, loadWorkflows])

  const handleClose = () => {
    setIsAnimatingOut(true)
    setTimeout(() => {
      setIsExpanded(false)
      setIsAnimatingOut(false)
    }, 200)
  }

  const handleToggle = () => {
    if (isExpanded) {
      handleClose()
    } else {
      setIsExpanded(true)
    }
  }

  const handleEdit = async (workflowId: string) => {
    const wf = await loadWorkflow(spaceId, workflowId)
    if (wf) {
      setEditingWorkflow(wf)
      setIsEditorOpen(true)
    }
  }

  const handleCreate = () => {
    setEditingWorkflow(null)
    setIsEditorOpen(true)
  }

  const visibleWorkflows = useMemo(() => workflows, [workflows])

  return (
    <div className="w-full">
      <button
        onClick={handleToggle}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-200
          ${isExpanded
            ? 'bg-muted/60 text-foreground border border-border/60'
            : 'hover:bg-muted/50 text-muted-foreground'
          }
        `}
        title={t('Workflows')}
      >
        <span className="flex items-center gap-2">
          <ListChecks size={16} className={isExpanded ? 'text-primary' : ''} />
          <span className="text-sm font-semibold">{t('Workflows')}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {workflows.length}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isExpanded && (
        <div
          className={`
            mt-2 w-full
            bg-card/90 backdrop-blur-xl rounded-xl border border-border/60
            shadow-sm overflow-hidden
            ${isAnimatingOut ? 'animate-fade-out' : 'animate-fade-in'}
          `}
          style={{ animationDuration: '0.2s' }}
        >
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-foreground">{t('Workflows')}</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('{{count}} workflows available', { count: workflows.length })}
              </p>
            </div>
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium
                bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
            >
              <Plus size={14} />
              {t('New workflow')}
            </button>
          </div>

          <div className="max-h-[320px] overflow-auto px-1 py-1">
            {isLoading ? (
              <div className="px-4 py-6 text-center">
                <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">{t('Loading workflows...')}</p>
              </div>
            ) : visibleWorkflows.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/50 flex items-center justify-center">
                  <ListChecks size={24} className="text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('No workflows available')}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {t('Create a new workflow to get started')}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {visibleWorkflows.map((workflow: WorkflowMeta) => (
                  <div
                    key={workflow.id}
                    className="w-full px-3 py-2 text-left rounded-md transition-all duration-150
                      hover:bg-muted/40 group relative"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground truncate">
                            {workflow.name}
                          </span>
                        </div>
                        {workflow.description && (
                          <p className="text-[11px] text-muted-foreground mt-1 truncate">
                            {workflow.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={() => runWorkflow(spaceId, workflow.id)}
                          className="px-2 py-1 text-[10px] font-medium rounded-md
                            bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          title={t('Run workflow')}
                        >
                          <Play size={12} />
                        </button>
                        <button
                          onClick={() => handleEdit(workflow.id)}
                          className="p-1.5 hover:bg-muted/60 text-muted-foreground hover:text-foreground rounded transition-colors"
                          title={t('Edit workflow')}
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => deleteWorkflow(spaceId, workflow.id)}
                          className="p-1.5 hover:bg-destructive/10 text-destructive rounded transition-colors"
                          title={t('Delete workflow')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {activeRun && activeRun.isRunning && activeRun.spaceId === spaceId && (
            <div className="border-t border-border/30 px-3 py-2">
              <p className="text-[10px] text-muted-foreground">
                {t('Running workflow: {{name}}', { name: activeRun.workflow.name })}
              </p>
              <div className="mt-1 space-y-1">
                {activeRun.steps.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-2 text-[10px]">
                    <span className={
                      step.status === 'running'
                        ? 'text-primary'
                        : step.status === 'completed'
                          ? 'text-green-500'
                          : step.status === 'error'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                    }>
                      {idx + 1}. {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isEditorOpen && (
        <WorkflowEditorModal
          spaceId={spaceId}
          workflow={editingWorkflow || undefined}
          onClose={() => setIsEditorOpen(false)}
        />
      )}
    </div>
  )
}
