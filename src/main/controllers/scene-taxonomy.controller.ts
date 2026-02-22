import {
  exportSceneTaxonomy as serviceExportSceneTaxonomy,
  getSceneTaxonomy as serviceGetSceneTaxonomy,
  importSceneTaxonomy as serviceImportSceneTaxonomy,
  removeResourceSceneOverride as serviceRemoveResourceSceneOverride,
  removeSceneDefinition as serviceRemoveSceneDefinition,
  setResourceSceneOverride as serviceSetResourceSceneOverride,
  upsertSceneDefinition as serviceUpsertSceneDefinition
} from '../services/scene-taxonomy.service'
import type { SceneDefinition, SceneTagKey, SceneTaxonomyConfig } from '../../shared/scene-taxonomy'
import type { ControllerResponse } from './config.controller'

export function getSceneTaxonomy(): ControllerResponse {
  try {
    return { success: true, data: serviceGetSceneTaxonomy() }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function upsertSceneDefinition(definition: SceneDefinition): ControllerResponse {
  try {
    return { success: true, data: serviceUpsertSceneDefinition(definition) }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function removeSceneDefinition(key: string): ControllerResponse {
  try {
    return { success: true, data: serviceRemoveSceneDefinition(key) }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function setResourceSceneOverride(resourceKey: string, tags: SceneTagKey[]): ControllerResponse {
  try {
    return { success: true, data: serviceSetResourceSceneOverride(resourceKey, tags) }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function removeResourceSceneOverride(resourceKey: string): ControllerResponse {
  try {
    return { success: true, data: serviceRemoveResourceSceneOverride(resourceKey) }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function exportSceneTaxonomy(): ControllerResponse {
  try {
    return { success: true, data: serviceExportSceneTaxonomy() }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}

export function importSceneTaxonomy(payload: SceneTaxonomyConfig, mode: 'merge' | 'replace'): ControllerResponse {
  try {
    return { success: true, data: serviceImportSceneTaxonomy(payload, mode) }
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message }
  }
}
