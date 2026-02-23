import { X } from 'lucide-react'

interface ModelChipProps {
  modelId: string
  onRemove: () => void
  disabled?: boolean
}

export function ModelChip({ modelId, onRemove, disabled = false }: ModelChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-xs text-foreground/90">
      <span className="max-w-[180px] truncate" title={modelId}>{modelId}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`remove-${modelId}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
