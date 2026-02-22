import { BUILTIN_SCENE_TAG_KEYS } from './scene-taxonomy'

// Deprecated compatibility exports.
export const SCENE_TAGS = [...BUILTIN_SCENE_TAG_KEYS]

export type SceneTag = string

export type SceneFilter = SceneTag | 'all'

export function isSceneTag(value: unknown): value is SceneTag {
  return typeof value === 'string' && value.trim().length > 0
}
