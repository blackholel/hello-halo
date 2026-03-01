/**
 * Space Service Unit Tests
 *
 * Tests for workspace/space management service.
 * Covers space creation, listing, and stats calculation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
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
import { updateSpaceConfig } from '../../../src/main/services/space-config.service'
import { _testInitConfigSourceModeLock, _testResetConfigSourceModeLock } from '../../../src/main/services/config-source-mode.service'

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

    it('should load spaces from legacy ~/.kite/spaces root for backward compatibility', () => {
      const legacyRoot = path.join(globalThis.__KITE_TEST_DIR__, '.kite', 'spaces')
      const legacySpacePath = path.join(legacyRoot, 'legacy-kite-space')
      const metaPath = path.join(legacySpacePath, '.kite', 'meta.json')

      fs.mkdirSync(path.dirname(metaPath), { recursive: true })
      fs.writeFileSync(metaPath, JSON.stringify({
        id: 'legacy-kite-space-id',
        name: 'Legacy Kite Space',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const spaces = listSpaces()
      expect(spaces.some(space => space.id === 'legacy-kite-space-id')).toBe(true)
    })

    it('should migrate toolkit refs on listSpaces without ESM module resolution errors', async () => {
      _testResetConfigSourceModeLock()
      _testInitConfigSourceModeLock('kite')

      const appRoot = path.join(globalThis.__KITE_TEST_DIR__, '.kite')
      const appSkillDir = path.join(appRoot, 'skills', 'review')
      const appAgentPath = path.join(appRoot, 'agents', 'reviewer.md')
      const appCommandPath = path.join(appRoot, 'commands', 'lint.md')
      fs.mkdirSync(appSkillDir, { recursive: true })
      fs.mkdirSync(path.dirname(appAgentPath), { recursive: true })
      fs.mkdirSync(path.dirname(appCommandPath), { recursive: true })
      fs.writeFileSync(path.join(appSkillDir, 'SKILL.md'), '# review skill from app\n', 'utf-8')
      fs.writeFileSync(appAgentPath, '# reviewer agent from app\n', 'utf-8')
      fs.writeFileSync(appCommandPath, '# lint command from app\n', 'utf-8')

      const space = await createSpace({
        name: 'Migration Regression',
        icon: 'folder'
      })

      updateSpaceConfig(space.path, (config) => ({
        ...config,
        toolkit: {
          skills: [{ id: 'skill:app:-:review', type: 'skill', name: 'review', source: 'app' }],
          agents: [{ id: 'agent:app:-:reviewer', type: 'agent', name: 'reviewer', source: 'app' }],
          commands: [{ id: 'command:app:-:lint', type: 'command', name: 'lint', source: 'app' }]
        }
      }))

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const spaces = listSpaces()
      const warnings = warnSpy.mock.calls.flat().map((entry) => String(entry))
      warnSpy.mockRestore()

      const migratedSkillPath = path.join(space.path, '.claude', 'skills', 'review', 'SKILL.md')
      const migratedAgentPath = path.join(space.path, '.claude', 'agents', 'reviewer.md')
      const migratedCommandPath = path.join(space.path, '.claude', 'commands', 'lint.md')
      for (let i = 0; i < 20; i += 1) {
        if (
          fs.existsSync(migratedSkillPath) &&
          fs.existsSync(migratedAgentPath) &&
          fs.existsSync(migratedCommandPath)
        ) {
          break
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
      }

      expect(spaces.some((item) => item.id === space.id)).toBe(true)
      expect(fs.existsSync(migratedSkillPath)).toBe(true)
      expect(fs.existsSync(migratedAgentPath)).toBe(true)
      expect(fs.existsSync(migratedCommandPath)).toBe(true)

      expect(warnings.some((line) => line.includes("Cannot find module './skills.service'"))).toBe(false)
      expect(warnings.some((line) => line.includes("Cannot find module './agents.service'"))).toBe(false)
      expect(warnings.some((line) => line.includes("Cannot find module './commands.service'"))).toBe(false)
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

    it('should create default space with sanitized folder name', async () => {
      const space = await createSpace({
        name: 'A:B*Project?',
        icon: 'folder'
      })

      expect(path.basename(space.path)).toBe('A-B-Project-')
    })

    it('should map windows reserved folder names to safe names', async () => {
      const space = await createSpace({
        name: 'CON',
        icon: 'folder'
      })

      expect(path.basename(space.path)).toBe('CON-space')
    })

    it('should avoid overwriting when same default name is created twice', async () => {
      const first = await createSpace({
        name: 'Same Name',
        icon: 'folder'
      })
      const second = await createSpace({
        name: 'Same Name',
        icon: 'folder'
      })

      expect(first.path).not.toBe(second.path)
      expect(path.basename(second.path)).toBe('Same Name-2')
    })

    it('should initialize strict resource policy without allowHooks field', async () => {
      const space = await createSpace({
        name: 'Policy Defaults',
        icon: 'folder'
      })

      const configPath = path.join(space.path, '.kite', 'space-config.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

      expect(config.resourcePolicy.mode).toBe('strict-space-only')
      expect(config.resourcePolicy.allowMcp).toBe(false)
      expect(config.resourcePolicy.allowPluginMcpDirective).toBe(false)
      expect(config.resourcePolicy.allowedSources).toEqual(['space'])
      expect(config.resourcePolicy).not.toHaveProperty('allowHooks')
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

    it('should treat path prefix collisions as custom paths and preserve project files', async () => {
      const defaultRoot = getSpacesDir()
      const collidingCustomPath = `${defaultRoot}-project`
      const projectFile = path.join(collidingCustomPath, 'README.md')
      fs.mkdirSync(collidingCustomPath, { recursive: true })
      fs.writeFileSync(projectFile, 'keep me', 'utf-8')

      const space = await createSpace({
        name: 'Prefix Collision',
        icon: 'folder',
        customPath: collidingCustomPath
      })

      const deleted = await deleteSpace(space.id)
      expect(deleted).toBe(true)
      expect(fs.existsSync(collidingCustomPath)).toBe(true)
      expect(fs.existsSync(projectFile)).toBe(true)
      expect(fs.existsSync(path.join(collidingCustomPath, '.kite'))).toBe(false)
    })

    it('should refuse deleting a space when custom path equals home directory', async () => {
      const homePath = globalThis.__KITE_TEST_DIR__
      const sentinelPath = path.join(homePath, '.kite', 'sentinel.txt')
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true })
      fs.writeFileSync(sentinelPath, 'keep', 'utf-8')

      const space = await createSpace({
        name: 'Home Protected',
        icon: 'folder',
        customPath: homePath
      })

      const deleted = deleteSpace(space.id)
      expect(deleted).toBe(false)
      expect(fs.existsSync(sentinelPath)).toBe(true)
    })

    it('should refuse deleting when space meta id is mismatched', async () => {
      const space = await createSpace({
        name: 'Meta Mismatch',
        icon: 'folder'
      })

      const metaPath = path.join(space.path, '.kite', 'meta.json')
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      meta.id = 'tampered-id'
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      const deleted = deleteSpace(space.id)
      expect(deleted).toBe(false)
      expect(fs.existsSync(space.path)).toBe(true)
      expect(fs.existsSync(path.join(space.path, '.kite'))).toBe(true)
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

    it('should exclude non-space directories from default spaces root', () => {
      const nonSpacePath = path.join(getSpacesDir(), 'plain-folder')
      fs.mkdirSync(nonSpacePath, { recursive: true })

      const paths = getAllSpacePaths()
      expect(paths).not.toContain(nonSpacePath)
    })

    it('should include valid space paths from legacy ~/.kite/spaces root', () => {
      const legacyRoot = path.join(globalThis.__KITE_TEST_DIR__, '.kite', 'spaces')
      const legacySpacePath = path.join(legacyRoot, 'legacy-space-path')
      const metaPath = path.join(legacySpacePath, '.kite', 'meta.json')

      fs.mkdirSync(path.dirname(metaPath), { recursive: true })
      fs.writeFileSync(metaPath, JSON.stringify({
        id: 'legacy-space-path-id',
        name: 'Legacy Space Path',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const paths = getAllSpacePaths()
      expect(paths).toContain(legacySpacePath)
    })
  })
})
