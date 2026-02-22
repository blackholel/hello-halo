import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, X } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { useSpaceStore } from '../../stores/space.store'
import { useToolkitStore } from '../../stores/toolkit.store'
import { buildDirective } from '../../utils/directive-helpers'
import { copyResourceWithConflict, resolveActionButtonState, type CopyResourceResponse } from './resource-actions'
import { shouldLoadResourceContent } from './resource-content-loading'
import { fetchResourceContent, getSourceColor, getSourceLabel, mapResourceMeta } from './resource-meta'
import type { AnyResource, ResourceActionMode, ResourceType } from './types'
import { normalizeSceneTags, SCENE_TAG_CLASS, SCENE_TAG_LABEL_KEY } from './scene-tag-meta'

export interface ResourceCardProps {
  resource: AnyResource
  type: ResourceType
  index: number
  actionMode: ResourceActionMode
  workDir?: string
  onAfterAction?: () => void
  isActionDisabled?: boolean
  actionDisabledReason?: string
}

function toDirective(resource: AnyResource, type: ResourceType) {
  return buildDirective(type, resource as { name: string; namespace?: string; source?: string })
}

function toResourceRef(resource: AnyResource, type: ResourceType) {
  return {
    type,
    name: resource.name,
    namespace: resource.namespace,
    source: resource.source,
    path: resource.path
  }
}

