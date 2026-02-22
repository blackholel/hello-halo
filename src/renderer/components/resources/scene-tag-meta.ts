import {
  DEFAULT_SCENE_DEFINITIONS,
  normalizeSceneTagKeys,
  sortSceneDefinitions,
  type SceneColorToken,
  type SceneDefinition
} from '../../../shared/scene-taxonomy'

export const SCENE_COLOR_CLASS: Record<SceneColorToken, string> = {
  blue: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  green: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  violet: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  orange: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
  slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  pink: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
}

export function getDefaultSceneDefinitions(): SceneDefinition[] {
  return sortSceneDefinitions(DEFAULT_SCENE_DEFINITIONS)
}

export function normalizeSceneDefinitions(definitions: unknown): SceneDefinition[] {
  if (!Array.isArray(definitions)) {
    return getDefaultSceneDefinitions()
  }
  const valid = definitions.filter((item): item is SceneDefinition => (
    !!item
    && typeof item === 'object'
    && typeof (item as SceneDefinition).key === 'string'
    && typeof (item as SceneDefinition).order === 'number'
    && typeof (item as SceneDefinition).enabled === 'boolean'
    && typeof (item as SceneDefinition).builtin === 'boolean'
    && typeof (item as SceneDefinition).label?.en === 'string'
    && typeof (item as SceneDefinition).label?.zhCN === 'string'
    && typeof (item as SceneDefinition).label?.zhTW === 'string'
    && typeof (item as SceneDefinition).colorToken === 'string'
  ))
  return valid.length > 0 ? sortSceneDefinitions(valid) : getDefaultSceneDefinitions()
}

export function getKnownSceneTagKeys(definitions: SceneDefinition[]): Set<string> {
  return new Set(definitions.map((item) => item.key))
}

export function normalizeSceneTags(sceneTags: unknown, definitions: SceneDefinition[]): string[] {
  const known = getKnownSceneTagKeys(definitions)
  return normalizeSceneTagKeys(sceneTags, known)
}

export function getSceneClassName(definitions: SceneDefinition[], key: string): string {
  const definition = definitions.find((item) => item.key === key)
  if (!definition) {
    return SCENE_COLOR_CLASS.slate
  }
  return SCENE_COLOR_CLASS[definition.colorToken] || SCENE_COLOR_CLASS.slate
}

export function getSceneLabel(definition: SceneDefinition, locale: string): string {
  if (locale === 'zh-CN') return definition.label.zhCN
  if (locale === 'zh-TW') return definition.label.zhTW
  return definition.label.en
}

export function getSceneOptions(definitions: SceneDefinition[]): SceneDefinition[] {
  return sortSceneDefinitions(definitions.filter((item) => item.enabled))
}
