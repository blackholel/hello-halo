import {
  createEmptySceneTaxonomyConfig,
  DEFAULT_SCENE_DEFINITIONS,
  sortSceneDefinitions,
  type SceneTaxonomyConfig
} from './scene-taxonomy'

export const SCENE_TAXONOMY_SEED: SceneTaxonomyConfig = {
  ...createEmptySceneTaxonomyConfig('2026-02-21T00:00:00.000Z'),
  definitions: sortSceneDefinitions(DEFAULT_SCENE_DEFINITIONS)
}
