import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const APP_ROOT = join(tmpdir(), 'kite-scene-taxonomy-service')
let adminEnabled = false

vi.mock('../config-source-mode.service', () => ({
  getLockedUserConfigRootDir: vi.fn(() => APP_ROOT)
}))

vi.mock('../config.service', async () => {
  const actual = await vi.importActual<typeof import('../config.service')>('../config.service')
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      extensionTaxonomy: {
        adminEnabled
      }
    }))
  }
})

import {
  buildResourceSceneKey,
  exportSceneTaxonomy,
  getSceneTaxonomy,
  importSceneTaxonomy,
  removeSceneDefinition,
  removeResourceSceneOverride,
  resetSceneTaxonomyCache,
  setResourceSceneOverride,
  upsertSceneDefinition
} from '../scene-taxonomy.service'

describe('scene-taxonomy.service', () => {
  beforeEach(() => {
    adminEnabled = false
    if (!existsSync(APP_ROOT)) {
      mkdirSync(APP_ROOT, { recursive: true })
    }
    resetSceneTaxonomyCache()
  })

  afterEach(() => {
    resetSceneTaxonomyCache()
    if (existsSync(APP_ROOT)) {
      rmSync(APP_ROOT, { recursive: true, force: true })
    }
  })

  it('requires admin permissions for mutations', () => {
    expect(() => upsertSceneDefinition({
      key: 'marketing',
      label: { en: 'Marketing', zhCN: '营销', zhTW: '行銷' },
      colorToken: 'pink',
      order: 60,
      enabled: true,
      builtin: false
    })).toThrowError(/admin/i)
  })

  it('supports upsert/remove definition and override lifecycle', () => {
    adminEnabled = true

    upsertSceneDefinition({
      key: 'marketing',
      label: { en: 'Marketing', zhCN: '营销', zhTW: '行銷' },
      colorToken: 'pink',
      order: 60,
      enabled: true,
      builtin: false
    })

    const resourceKey = buildResourceSceneKey({
      type: 'skill',
      source: 'space',
      workDir: '/tmp/work-a',
      namespace: '-',
      name: 'publish'
    })

    setResourceSceneOverride(resourceKey, ['marketing', 'coding'])
    let state = getSceneTaxonomy()
    expect(state.overrideCount).toBe(1)
    expect(state.config.resourceOverrides[resourceKey]).toEqual(['marketing', 'coding'])

    removeResourceSceneOverride(resourceKey)
    state = getSceneTaxonomy()
    expect(state.config.resourceOverrides[resourceKey]).toBeUndefined()

    removeSceneDefinition('marketing')
    state = getSceneTaxonomy()
    expect(state.config.definitions.find((item) => item.key === 'marketing')).toBeUndefined()
  })

  it('rejects override tags when all input tags are empty or unknown', () => {
    adminEnabled = true
    const resourceKey = buildResourceSceneKey({
      type: 'skill',
      source: 'space',
      workDir: '/tmp/work-b',
      namespace: '-',
      name: 'draft'
    })

    expect(() => setResourceSceneOverride(resourceKey, [])).toThrowError(/known scene tag/i)
    expect(() => setResourceSceneOverride(resourceKey, ['unknown-tag'])).toThrowError(/known scene tag/i)
  })

  it('rejects removing builtin definitions and invalid keys', () => {
    adminEnabled = true
    expect(() => removeSceneDefinition('office')).toThrowError(/builtin/i)

    expect(() => upsertSceneDefinition({
      key: 'Marketing',
      label: { en: 'Marketing', zhCN: '营销', zhTW: '行銷' },
      colorToken: 'pink',
      order: 60,
      enabled: true,
      builtin: false
    })).toThrowError(/kebab-case/i)
  })

  it('keeps space scope isolated in resource keys', () => {
    const keyA = buildResourceSceneKey({
      type: 'agent',
      source: 'space',
      workDir: '/tmp/space-a',
      namespace: '-',
      name: 'planner'
    })
    const keyB = buildResourceSceneKey({
      type: 'agent',
      source: 'space',
      workDir: '/tmp/space-b',
      namespace: '-',
      name: 'planner'
    })

    expect(keyA).not.toBe(keyB)
    expect(keyA.split(':')[2]).not.toBe('-')
  })

  it('imports and exports with merge and replace mode', () => {
    adminEnabled = true
    importSceneTaxonomy({
      version: 1,
      definitions: [
        {
          key: 'marketing',
          label: { en: 'Marketing', zhCN: '营销', zhTW: '行銷' },
          colorToken: 'pink',
          order: 60,
          enabled: true,
          builtin: false
        }
      ],
      resourceOverrides: {},
      deletedDefinitionKeys: [],
      deletedOverrideKeys: [],
      updatedAt: new Date().toISOString()
    }, 'merge')

    let exported = exportSceneTaxonomy()
    expect(exported.definitions.some((item) => item.key === 'marketing')).toBe(true)

    importSceneTaxonomy({
      version: 1,
      definitions: [],
      resourceOverrides: {},
      deletedDefinitionKeys: ['marketing'],
      deletedOverrideKeys: [],
      updatedAt: new Date().toISOString()
    }, 'replace')

    exported = exportSceneTaxonomy()
    expect(exported.definitions.some((item) => item.key === 'marketing')).toBe(false)
  })

  it('restores tombstoned definitions when merge import includes that definition again', () => {
    adminEnabled = true
    const marketingDefinition = {
      key: 'marketing',
      label: { en: 'Marketing', zhCN: '营销', zhTW: '行銷' },
      colorToken: 'pink' as const,
      order: 60,
      enabled: true,
      builtin: false
    }

    upsertSceneDefinition(marketingDefinition)
    removeSceneDefinition('marketing')

    importSceneTaxonomy({
      version: 1,
      definitions: [marketingDefinition],
      resourceOverrides: {},
      deletedDefinitionKeys: [],
      deletedOverrideKeys: [],
      updatedAt: new Date().toISOString()
    }, 'merge')

    const exported = exportSceneTaxonomy()
    expect(exported.definitions.some((item) => item.key === 'marketing')).toBe(true)
    expect(exported.deletedDefinitionKeys).not.toContain('marketing')
  })

  it('restores tombstoned overrides when merge import includes that override again', () => {
    adminEnabled = true
    const resourceKey = buildResourceSceneKey({
      type: 'agent',
      source: 'space',
      workDir: '/tmp/work-c',
      namespace: '-',
      name: 'planner'
    })

    setResourceSceneOverride(resourceKey, ['coding'])
    removeResourceSceneOverride(resourceKey)

    importSceneTaxonomy({
      version: 1,
      definitions: [],
      resourceOverrides: {
        [resourceKey]: ['writing']
      },
      deletedDefinitionKeys: [],
      deletedOverrideKeys: [],
      updatedAt: new Date().toISOString()
    }, 'merge')

    const exported = exportSceneTaxonomy()
    expect(exported.resourceOverrides[resourceKey]).toEqual(['writing'])
    expect(exported.deletedOverrideKeys).not.toContain(resourceKey)
  })
})
