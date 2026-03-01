import type { ComposerSuggestionType } from '../utils/composer-suggestion-types'

const STORAGE_KEY = 'kite-composer-mru-v1'
const MAX_MRU_ITEMS_PER_SCOPE = 100

type TypeMruMap = Record<string, number>
type SpaceMruMap = Record<ComposerSuggestionType, TypeMruMap>
type ComposerMruState = Record<string, SpaceMruMap>

let memoryState: ComposerMruState | null = null

function createEmptySpaceMruMap(): SpaceMruMap {
  return {
    skill: {},
    command: {},
    agent: {}
  }
}

function normalizeState(raw: unknown): ComposerMruState {
  if (!raw || typeof raw !== 'object') return {}
  const state = raw as Record<string, unknown>
  const normalized: ComposerMruState = {}

  for (const [spaceId, spaceEntry] of Object.entries(state)) {
    if (!spaceEntry || typeof spaceEntry !== 'object') continue
    const typed = spaceEntry as Record<string, unknown>
    const next = createEmptySpaceMruMap()

    for (const type of ['skill', 'command', 'agent'] as const) {
      const source = typed[type]
      if (!source || typeof source !== 'object') continue
      for (const [stableId, value] of Object.entries(source as Record<string, unknown>)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        next[type][stableId] = value
      }
    }

    normalized[spaceId] = next
  }

  return normalized
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  if (typeof window.localStorage === 'undefined') return null
  return window.localStorage
}

function loadStateFromStorage(): ComposerMruState {
  if (memoryState) return memoryState

  const storage = getStorage()
  if (!storage) {
    memoryState = {}
    return memoryState
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      memoryState = {}
      return memoryState
    }
    memoryState = normalizeState(JSON.parse(raw))
    return memoryState
  } catch {
    memoryState = {}
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(memoryState))
    } catch {
      // Ignore storage write errors.
    }
    return memoryState
  }
}

function persistState(state: ComposerMruState): void {
  memoryState = state
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage write errors.
  }
}

function pruneMruMap(mruMap: TypeMruMap): TypeMruMap {
  const entries = Object.entries(mruMap)
  if (entries.length <= MAX_MRU_ITEMS_PER_SCOPE) return mruMap

  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, MAX_MRU_ITEMS_PER_SCOPE))
}

export function getComposerMruMap(spaceId: string, type: ComposerSuggestionType): TypeMruMap {
  const state = loadStateFromStorage()
  return state[spaceId]?.[type] || {}
}

export function touchComposerMru(
  spaceId: string,
  type: ComposerSuggestionType,
  stableId: string,
  timestamp: number = Date.now()
): void {
  const state = loadStateFromStorage()
  const spaceEntry = state[spaceId] || createEmptySpaceMruMap()
  const scopedMap = {
    ...spaceEntry[type],
    [stableId]: timestamp
  }

  const nextState: ComposerMruState = {
    ...state,
    [spaceId]: {
      ...spaceEntry,
      [type]: pruneMruMap(scopedMap)
    }
  }

  persistState(nextState)
}

export function clearComposerMruState(): void {
  persistState({})
}

export function _testSetComposerMruState(state: unknown): void {
  persistState(normalizeState(state))
}
