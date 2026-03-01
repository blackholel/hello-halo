/**
 * Toolkit Store - Space toolkit allowlist state
 *
 * toolkit === null  -> not configured, load all global resources
 * toolkit !== null  -> whitelist mode, only load listed resources
 */

import { create } from 'zustand'
import { api } from '../api'
import type { DirectiveRef, SpaceToolkit } from '../types'

const TOOLKIT_WRITE_DISABLED_MESSAGE = 'Toolkit write operations are disabled in global execution mode'

interface ToolkitState {
  toolkitsBySpaceId: Record<string, SpaceToolkit | null>
  isLoading: boolean
  error: string | null

  loadToolkit: (spaceId: string) => Promise<SpaceToolkit | null>
  addResource: (spaceId: string, directive: DirectiveRef) => Promise<SpaceToolkit | null>
  removeResource: (spaceId: string, directive: DirectiveRef) => Promise<SpaceToolkit | null>
  clearToolkit: (spaceId: string) => Promise<void>
  migrateFromPreferences: (spaceId: string, skills: string[], agents: string[]) => Promise<SpaceToolkit | null>
  getToolkit: (spaceId?: string | null) => SpaceToolkit | null
  isToolkitLoaded: (spaceId?: string | null) => boolean
  isInToolkit: (spaceId: string | null | undefined, directive: DirectiveRef) => boolean
}

function buildDirectiveId(directive: DirectiveRef): string {
  const source = directive.source ?? '-'
  const namespace = directive.namespace ?? '-'
  return `${directive.type}:${source}:${namespace}:${directive.name}`
}

function normalizeDirective(directive: DirectiveRef): DirectiveRef {
  if (directive.id) return directive
  return { ...directive, id: buildDirectiveId(directive) }
}

function matchesDirective(candidate: DirectiveRef, ref: DirectiveRef): boolean {
  if (candidate.id && candidate.id === ref.id) return true
  if (candidate.name !== ref.name) return false
  if (candidate.namespace && candidate.namespace !== ref.namespace) return false
  if (candidate.source && candidate.source !== ref.source) return false
  return true
}

/** Get the directive list from a toolkit by type */
function getDirectiveList(toolkit: SpaceToolkit, type: string): DirectiveRef[] {
  if (type === 'skill') return toolkit.skills
  if (type === 'command') return toolkit.commands
  return toolkit.agents
}

/** Update the toolkit cache for a space */
function setSpaceToolkit(
  set: (fn: (state: ToolkitState) => Partial<ToolkitState>) => void,
  spaceId: string,
  toolkit: SpaceToolkit | null
): void {
  set((state) => ({
    toolkitsBySpaceId: { ...state.toolkitsBySpaceId, [spaceId]: toolkit }
  }))
}

export const useToolkitStore = create<ToolkitState>((set, get) => ({
  toolkitsBySpaceId: {},
  isLoading: false,
  error: null,

  loadToolkit: async (spaceId: string): Promise<SpaceToolkit | null> => {
    if (!spaceId) return null
    try {
      set({ isLoading: true, error: null })
      const response = await api.getToolkit(spaceId)
      if (response.success) {
        const toolkit = (response.data as SpaceToolkit | null) ?? null
        setSpaceToolkit(set, spaceId, toolkit)
        return toolkit
      }
      set({ error: response.error || 'Failed to load toolkit' })
      return null
    } catch (error) {
      console.error('[ToolkitStore] Failed to load toolkit:', error)
      set({ error: 'Failed to load toolkit' })
      return null
    } finally {
      set({ isLoading: false })
    }
  },

  addResource: async (spaceId, directive): Promise<SpaceToolkit | null> => {
    if (!spaceId) return null
    void directive
    set({ error: TOOLKIT_WRITE_DISABLED_MESSAGE })
    return null
  },

  removeResource: async (spaceId, directive): Promise<SpaceToolkit | null> => {
    if (!spaceId) return null
    void directive
    set({ error: TOOLKIT_WRITE_DISABLED_MESSAGE })
    return null
  },

  clearToolkit: async (spaceId): Promise<void> => {
    if (!spaceId) return
    set({ error: TOOLKIT_WRITE_DISABLED_MESSAGE })
    throw new Error(TOOLKIT_WRITE_DISABLED_MESSAGE)
  },

  migrateFromPreferences: async (spaceId, skills, agents): Promise<SpaceToolkit | null> => {
    if (!spaceId) return null
    void skills
    void agents
    set({ error: TOOLKIT_WRITE_DISABLED_MESSAGE })
    return null
  },

  getToolkit: (spaceId): SpaceToolkit | null => {
    if (!spaceId) return null
    return get().toolkitsBySpaceId[spaceId] ?? null
  },

  isToolkitLoaded: (spaceId): boolean => {
    if (!spaceId) return false
    return Object.prototype.hasOwnProperty.call(get().toolkitsBySpaceId, spaceId)
  },

  isInToolkit: (spaceId, directive): boolean => {
    if (!spaceId) return false
    const toolkit = get().toolkitsBySpaceId[spaceId]
    if (!toolkit) return false
    const normalized = normalizeDirective(directive)
    const list = getDirectiveList(toolkit, normalized.type)
    return list.some((ref) => matchesDirective(normalized, ref))
  }
}))
