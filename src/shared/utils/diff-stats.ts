import { diffLines } from 'diff'

export interface LineDiffStats {
  added: number
  removed: number
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

function countLines(value: string): number {
  if (!value) return 0
  const normalized = normalizeContent(value)
  const segments = normalized.split('\n')
  if (normalized.endsWith('\n')) {
    segments.pop()
  }
  return segments.length
}

export function calculateLineDiffStats(oldContent: string, newContent: string): LineDiffStats {
  const before = normalizeContent(oldContent || '')
  const after = normalizeContent(newContent || '')
  const chunks = diffLines(before, after)

  let added = 0
  let removed = 0

  for (const chunk of chunks) {
    const lines = countLines(chunk.value || '')
    if (chunk.added) {
      added += lines
      continue
    }
    if (chunk.removed) {
      removed += lines
    }
  }

  return { added, removed }
}
