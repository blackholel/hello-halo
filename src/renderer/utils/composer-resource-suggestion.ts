import { buildSuggestionStableId } from './composer-suggestion-ranking'
import type {
  ComposerResourceSuggestionItem,
  ComposerSuggestionSource,
  ComposerSuggestionType
} from './composer-suggestion-types'
import { toResourceKey } from './resource-key'

export interface ComposerSuggestionResourceInput {
  name: string
  displayName?: string
  description?: string
  namespace?: string
  source?: string
  path: string
  pluginRoot?: string
}

export function getLocalizedSuggestionName(item: {
  name: string
  displayName?: string
  namespace?: string
}): string {
  const base = item.displayName || item.name
  return item.namespace ? `${item.namespace}:${base}` : base
}

export function normalizeComposerSuggestionSource(source: string | undefined): ComposerSuggestionSource {
  if (source === 'app' || source === 'global' || source === 'space' || source === 'installed' || source === 'plugin') {
    return source
  }
  return 'space'
}

function toSuggestionScope(source: ComposerSuggestionSource): 'space' | 'global' {
  return source === 'space' ? 'space' : 'global'
}

function buildInsertText(type: ComposerSuggestionType, key: string): string {
  return type === 'agent' ? `@${key}` : `/${key}`
}

export function buildComposerResourceSuggestion(
  type: ComposerSuggestionType,
  item: ComposerSuggestionResourceInput
): ComposerResourceSuggestionItem {
  const source = normalizeComposerSuggestionSource(item.source)
  const key = toResourceKey(item)

  return {
    kind: 'resource',
    id: `${type}:${item.path}`,
    stableId: buildSuggestionStableId({
      type,
      source,
      namespace: item.namespace,
      name: item.name,
      pluginRoot: item.pluginRoot
    }),
    type,
    source,
    scope: toSuggestionScope(source),
    displayName: getLocalizedSuggestionName(item),
    insertText: buildInsertText(type, key),
    description: item.description,
    keywords: [key, item.name, item.displayName, item.description].filter((entry): entry is string => Boolean(entry))
  }
}
