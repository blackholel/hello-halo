export type SceneTagKey = string

export const SCENE_COLOR_TOKENS = [
  'blue',
  'green',
  'violet',
  'orange',
  'cyan',
  'slate',
  'pink',
  'indigo'
] as const

export type SceneColorToken = (typeof SCENE_COLOR_TOKENS)[number]

export interface SceneDefinition {
  key: SceneTagKey
  label: {
    en: string
    zhCN: string
    zhTW: string
  }
  colorToken: SceneColorToken
  order: number
  enabled: boolean
  builtin: boolean
  synonyms?: string[]
}

export interface SceneTaxonomyConfig {
  version: 1
  definitions: SceneDefinition[]
  resourceOverrides: Record<string, SceneTagKey[]>
  deletedDefinitionKeys: SceneTagKey[]
  deletedOverrideKeys: string[]
  updatedAt: string
}

export interface SceneTaxonomyView {
  enabledDefinitions: SceneDefinition[]
  definitions: SceneDefinition[]
  overrideCount: number
  config: SceneTaxonomyConfig
}

export type SceneResourceType = 'skill' | 'agent' | 'command'
export type SceneResourceSource = 'app' | 'global' | 'space' | 'installed' | 'plugin'

export interface SceneResourceKeyInput {
  type: SceneResourceType
  source: SceneResourceSource
  workDir?: string
  namespace?: string
  name: string
}

export const BUILTIN_SCENE_TAG_KEYS = [
  'coding',
  'writing',
  'design',
  'data',
  'web',
  'office'
] as const

export const DEFAULT_SCENE_DEFINITIONS: SceneDefinition[] = [
  {
    key: 'coding',
    label: { en: 'Coding', zhCN: '编程开发', zhTW: '程式開發' },
    colorToken: 'blue',
    order: 10,
    enabled: true,
    builtin: true,
    synonyms: ['code', 'programming', 'debug', 'tdd']
  },
  {
    key: 'writing',
    label: { en: 'Writing', zhCN: '写作', zhTW: '寫作' },
    colorToken: 'green',
    order: 20,
    enabled: true,
    builtin: true,
    synonyms: ['document', 'blog', 'copywriting', 'translate']
  },
  {
    key: 'design',
    label: { en: 'Design', zhCN: '创意设计', zhTW: '創意設計' },
    colorToken: 'violet',
    order: 30,
    enabled: true,
    builtin: true,
    synonyms: ['ui', 'ux', 'prototype', 'visual']
  },
  {
    key: 'data',
    label: { en: 'Data', zhCN: '数据分析', zhTW: '資料分析' },
    colorToken: 'orange',
    order: 40,
    enabled: true,
    builtin: true,
    synonyms: ['analytics', 'report', 'sql', 'database']
  },
  {
    key: 'web',
    label: { en: 'Web', zhCN: '网页操作', zhTW: '網頁操作' },
    colorToken: 'cyan',
    order: 50,
    enabled: true,
    builtin: true,
    synonyms: ['browser', 'scrape', 'api', 'automation']
  },
  {
    key: 'office',
    label: { en: 'Office', zhCN: '办公套件', zhTW: '辦公套件' },
    colorToken: 'slate',
    order: 60,
    enabled: true,
    builtin: true,
    synonyms: ['word', 'excel', 'ppt', 'pdf']
  }
]

const SCENE_TAG_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BUILTIN_KEY_SET = new Set<string>(BUILTIN_SCENE_TAG_KEYS)

export function isValidSceneTagKey(key: string): boolean {
  return SCENE_TAG_KEY_PATTERN.test(key)
}

export function isBuiltinSceneTagKey(key: string): boolean {
  return BUILTIN_KEY_SET.has(key)
}

export function isValidSceneColorToken(value: unknown): value is SceneColorToken {
  return typeof value === 'string' && (SCENE_COLOR_TOKENS as readonly string[]).includes(value)
}

export function createEmptySceneTaxonomyConfig(now: string = new Date().toISOString()): SceneTaxonomyConfig {
  return {
    version: 1,
    definitions: [],
    resourceOverrides: {},
    deletedDefinitionKeys: [],
    deletedOverrideKeys: [],
    updatedAt: now
  }
}

export function sortSceneDefinitions(definitions: SceneDefinition[]): SceneDefinition[] {
  return [...definitions].sort((a, b) => {
    const orderDiff = a.order - b.order
    if (orderDiff !== 0) return orderDiff
    return a.key.localeCompare(b.key)
  })
}

export function normalizeSceneTagKeys(
  keys: unknown,
  knownKeys?: Set<string>,
  options?: { fallback?: SceneTagKey | null; max?: number }
): SceneTagKey[] {
  const fallback = options && Object.prototype.hasOwnProperty.call(options, 'fallback')
    ? options.fallback
    : 'office'
  const max = options?.max ?? 3
  const values = Array.isArray(keys) ? keys : typeof keys === 'string' ? keys.split(/[;,]/) : []
  const result: SceneTagKey[] = []
  const seen = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string') continue
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    if (!isValidSceneTagKey(key)) continue
    if (knownKeys && !knownKeys.has(key)) continue
    result.push(key)
    seen.add(key)
    if (result.length >= max) break
  }

  if (result.length > 0) return result
  if (fallback === null) {
    return []
  }
  if (knownKeys && !knownKeys.has(fallback)) {
    return []
  }
  return [fallback]
}

export function normalizeSceneDefinition(input: SceneDefinition): SceneDefinition {
  return {
    key: input.key.trim().toLowerCase(),
    label: {
      en: input.label.en.trim(),
      zhCN: input.label.zhCN.trim(),
      zhTW: input.label.zhTW.trim()
    },
    colorToken: input.colorToken,
    order: Number.isFinite(input.order) ? input.order : 0,
    enabled: !!input.enabled,
    builtin: !!input.builtin,
    synonyms: Array.isArray(input.synonyms)
      ? input.synonyms
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
      : undefined
  }
}
