import { SCENE_TAGS, type SceneTag, isSceneTag } from '../../../shared/extension-taxonomy'

export const SCENE_TAG_LABEL_KEY: Record<SceneTag, string> = {
  coding: 'Coding',
  writing: 'Writing',
  design: 'Design',
  data: 'Data',
  web: 'Web',
  office: 'Office'
}

export const SCENE_TAG_CLASS: Record<SceneTag, string> = {
  coding: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  writing: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  design: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
  data: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  web: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
  office: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
}

export function normalizeSceneTags(sceneTags: unknown): SceneTag[] {
  if (!Array.isArray(sceneTags)) {
    return ['office']
  }

  const normalized: SceneTag[] = []
  const seen = new Set<SceneTag>()

  for (const tag of sceneTags) {
    if (!isSceneTag(tag)) continue
    if (seen.has(tag)) continue
    normalized.push(tag)
    seen.add(tag)
    if (normalized.length >= 3) break
  }

  return normalized.length > 0 ? normalized : ['office']
}

export { SCENE_TAGS }
