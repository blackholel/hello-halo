/**
 * ChangeReviewBar - Review and rollback file changes above input area
 *
 * Layers:
 * 1. Collapsed summary bar
 * 2. Expanded file list
 * 3. Inline diff preview per file + full diff modal
 */

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  CornerDownLeft,
  ChevronDown,
  ChevronUp,
  FilePlus,
  FileText,
  FileX,
  ExternalLink,
  Maximize2
} from 'lucide-react'
import { DiffModal } from './DiffModal'
import { DiffContent } from './DiffContent'
import type { ChangeFile, ChangeSet } from '../../types'
import type { FileChange } from './types'
import { useTranslation } from '../../i18n'
import { api } from '../../api'

interface ChangeReviewBarProps {
  changeSet: ChangeSet
  onAcceptAll: () => Promise<ChangeSet | null>
  onAcceptFile: (filePath: string) => Promise<ChangeSet | null>
  onRollbackFile: (filePath?: string, force?: boolean) => Promise<{ changeSet: ChangeSet | null; conflicts: string[] }>
}

function mapToFileChange(file: ChangeFile): FileChange {
  if (file.type === 'create') {
    return {
      id: file.id,
      file: file.path,
      fileName: file.fileName,
      type: 'write',
      content: file.afterContent || '',
      stats: file.stats
    }
  }

  const oldString = file.beforeContent || ''
  const newString = file.type === 'delete' ? '' : (file.afterContent || '')

  return {
    id: file.id,
    file: file.path,
    fileName: file.fileName,
    type: 'edit',
    oldString,
    newString,
    stats: file.stats
  }
}

export function ChangeReviewBar({
  changeSet,
  onAcceptAll,
  onAcceptFile,
  onRollbackFile
}: ChangeReviewBarProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null)
  const [modalState, setModalState] = useState<{ isOpen: boolean; file: FileChange | null; index: number }>({
    isOpen: false,
    file: null,
    index: 0
  })

  const files = changeSet.files
  const allFiles = useMemo(() => files.map(mapToFileChange), [files])

  const handleOpenModal = (file: ChangeFile) => {
    const mapped = mapToFileChange(file)
    const index = allFiles.findIndex(f => f.id === mapped.id)
    setModalState({ isOpen: true, file: mapped, index: index >= 0 ? index : 0 })
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev'
      ? Math.max(0, modalState.index - 1)
      : Math.min(allFiles.length - 1, modalState.index + 1)

    setModalState(prev => ({
      ...prev,
      file: allFiles[newIndex],
      index: newIndex
    }))
  }

  const handleCloseModal = () => setModalState(prev => ({ ...prev, isOpen: false }))

  const handleRollback = async (filePath?: string) => {
    const result = await onRollbackFile(filePath, false)
    if (result.conflicts.length > 0) {
      const message = result.conflicts.length === 1
        ? t('This file has local edits. Rollback will discard them. Continue?')
        : t('Some files have local edits. Rollback will discard them. Continue?')
      const confirm = window.confirm(message)
      if (confirm) {
        await onRollbackFile(filePath, true)
      }
    }
  }

  return (
    <>
      <div className="mx-4 mb-2">
        <div className="rounded-xl border border-border/40 bg-muted/20">
          {/* Summary bar */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="text-[11px] text-muted-foreground/70">
                {t('Changes this turn')}
              </span>
              <span className="text-foreground/90">
                {changeSet.summary.totalFiles} {t('files')}
              </span>
              <span className="text-green-400/80">+{changeSet.summary.totalAdded}</span>
              <span className="text-red-400/80">-{changeSet.summary.totalRemoved}</span>
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onAcceptAll}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-emerald-400/90 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                title={t('Accept all')}
              >
                <CheckCircle2 size={12} />
                {t('Accept all')}
              </button>
            </div>
          </div>

          {/* Expanded list */}
          {isExpanded && (
            <div className="border-t border-border/30">
              <div className="max-h-[260px] overflow-y-auto">
                {files.map((file) => {
                  const isExpandedFile = expandedFileId === file.id
                  const isRolledBack = file.status === 'rolled_back'
                  const Icon = file.type === 'create' ? FilePlus : file.type === 'delete' ? FileX : FileText

                  return (
                    <div key={file.id} className="border-b border-border/20 last:border-b-0">
                      <div className="flex items-center gap-2 px-3 py-2 text-xs">
                        <button
                          onClick={() => setExpandedFileId(isExpandedFile ? null : file.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground transition-colors"
                        >
                          <span className="text-muted-foreground/50">{isExpandedFile ? '▼' : '▶'}</span>
                          <Icon size={14} className={file.type === 'create' ? 'text-green-400/70' : file.type === 'delete' ? 'text-red-400/70' : 'text-amber-400/70'} />
                          <span className={`truncate ${isRolledBack ? 'line-through text-muted-foreground/60' : 'text-foreground/80'}`}>
                            {file.relativePath || file.fileName}
                          </span>
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
                            {file.stats.added > 0 && <span className="text-green-400/80">+{file.stats.added}</span>}
                            {file.stats.added > 0 && file.stats.removed > 0 && <span className="mx-1 text-muted-foreground/40">/</span>}
                            {file.stats.removed > 0 && <span className="text-red-400/80">-{file.stats.removed}</span>}
                          </span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onAcceptFile(file.path)}
                            disabled={isRolledBack}
                            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${isRolledBack ? 'text-muted-foreground/40 cursor-not-allowed' : 'text-emerald-400/90 hover:text-emerald-300 hover:bg-emerald-500/10'}`}
                          >
                            <CheckCircle2 size={12} />
                            {t('Accept')}
                          </button>
                          <button
                            onClick={() => handleRollback(file.path)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-amber-400/90 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                          >
                            <CornerDownLeft size={12} />
                            {file.type === 'create' ? t('Delete') : t('Rollback')}
                          </button>
                        </div>
                      </div>

                      {isExpandedFile && (
                        <div className="px-3 pb-3">
                          <div className="rounded-lg border border-border/30 bg-background/30 overflow-hidden">
                            <DiffContent
                              type={file.type === 'create' ? 'write' : 'edit'}
                              oldString={file.beforeContent || ''}
                              newString={file.type === 'delete' ? '' : (file.afterContent || '')}
                              content={file.afterContent}
                              fileName={file.fileName}
                            />
                          </div>

                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <button
                              onClick={() => api.openArtifact(file.path)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              <ExternalLink size={12} />
                              {t('Open in editor')}
                            </button>
                            <button
                              onClick={() => handleOpenModal(file)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              <Maximize2 size={12} />
                              {t('View full diff')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <DiffModal
        isOpen={modalState.isOpen}
        file={modalState.file}
        allFiles={allFiles}
        currentIndex={modalState.index}
        onClose={handleCloseModal}
        onNavigate={handleNavigate}
      />
    </>
  )
}
