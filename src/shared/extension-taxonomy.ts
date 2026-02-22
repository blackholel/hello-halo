export const SCENE_TAGS = [
  'coding',
  'writing',
  'design',
  'data',
  'web',
  'office'
] as const

export type SceneTag = typeof SCENE_TAGS[number]

export type SceneFilter = SceneTag | 'all'

export function isSceneTag(value: unknown): value is SceneTag {
  return typeof value === 'string' && (SCENE_TAGS as readonly string[]).includes(value)
}