function getTypeLabel(type: ResourceType, t: (key: string) => string): string {
  if (type === 'skill') return t('Skill')
  if (type === 'agent') return t('Agent')
  return t('Command')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Resource content request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

export function ResourceCard({
  resource,
  type,
  index,
  actionMode,
  workDir,
  onAfterAction,
  isActionDisabled,
  actionDisabledReason
}: ResourceCardProps): JSX.Element {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<string>('')
  const [contentError, setContentError] = useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [hasAttemptedLoadInCurrentOpen, setHasAttemptedLoadInCurrentOpen] = useState(false)
  const [isUpdatingToolkit, setIsUpdatingToolkit] = useState(false)
  const [isCopyingToSpace, setIsCopyingToSpace] = useState(false)
  const contentRequestIdRef = useRef(0)

  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const { getToolkit, isInToolkit, addResource, removeResource, loadToolkit, isToolkitLoaded } = useToolkitStore()

  const meta = useMemo(() => mapResourceMeta(resource, type), [resource, type])
  const directive = useMemo(() => toDirective(resource, type), [resource, type])
  const toolkitLoaded = !!currentSpace && isToolkitLoaded(currentSpace.id)
  const toolkit = getToolkit(currentSpace?.id)
  const hasToolkit = toolkitLoaded && toolkit !== null
  const inToolkit = hasToolkit && isInToolkit(currentSpace?.id, directive)
  const canManageToolkit = !!currentSpace && !currentSpace.isTemp

  const mergedActionDisabledReason = actionMode === 'copy-to-space' && !actionDisabledReason && !workDir
    ? t('No space selected')
    : actionDisabledReason

  const mergedActionDisabled = actionMode === 'copy-to-space'
    ? (!workDir || !!isActionDisabled)
    : !!isActionDisabled

  const actionState = resolveActionButtonState({
    actionMode,
    t,
    hasToolkit,
    inToolkit,
    isActionDisabled: mergedActionDisabled,
    actionDisabledReason: mergedActionDisabledReason,
    isActionInProgress: actionMode === 'toolkit' ? isUpdatingToolkit : isCopyingToSpace
  })

  const closeDialog = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (actionMode !== 'toolkit') return
    if (currentSpace && !currentSpace.isTemp && !toolkitLoaded) {
      void loadToolkit(currentSpace.id)
    }
  }, [actionMode, currentSpace, toolkitLoaded, loadToolkit])

  useEffect(() => {
    if (isOpen) return
    contentRequestIdRef.current += 1
    setHasAttemptedLoadInCurrentOpen(false)
    setIsLoadingContent(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (!shouldLoadResourceContent({
      isOpen,
      hasContent: !!content,
      hasError: !!contentError,
      hasAttemptedInCurrentOpen: hasAttemptedLoadInCurrentOpen
    })) return

    const requestId = contentRequestIdRef.current + 1
    contentRequestIdRef.current = requestId

    const loadContent = async (): Promise<void> => {
      try {
        setIsLoadingContent(true)
        setContentError(null)

        const response = await withTimeout(fetchResourceContent(resource, type, workDir), 8000)
        if (contentRequestIdRef.current !== requestId) return

        if (!response.success || !response.data) {
          setContentError(response.error || t('Failed to load details'))
          setContent('')
          return
        }

        const text = type === 'skill'
          ? (response.data as { content?: string }).content || ''
          : response.data as string
        setContent(text)
      } catch {
        if (contentRequestIdRef.current !== requestId) return
        setContentError(t('Failed to load details'))
        setContent('')
      } finally {
        if (contentRequestIdRef.current === requestId) {
          setIsLoadingContent(false)
          setHasAttemptedLoadInCurrentOpen(true)
        }
      }
    }

    void loadContent()
  }, [content, contentError, hasAttemptedLoadInCurrentOpen, isOpen, resource, t, type, workDir])

  const copyPath = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(meta.path)
    } catch {
      // Clipboard API may fail in some environments; silently ignore
    }
  }

  const handleToolkitAction = async (): Promise<void> => {
    if (!currentSpace || actionState.disabled) return
    try {
      setIsUpdatingToolkit(true)
      if (inToolkit) {
        await removeResource(currentSpace.id, directive)
      } else {
        await addResource(currentSpace.id, directive)
      }
      onAfterAction?.()
    } finally {
      setIsUpdatingToolkit(false)
    }
  }

  const handleCopyToSpaceAction = async (): Promise<void> => {
    if (!workDir || actionState.disabled) return

    const ref = toResourceRef(resource, type)

    const copyFn = async (overwrite?: boolean): Promise<CopyResourceResponse> => {
      if (type === 'skill') return api.copySkillToSpaceByRef(ref, workDir, { overwrite }) as Promise<CopyResourceResponse>
      if (type === 'agent') return api.copyAgentToSpaceByRef(ref, workDir, { overwrite }) as Promise<CopyResourceResponse>
      return api.copyCommandToSpaceByRef(ref, workDir, { overwrite }) as Promise<CopyResourceResponse>
    }

    try {
      setIsCopyingToSpace(true)
      const copied = await copyResourceWithConflict({
        copyFn,
        confirmFn: (message) => window.confirm(message),
        conflictMessage: t('Already added. Overwrite existing resource?')
      })
      if (copied) onAfterAction?.()
    } finally {
      setIsCopyingToSpace(false)
    }
  }

  const handleActionClick = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()

    if (actionMode === 'toolkit') {
      await handleToolkitAction()
      return
    }
    if (actionMode === 'copy-to-space') {
      await handleCopyToSpaceAction()
    }
  }

  const shouldShowAction = actionState.show && (
    actionMode !== 'toolkit' || canManageToolkit
  )

  const showActionReason = actionMode === 'copy-to-space'
    && !!actionState.reason
    && actionState.reason !== actionState.label
    && actionState.disabled

  const Icon = meta.icon
  const sceneTags = useMemo(
    () => normalizeSceneTags((resource as { sceneTags?: unknown }).sceneTags),
    [resource]
  )
  const typeLabel = getTypeLabel(type, t)

  const modal = isOpen ? (
    <div
      className="fixed inset-0 glass-overlay flex items-start justify-center p-4 sm:items-center z-50 animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      onClick={closeDialog}
    >
      <div
        className="glass-dialog p-6 w-full max-w-2xl my-6 sm:my-0 animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{meta.title}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-md ${getSourceColor(meta.source)}`}>
                {getSourceLabel(meta.source, t)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{meta.subtitle || t('No description')}</p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
            title={t('Close')}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="glass-subtle rounded-xl p-3">
            <div className="text-muted-foreground mb-1">{t('Path')}</div>
            <div className="font-mono break-all leading-relaxed">{meta.path}</div>
            <button
              type="button"
              onClick={copyPath}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {t('Copy path')}
            </button>
          </div>

          {meta.namespace && (
            <div className="glass-subtle rounded-xl p-3">
              <div className="text-muted-foreground mb-1">{t('Namespace')}</div>
              <div className="font-medium">{meta.namespace}</div>
            </div>
          )}

          {meta.details && meta.details.length > 0 && (
            <div className="glass-subtle rounded-xl p-3">
              <div className="text-muted-foreground mb-1">{t('Triggers')}</div>
              <div className="flex flex-wrap gap-1.5">
                {meta.details.map((item) => (
                  <span key={item} className="px-2 py-0.5 rounded-md bg-secondary text-foreground/90">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="glass-subtle rounded-xl p-3">
            <div className="text-muted-foreground mb-1">{t('Content')}</div>
            {isLoadingContent ? (
              <div className="text-muted-foreground">{t('Loading...')}</div>
            ) : contentError ? (
              <div className="text-destructive/80">{contentError}</div>
            ) : content ? (
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-64 overflow-auto">
                {content}
              </pre>
            ) : (
              <div className="text-muted-foreground">{t('No content')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="space-card p-4 text-left w-full stagger-item"
        style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.iconClassName}`}>
              <Icon className="w-[18px] h-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{meta.title}</div>
              <p
                className="text-xs text-muted-foreground mt-1 leading-relaxed overflow-hidden"
                title={meta.subtitle || t('No description')}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
              >
                {meta.subtitle || t('No description')}
              </p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-md flex-shrink-0 bg-foreground/5 text-foreground/70 border border-border/60">
            {typeLabel}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {sceneTags.map((tag) => (
            <span
              key={tag}
              className={`text-[10px] px-2 py-0.5 rounded-full border ${SCENE_TAG_CLASS[tag]}`}
            >
              {t(SCENE_TAG_LABEL_KEY[tag])}
            </span>
          ))}
        </div>

        <div className="mt-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-md ${getSourceColor(meta.source)} opacity-70`}>
            {getSourceLabel(meta.source, t)}
          </span>
        </div>

        {shouldShowAction && (
          <div className="mt-3 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={(event) => void handleActionClick(event)}
              disabled={actionState.disabled}
              title={actionState.reason}
              className="px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {actionState.label}
            </button>
            {showActionReason && (
              <span className="text-[10px] text-muted-foreground">{actionState.reason}</span>
            )}
          </div>
        )}
      </button>

      {typeof document !== 'undefined' && modal ? createPortal(modal, document.body) : null}
    </>
  )
}
