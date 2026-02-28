/**
 * Skills Store - Skills state management
 *
 * Manages the state of skills loaded from various sources:
 * - App-level skills (~/.kite/skills/)
 * - Global custom paths
 * - Installed plugins
 * - Space-level skills ({workDir}/.claude/skills/)
 */

import { create } from 'zustand'
import { api } from '../api'
import i18n from '../i18n'
import { getCacheKey, getAllCacheKeys, GLOBAL_CACHE_KEY } from './cache-keys'
import { useSpaceStore } from './space.store'
import { useToolkitStore } from './toolkit.store'
import { buildDirective } from '../utils/directive-helpers'
import type { SceneTag } from '../../shared/extension-taxonomy'
import type { ResourceExposure } from '../../shared/resource-access'

// ============================================
// Types
// ============================================

export interface SkillDefinition {
  name: string
  displayName?: string
  path: string
  source: 'app' | 'global' | 'space' | 'installed'
  description?: string
  triggers?: string[]
  category?: string
  sceneTags?: SceneTag[]
  pluginRoot?: string
  namespace?: string
  exposure: ResourceExposure
}

export interface SkillContent {
  name: string
  content: string
  frontmatter?: Record<string, unknown>
}

interface SkillsState {
  // Data
  skills: SkillDefinition[]
  loadedWorkDir: string | null
  selectedSkill: SkillDefinition | null
  skillContent: SkillContent | null
  skillsByWorkDir: Record<string | symbol, SkillDefinition[]>
  dirtyWorkDirs: Set<string | symbol>

  // UI State
  isLoading: boolean
  isLoadingContent: boolean
  searchQuery: string
  error: string | null

