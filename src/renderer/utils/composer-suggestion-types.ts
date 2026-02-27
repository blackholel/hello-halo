export type ComposerSuggestionTab = 'skills' | 'commands' | 'agents'

export type ComposerSuggestionType = 'skill' | 'command' | 'agent'

export type ComposerSuggestionSource = 'app' | 'global' | 'space' | 'installed' | 'plugin'

export interface ComposerResourceSuggestionItem {
  kind: 'resource'
  id: string
  type: ComposerSuggestionType
  source: ComposerSuggestionSource
  scope: 'space' | 'global'
  stableId: string
  displayName: string
  insertText: string
  description?: string
  keywords: string[]
}

export interface ComposerActionSuggestionItem {
  kind: 'action'
  id: string
  type: ComposerSuggestionType
  actionId: 'expand-global' | 'collapse-global'
  label: string
  description?: string
}

export type ComposerSuggestionItem = ComposerResourceSuggestionItem | ComposerActionSuggestionItem
