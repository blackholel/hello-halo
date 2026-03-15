export type WorkspaceViewMode = 'classic' | 'unified'

const WORKSPACE_VIEW_MODE_KEY = 'kite-workspace-view-mode'

export function readWorkspaceViewMode(): WorkspaceViewMode {
  try {
    const raw = localStorage.getItem(WORKSPACE_VIEW_MODE_KEY)
    return raw === 'unified' ? 'unified' : 'classic'
  } catch {
    return 'classic'
  }
}

export function persistWorkspaceViewMode(mode: WorkspaceViewMode): void {
  try {
    localStorage.setItem(WORKSPACE_VIEW_MODE_KEY, mode)
  } catch {
    // Ignore localStorage failures (private mode / quota).
  }
}