  // Actions
  loadSkills: (workDir?: string) => Promise<void>
  selectSkill: (skill: SkillDefinition | null) => void
  loadSkillContent: (name: string, workDir?: string) => Promise<SkillContent | null>
  setSearchQuery: (query: string) => void
  createSkill: (workDir: string, name: string, content: string) => Promise<SkillDefinition | null>
  updateSkill: (skillPath: string, content: string) => Promise<boolean>
  deleteSkill: (skillPath: string) => Promise<boolean>
  copyToSpace: (
    skill: SkillDefinition,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<{ status: 'copied' | 'conflict' | 'not_found'; data?: SkillDefinition }>
  clearCache: () => Promise<void>
  markDirty: (workDir?: string | null) => void
  markAllDirty: () => void

  // Selectors (computed values)
  getFilteredSkills: () => SkillDefinition[]
  getSkillsBySource: (source: SkillDefinition['source']) => SkillDefinition[]
  getSkillByName: (name: string) => SkillDefinition | undefined
}

// ============================================
// Store
// ============================================

export const useSkillsStore = create<SkillsState>((set, get) => ({
  // Initial state
  skills: [],
  loadedWorkDir: null,
  selectedSkill: null,
  skillContent: null,
  skillsByWorkDir: {},
  dirtyWorkDirs: new Set<string | symbol>(),
  isLoading: false,
  isLoadingContent: false,
  searchQuery: '',
  error: null,

  // Load all skills from all sources
  loadSkills: async (workDir?: string) => {
    const cacheKey = getCacheKey(workDir)
    const { skillsByWorkDir, dirtyWorkDirs } = get()
    const cached = skillsByWorkDir[cacheKey]
    if (cached && !dirtyWorkDirs.has(cacheKey)) {
      set({
        skills: cached,
        loadedWorkDir: workDir ?? null,
        error: null,
        isLoading: false
      })
      return
    }

    try {
      set({ isLoading: true, error: null })

      const response = await api.listSkills(workDir, i18n.language, 'extensions')

      if (response.success && response.data) {
        const nextByWorkDir = {
          ...get().skillsByWorkDir,
          [cacheKey]: response.data as SkillDefinition[]
        }
        const nextDirty = new Set(get().dirtyWorkDirs)
        nextDirty.delete(cacheKey)
        set({
          skills: response.data as SkillDefinition[],
          loadedWorkDir: workDir ?? null,
          skillsByWorkDir: nextByWorkDir,
          dirtyWorkDirs: nextDirty
        })
      } else {
        set({ error: response.error || 'Failed to load skills' })
      }
    } catch (error) {
      console.error('[SkillsStore] Failed to load skills:', error)
      set({ error: 'Failed to load skills' })
    } finally {
      set({ isLoading: false })
    }
  },

  // Select a skill for viewing/editing
  selectSkill: (skill) => {
    set({ selectedSkill: skill, skillContent: null })
  },

  // Load skill content (SKILL.md)
  loadSkillContent: async (name, workDir) => {
    try {
      set({ isLoadingContent: true })

      const response = await api.getSkillContent(name, workDir)

      if (response.success && response.data) {
        const content = response.data as SkillContent
        set({ skillContent: content })
        return content
      } else {
        set({ error: response.error || 'Failed to load skill content' })
        return null
      }
    } catch (error) {
      console.error('[SkillsStore] Failed to load skill content:', error)
      set({ error: 'Failed to load skill content' })
      return null
    } finally {
      set({ isLoadingContent: false })
    }
  },

  // Set search query for filtering
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  // Create a new skill in space directory
  createSkill: async (workDir, name, content) => {
    try {
      const response = await api.createSkill(workDir, name, content)

      if (response.success && response.data) {
        const newSkill = response.data as SkillDefinition
        const cacheKey = getCacheKey(workDir)

        // Add to skills list
        set((state) => ({
          skills: [...state.skills, newSkill],
          skillsByWorkDir: {
            ...state.skillsByWorkDir,
            [cacheKey]: [...(state.skillsByWorkDir[cacheKey] || []), newSkill]
          }
        }))

        const currentSpace = useSpaceStore.getState().currentSpace
        if (currentSpace) {
          const toolkitStore = useToolkitStore.getState()
          if (toolkitStore.getToolkit(currentSpace.id)) {
            void toolkitStore.addResource(currentSpace.id, buildDirective('skill', newSkill))
          }
        }

        return newSkill
      } else {
        set({ error: response.error || 'Failed to create skill' })
        return null
      }
    } catch (error) {
      console.error('[SkillsStore] Failed to create skill:', error)
      set({ error: 'Failed to create skill' })
      return null
    }
  },

  // Update an existing skill
  updateSkill: async (skillPath, content) => {
    try {
      const response = await api.updateSkill(skillPath, content)

      if (response.success) {
        // Reload skills to get updated data
        const { skills, selectedSkill, loadedWorkDir, loadSkillContent } = get()
        const skill = skills.find(s => s.path === skillPath)
        // Reload the skill content if it's currently selected
        if (skill && selectedSkill?.path === skillPath) {
          await loadSkillContent(skill.name, loadedWorkDir ?? undefined)
        }
        return true
      } else {
        set({ error: response.error || 'Failed to update skill' })
        return false
      }
    } catch (error) {
      console.error('[SkillsStore] Failed to update skill:', error)
      set({ error: 'Failed to update skill' })
      return false
    }
  },

  // Delete a skill
  deleteSkill: async (skillPath) => {
    try {
      const response = await api.deleteSkill(skillPath)

      if (response.success) {
        // Remove from skills list
        set((state) => {
          const cacheKey = getCacheKey(state.loadedWorkDir)
          return {
            skills: state.skills.filter(s => s.path !== skillPath),
            skillsByWorkDir: {
              ...state.skillsByWorkDir,
              [cacheKey]: (state.skillsByWorkDir[cacheKey] || [])
                .filter(s => s.path !== skillPath)
            },
            // Clear selection if deleted skill was selected
            selectedSkill: state.selectedSkill?.path === skillPath ? null : state.selectedSkill,
            skillContent: state.selectedSkill?.path === skillPath ? null : state.skillContent
          }
        })
        return true
      } else {
        set({ error: response.error || 'Failed to delete skill' })
        return false
      }
    } catch (error) {
      console.error('[SkillsStore] Failed to delete skill:', error)
      set({ error: 'Failed to delete skill' })
      return false
    }
  },

  // Copy a skill to space directory
  copyToSpace: async (skill, workDir, options) => {
    try {
      const response = await api.copySkillToSpaceByRef({
        type: 'skill',
        name: skill.name,
        namespace: skill.namespace,
        source: skill.source,
        path: skill.path
      }, workDir, options)

      if (response.success && response.data) {
        const copyResult = response.data as { status: 'copied' | 'conflict' | 'not_found'; data?: SkillDefinition }
        if (copyResult.status !== 'copied' || !copyResult.data) {
          return copyResult
        }
        const copiedSkill = copyResult.data
        const cacheKey = getCacheKey(workDir)

        // Update skills list - replace by exact path, avoid clobbering same-name resources
        set((state) => ({
          skills: state.skills.map(s => s.path === skill.path ? copiedSkill : s),
          skillsByWorkDir: {
            ...state.skillsByWorkDir,
            [cacheKey]: (state.skillsByWorkDir[cacheKey] || []).map(s => s.path === skill.path ? copiedSkill : s)
          }
        }))

        return { status: 'copied', data: copiedSkill }
      }
      set({ error: response.error || 'Failed to copy skill to space' })
      return { status: 'not_found' }
    } catch (error) {
      console.error('[SkillsStore] Failed to copy skill to space:', error)
      set({ error: 'Failed to copy skill to space' })
      return { status: 'not_found' }
    }
  },

  // Clear skills cache and reload
  clearCache: async () => {
    try {
      await api.clearSkillsCache()
      set((state) => {
        const allKeys = getAllCacheKeys(state.skillsByWorkDir)
        const nextDirty = new Set(allKeys)
        nextDirty.add(GLOBAL_CACHE_KEY)
        return { dirtyWorkDirs: nextDirty }
      })
    } catch (error) {
      console.error('[SkillsStore] Failed to clear cache:', error)
    }
  },

  markDirty: (workDir) => {
    const cacheKey = getCacheKey(workDir)
    set((state) => {
      const nextDirty = new Set(state.dirtyWorkDirs)
      nextDirty.add(cacheKey)
      return { dirtyWorkDirs: nextDirty }
    })
  },

  markAllDirty: () => {
    set((state) => {
      const allKeys = getAllCacheKeys(state.skillsByWorkDir)
      const nextDirty = new Set(allKeys)
      nextDirty.add(GLOBAL_CACHE_KEY)
      return { dirtyWorkDirs: nextDirty }
    })
  },

  // Get filtered skills based on search query
  getFilteredSkills: () => {
    const { skills, searchQuery } = get()

    if (!searchQuery.trim()) {
      return skills
    }

    const query = searchQuery.toLowerCase()
    return skills.filter(skill =>
      skill.name.toLowerCase().includes(query) ||
      skill.displayName?.toLowerCase().includes(query) ||
      skill.description?.toLowerCase().includes(query) ||
      skill.category?.toLowerCase().includes(query) ||
      skill.triggers?.some(t => t.toLowerCase().includes(query))
    )
  },

  // Get skills by source
  getSkillsBySource: (source) => {
    const { skills } = get()
    return skills.filter(s => s.source === source)
  },

  // Get a skill by name
  getSkillByName: (name) => {
    const { skills } = get()
    return skills.find(s => s.name === name)
  }
}))

let skillsListenersInitialized = false

export function initSkillsStoreListeners(): void {
  if (skillsListenersInitialized) return
  skillsListenersInitialized = true

  api.onSkillsChanged((data) => {
    const payload = data as { workDir?: string | null }
    const { loadedWorkDir, loadSkills, markDirty, markAllDirty } = useSkillsStore.getState()
    if (payload.workDir == null) {
      markAllDirty()
      loadSkills(loadedWorkDir ?? undefined)
      return
    }
    markDirty(payload.workDir)
    if (payload.workDir === loadedWorkDir) {
      loadSkills(loadedWorkDir ?? undefined)
    }
  })

  i18n.on('languageChanged', () => {
    const { loadedWorkDir, loadSkills, markAllDirty } = useSkillsStore.getState()
    markAllDirty()
    void loadSkills(loadedWorkDir ?? undefined)
  })
}

// ============================================
// Selectors (for use with shallow comparison)
// ============================================

export const selectSkills = (state: SkillsState) => state.skills
export const selectSelectedSkill = (state: SkillsState) => state.selectedSkill
export const selectSkillContent = (state: SkillsState) => state.skillContent
export const selectIsLoading = (state: SkillsState) => state.isLoading
export const selectSearchQuery = (state: SkillsState) => state.searchQuery
export const selectError = (state: SkillsState) => state.error
