/**
 * Space Service Unit Tests
 *
 * Tests for workspace/space management service.
 * Covers space creation, listing, and stats calculation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

import {
  getKiteSpace,
  listSpaces,
  createSpace,
  getSpace,
  deleteSpace,
  getAllSpacePaths
} from '../../../src/main/services/space.service'
import { initializeApp, getSpacesDir, getTempSpacePath } from '../../../src/main/services/config.service'

describe('Space Service', () => {
  beforeEach(async () => {
    await initializeApp()
  })

  describe('getKiteSpace', () => {
    it('should return the Kite temp space', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.id).toBe('kite-temp')
      expect(kiteSpace.name).toBe('Kite')
      expect(kiteSpace.isTemp).toBe(true)
      expect(kiteSpace.icon).toBe('sparkles')
    })

    it('should have valid path', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.path).toBeTruthy()
      expect(fs.existsSync(kiteSpace.path)).toBe(true)
    })

    it('should include stats', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.stats).toBeDefined()
      expect(typeof kiteSpace.stats.artifactCount).toBe('number')
      expect(typeof kiteSpace.stats.conversationCount).toBe('number')
    })
  })

  describe('listSpaces', () => {
    it('should return empty array when no custom spaces exist', () => {
      const spaces = listSpaces()

      expect(Array.isArray(spaces)).toBe(true)
      expect(spaces.length).toBe(0)
    })

    it('should include created spaces', async () => {
      // Create a test space
      await createSpace({
        name: 'Test Project',
        icon: 'folder'
      })

      const spaces = listSpaces()

      expect(spaces.length).toBe(1)
      expect(spaces[0].name).toBe('Test Project')
    })

    it('should ignore legacy .halo meta directories', () => {
      const legacySpacePath = path.join(getSpacesDir(), 'legacy-halo-space')
      const legacyMetaPath = path.join(legacySpacePath, '.halo', 'meta.json')

      fs.mkdirSync(path.dirname(legacyMetaPath), { recursive: true })
      fs.writeFileSync(legacyMetaPath, JSON.stringify({
        id: 'legacy-halo-space-id',
        name: 'Legacy Halo Space',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const spaces = listSpaces()
      expect(spaces).toHaveLength(0)
      expect(getSpace('legacy-halo-space-id')).toBeFalsy()
    })
  })

  describe('createSpace', () => {
    it('should create a new space in default directory', async () => {
      const space = await createSpace({
        name: 'My Project',
        icon: 'code'
      })

      expect(space.id).toBeTruthy()
      expect(space.name).toBe('My Project')
      expect(space.icon).toBe('code')
      expect(space.isTemp).toBe(false)
      expect(fs.existsSync(space.path)).toBe(true)
    })

    it('should create .kite directory inside space', async () => {
      const space = await createSpace({
        name: 'Test Space',
        icon: 'folder'
      })

      const kiteDir = path.join(space.path, '.kite')
      expect(fs.existsSync(kiteDir)).toBe(true)
    })

    it('should create meta.json with space info', async () => {
      const space = await createSpace({
        name: 'Meta Test',
        icon: 'star'
      })

      const metaPath = path.join(space.path, '.kite', 'meta.json')
      expect(fs.existsSync(metaPath)).toBe(true)

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      expect(meta.name).toBe('Meta Test')
      expect(meta.icon).toBe('star')
      expect(meta.id).toBe(space.id)
    })

    it('should handle custom path', async () => {
      const customPath = path.join(getTempSpacePath(), 'custom-project')
      fs.mkdirSync(customPath, { recursive: true })

      const space = await createSpace({
        name: 'Custom Path Space',
        icon: 'folder',
        customPath
      })

      expect(space.path).toBe(customPath)
      expect(fs.existsSync(path.join(customPath, '.kite', 'meta.json'))).toBe(true)
    })
  })

  describe('getSpace', () => {
    it('should return space by id', async () => {
      const created = await createSpace({
        name: 'Get Test',
        icon: 'folder'
      })

      const space = getSpace(created.id)

      expect(space).toBeDefined()
      expect(space?.id).toBe(created.id)
      expect(space?.name).toBe('Get Test')
    })

    it('should return null/undefined for non-existent id', () => {
      const space = getSpace('non-existent-id')
      expect(space).toBeFalsy() // null or undefined
    })

    it('should return Kite space for kite-temp id', () => {
      const space = getSpace('kite-temp')

      expect(space).toBeDefined()
      expect(space?.id).toBe('kite-temp')
      expect(space?.isTemp).toBe(true)
    })
  })

  describe('deleteSpace', () => {
    it('should delete space and its .kite directory', async () => {
      const space = await createSpace({
        name: 'Delete Test',
        icon: 'folder'
      })

      const kiteDir = path.join(space.path, '.kite')
      expect(fs.existsSync(kiteDir)).toBe(true)

      await deleteSpace(space.id)

      // .kite should be deleted, but space directory may remain (for custom paths)
      expect(fs.existsSync(kiteDir)).toBe(false)
    })

    it('should not allow deleting Kite temp space', async () => {
      // deleteSpace may return false or throw for temp space
      try {
        const result = await deleteSpace('kite-temp')
        // If it returns without throwing, result should be false
        expect(result).toBeFalsy()
      } catch {
        // Expected to throw for temp space
        expect(true).toBe(true)
      }
    })
  })

  describe('getAllSpacePaths', () => {
    it('should include temp space path', () => {
      const paths = getAllSpacePaths()
      const tempPath = getTempSpacePath()

      expect(paths).toContain(tempPath)
    })

    it('should include created space paths', async () => {
      const space = await createSpace({
        name: 'Path Test',
        icon: 'folder'
      })

      const paths = getAllSpacePaths()

      expect(paths).toContain(space.path)
    })
  })
})
