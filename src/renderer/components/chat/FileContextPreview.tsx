/**
 * FileContextPreview - Display attached file contexts in input area
 * Features:
 * - Compact display with file icon and name
 * - Remove button on hover
 * - Smooth animations
 */

import { X } from 'lucide-react'
import type { FileContextAttachment } from '../../types'
import { FileIcon } from '../icons/ToolIcons'
import { useTranslation } from '../../i18n'

interface FileContextPreviewProps {
  files: FileContextAttachment[]
  onRemove: (id: string) => void
}

export function FileContextPreview({ files, onRemove }: FileContextPreviewProps) {
  const { t } = useTranslation()

  if (files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1 border-b border-border/30">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-1.5 pl-2 pr-1 py-1 bg-secondary/50 rounded-lg
            border border-border/50 text-xs group hover:bg-secondary/70 transition-colors"
          title={file.path}
        >
          <FileIcon extension={file.extension} size={14} />
          <span className="max-w-[120px] truncate text-foreground/80">{file.name}</span>
          <button
            onClick={() => onRemove(file.id)}
            className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title={t('Remove file')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
