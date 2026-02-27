import type {
  ComposerActionSuggestionItem,
  ComposerResourceSuggestionItem,
  ComposerSuggestionItem,
  ComposerSuggestionSource,
  ComposerSuggestionType,
  ComposerSuggestionTab
} from './composer-suggestion-types'

const DEFAULT_SOURCE_PRIORITY: Record<ComposerSuggestionSource, number> = {
  space: 0,
  app: 1,
  global: 2,
  installed: 3,
  plugin: 4
}

export interface RankSuggestionOptions {
  query: string
  mruMap?: Record<string, number>
  sourcePriority?: Partial<Record<ComposerSuggestionSource, number>>
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

/**
 * Match tiers:
 * 0 = exact match
 * 1 = prefix match
 * 2 = contains match
 */
export function getMatchTier(
  query: string,
  values: string[]
): number | null {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return 0

  const normalizedValues = values
    .map(normalizeText)
    .filter(Boolean)

  if (normalizedValues.some(value => value === normalizedQuery)) return 0
  if (normalizedValues.some(value => value.startsWith(normalizedQuery))) return 1
  if (normalizedValues.some(value => value.includes(normalizedQuery))) return 2
  return null
}

export function rankSuggestions(
  items: ComposerResourceSuggestionItem[],
  options: RankSuggestionOptions
): ComposerResourceSuggestionItem[] {
  const sourcePriority = { ...DEFAULT_SOURCE_PRIORITY, ...(options.sourcePriority || {}) }
  const mruMap = options.mruMap || {}

  const scored = items
    .map((item) => {
      const tier = getMatchTier(options.query, item.keywords)
      if (tier === null) return null
      return {
        item,
        tier,
        sourceRank: sourcePriority[item.source] ?? 999,
        mru: mruMap[item.stableId] ?? 0
      }
    })
    .filter((entry): entry is { item: ComposerResourceSuggestionItem; tier: number; sourceRank: number; mru: number } => entry !== null)

  scored.sort((a, b) => {
    const sourceDiff = a.sourceRank - b.sourceRank
    if (sourceDiff !== 0) return sourceDiff

    const tierDiff = a.tier - b.tier
    if (tierDiff !== 0) return tierDiff

    const mruDiff = b.mru - a.mru
    if (mruDiff !== 0) return mruDiff

    const displayNameDiff = a.item.displayName.localeCompare(b.item.displayName, 'en', { sensitivity: 'base' })
    if (displayNameDiff !== 0) return displayNameDiff

    return a.item.id.localeCompare(b.item.id, 'en', { sensitivity: 'base' })
  })

  return scored.map(entry => entry.item)
}

export function splitSuggestionsByScope(
  items: ComposerResourceSuggestionItem[]
): { space: ComposerResourceSuggestionItem[]; global: ComposerResourceSuggestionItem[] } {
  const space: ComposerResourceSuggestionItem[] = []
  const global: ComposerResourceSuggestionItem[] = []

  for (const item of items) {
    if (item.scope === 'space') {
      space.push(item)
      continue
    }
    global.push(item)
  }

  return { space, global }
}

export function buildSuggestionStableId(input: {
  type: ComposerSuggestionType
  source: ComposerSuggestionSource
  namespace?: string
  name: string
  pluginRoot?: string
}): string {
  return [
    input.type,
    input.source,
    input.namespace || '-',
    input.name,
    input.pluginRoot || '-'
  ].join('|')
}

export function buildGlobalExpandStateKey(input: {
  spaceId: string
  triggerMode: 'slash' | 'mention'
  tab: ComposerSuggestionTab
}): string {
  return `${input.spaceId}|${input.triggerMode}|${input.tab}`
}

export function shouldResetGlobalExpandState(input: {
  prevStateKey: string | null
  nextStateKey: string | null
  prevQuery: string
  nextQuery: string
  isComposing: boolean
}): boolean {
  if (input.isComposing) return false
  if (!input.prevStateKey || !input.nextStateKey) return false
  if (input.prevStateKey !== input.nextStateKey) return true
  return normalizeText(input.prevQuery) !== normalizeText(input.nextQuery)
}

export function buildGlobalToggleAction(input: {
  type: ComposerSuggestionType
  actionId: 'expand-global' | 'collapse-global'
  label: string
  description?: string
}): ComposerActionSuggestionItem {
  return {
    kind: 'action',
    id: `action:${input.type}:${input.actionId}`,
    type: input.type,
    actionId: input.actionId,
    label: input.label,
    ...(input.description ? { description: input.description } : {})
  }
}

export function buildVisibleSuggestions(params: {
  spaceSuggestions: ComposerResourceSuggestionItem[]
  globalSuggestions: ComposerResourceSuggestionItem[]
  expanded: boolean
  type: ComposerSuggestionType
  expandLabel: string
  collapseLabel: string
  expandDescription?: string
}): ComposerSuggestionItem[] {
  const { spaceSuggestions, globalSuggestions, expanded } = params

  if (globalSuggestions.length === 0) {
    return [...spaceSuggestions]
  }

  if (!expanded) {
    return [
      ...spaceSuggestions,
      buildGlobalToggleAction({
        type: params.type,
        actionId: 'expand-global',
        label: params.expandLabel,
        description: params.expandDescription
      })
    ]
  }

  return [
    ...spaceSuggestions,
    ...globalSuggestions,
    buildGlobalToggleAction({
      type: params.type,
      actionId: 'collapse-global',
      label: params.collapseLabel
    })
  ]
}
