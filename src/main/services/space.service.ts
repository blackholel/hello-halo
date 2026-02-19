/**
 * Space Service - Manages workspaces/spaces
 */

import { shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs'
import { getKiteDir, getTempSpacePath, getSpacesDir } from './config.service'
import { updateSpaceConfig } from './space-config.service'
import { v4 as uuidv4 } from 'uuid'
import { isPathWithinBasePaths } from '../utils/path-validation'
import { ensureSpaceResourcePolicy } from './agent/space-resource-policy.service'
import type { ResourceRef } from './resource-ref.service'

interface Space {
  id: string
  name: string
  icon: string
  path: string
  isTemp: boolean
  createdAt: string
  updatedAt: string
  stats: {
    artifactCount: number
    conversationCount: number
  }
  preferences?: SpacePreferences
}

// Layout preferences for a space
interface SpaceLayoutPreferences {
  artifactRailExpanded?: boolean
  chatWidth?: number
}

// Skills preferences for a space
interface SpaceSkillsPreferences {
  favorites?: string[]
  enabled?: string[]
  showOnlyEnabled?: boolean
}

// Agents preferences for a space
interface SpaceAgentsPreferences {
  enabled?: string[]
  showOnlyEnabled?: boolean
}

// All space preferences
interface SpacePreferences {
  layout?: SpaceLayoutPreferences
  skills?: SpaceSkillsPreferences
  agents?: SpaceAgentsPreferences
}

interface SpaceMeta {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  preferences?: SpacePreferences
}

// Space index for tracking custom path spaces
interface SpaceIndex {
  customPaths: string[]  // Array of paths to spaces outside ~/.kite/spaces/
}

function getSpaceIndexPath(): string {
  return join(getKiteDir(), 'spaces-index.json')
}

function loadSpaceIndex(): SpaceIndex {
  const indexPath = getSpaceIndexPath()
  if (existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8'))
    } catch {
      return { customPaths: [] }
    }
  }
  return { customPaths: [] }
}

function saveSpaceIndex(index: SpaceIndex): void {
  const indexPath = getSpaceIndexPath()
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
}

function addToSpaceIndex(path: string): void {
  const index = loadSpaceIndex()
  if (!index.customPaths.includes(path)) {
    index.customPaths.push(path)
    saveSpaceIndex(index)
  }
}

function removeFromSpaceIndex(path: string): void {
  const index = loadSpaceIndex()
  index.customPaths = index.customPaths.filter(p => p !== path)
  saveSpaceIndex(index)
}

const KITE_SPACE: Space = {
  id: 'kite-temp',
  name: 'Kite',
  icon: 'sparkles',  // Maps to Lucide Sparkles icon
  path: '',
  isTemp: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stats: {
    artifactCount: 0,
    conversationCount: 0
  }
}

// Get all valid space paths (for security checks)
export function getAllSpacePaths(): string[] {
  const paths: string[] = []
  const loadedPaths = new Set<string>()

  // Add temp space path
  const tempSpacePath = getTempSpacePath()
  paths.push(tempSpacePath)
  loadedPaths.add(tempSpacePath)

  // Add valid spaces from default roots (including legacy root for backward compatibility)
  const defaultSpaces = loadSpacesFromRoots(getDefaultSpaceRoots())
  for (const space of defaultSpaces) {
    if (!loadedPaths.has(space.path)) {
      paths.push(space.path)
      loadedPaths.add(space.path)
    }
  }

  // Add valid custom path spaces from index
  const index = loadSpaceIndex()
  for (const customPath of index.customPaths) {
    if (!existsSync(customPath) || loadedPaths.has(customPath)) {
      continue
    }

    const space = loadSpaceFromPath(customPath)
    if (space) {
      paths.push(customPath)
      loadedPaths.add(customPath)
    }
  }

  return paths
}

// Get space stats
function getSpaceStats(spacePath: string): { artifactCount: number; conversationCount: number } {
  const artifactsDir = join(spacePath, 'artifacts')
  const conversationsDir = join(spacePath, '.kite', 'conversations')

  let artifactCount = 0
  let conversationCount = 0

  // Count artifacts (all files in artifacts folder)
  if (existsSync(artifactsDir)) {
    const countFiles = (dir: string): number => {
      let count = 0
      const items = readdirSync(dir)
      for (const item of items) {
        const itemPath = join(dir, item)
        const stat = statSync(itemPath)
        if (stat.isFile() && !item.startsWith('.')) {
          count++
        } else if (stat.isDirectory()) {
          count += countFiles(itemPath)
        }
      }
      return count
    }
    artifactCount = countFiles(artifactsDir)
  }

  // For temp space, artifacts are directly in the folder
  if (spacePath === getTempSpacePath()) {
    const tempArtifactsDir = join(spacePath, 'artifacts')
    if (existsSync(tempArtifactsDir)) {
      artifactCount = readdirSync(tempArtifactsDir).filter(f => !f.startsWith('.')).length
    }
  }

  // Count conversations
  if (existsSync(conversationsDir)) {
    conversationCount = readdirSync(conversationsDir).filter(f => f.endsWith('.json')).length
  } else {
    // For temp space
    const tempConvDir = join(spacePath, 'conversations')
    if (existsSync(tempConvDir)) {
      conversationCount = readdirSync(tempConvDir).filter(f => f.endsWith('.json')).length
    }
  }

  return { artifactCount, conversationCount }
}

// Get Kite temp space
export function getKiteSpace(): Space {
  const tempPath = getTempSpacePath()
  const stats = getSpaceStats(tempPath)

  // Load preferences if they exist
  const metaPath = join(tempPath, '.kite', 'meta.json')
  let preferences: SpacePreferences | undefined

  if (existsSync(metaPath)) {
    try {
      const meta: SpaceMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      preferences = meta.preferences
    } catch {
      // Ignore parse errors
    }
  }

  return {
    ...KITE_SPACE,
    path: tempPath,
    stats,
    preferences
  }
}

// Helper to load a space from a path
function loadSpaceFromPath(spacePath: string): Space | null {
  // Deliberate policy: only .kite metadata is recognized.
  // Legacy .halo/meta.json is intentionally ignored (no compatibility fallback).
  const metaPath = join(spacePath, '.kite', 'meta.json')

  if (existsSync(metaPath)) {
    try {
      const meta: SpaceMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      const stats = getSpaceStats(spacePath)
      runSpaceResourceMigration(spacePath)

      return {
        id: meta.id,
        name: meta.name,
        icon: meta.icon,
        path: spacePath,
        isTemp: false,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        stats,
        preferences: meta.preferences
      }
    } catch (error) {
      console.error(`Failed to read space meta for ${spacePath}:`, error)
    }
  }
  return null
}

function migrateToolkitRefToSpace(workDir: string, ref: ResourceRef): void {
  try {
    const { copySkillToSpaceByRef } = require('./skills.service') as typeof import('./skills.service')
    const { copyAgentToSpaceByRef } = require('./agents.service') as typeof import('./agents.service')
    const { copyCommandToSpaceByRef } = require('./commands.service') as typeof import('./commands.service')

    if (ref.type === 'skill') {
      copySkillToSpaceByRef(ref, workDir)
      return
    }
    if (ref.type === 'agent') {
      copyAgentToSpaceByRef(ref, workDir)
      return
    }
    if (ref.type === 'command') {
      copyCommandToSpaceByRef(ref, workDir)
    }
  } catch (error) {
    console.warn('[Space] Failed to migrate toolkit resource to space:', ref, error)
  }
}

function runSpaceResourceMigration(workDir: string): void {
  try {
    ensureSpaceResourcePolicy(workDir)
    const spaceConfig = getSpaceConfig(workDir)
    const toolkit = spaceConfig?.toolkit
    if (!toolkit) return

    const refs: ResourceRef[] = [
      ...toolkit.skills.map((ref) => ({ ...ref, type: 'skill' as const })),
      ...toolkit.agents.map((ref) => ({ ...ref, type: 'agent' as const })),
      ...toolkit.commands.map((ref) => ({ ...ref, type: 'command' as const }))
    ]

    refs
      .filter((ref) => ref.source && ref.source !== 'space')
      .forEach((ref) => migrateToolkitRefToSpace(workDir, ref))
  } catch (error) {
    console.warn('[Space] Failed to run resource migration:', error)
  }
}

// List all spaces (including custom path spaces)
export function listSpaces(): Space[] {
  const spaces = loadSpacesFromRoots(getDefaultSpaceRoots())
  const loadedPaths = new Set<string>()
  spaces.forEach(space => loadedPaths.add(space.path))

  // Load spaces from custom paths (indexed)
  const index = loadSpaceIndex()
  for (const customPath of index.customPaths) {
    if (!loadedPaths.has(customPath) && existsSync(customPath)) {
      const space = loadSpaceFromPath(customPath)
      if (space) {
        spaces.push(space)
        loadedPaths.add(customPath)
      }
    }
  }

  // Sort by updatedAt (most recent first)
  spaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return spaces
}

// Create a new space
export function createSpace(input: { name: string; icon: string; customPath?: string }): Space {
  const id = uuidv4()
  const now = new Date().toISOString()
  const isCustomPath = !!input.customPath

  // Determine space path
  let spacePath: string
  if (input.customPath) {
    spacePath = input.customPath
  } else {
    spacePath = resolveDefaultSpacePath(input.name)
  }

  // Create directories
  mkdirSync(spacePath, { recursive: true })
  mkdirSync(join(spacePath, '.kite'), { recursive: true })
  mkdirSync(join(spacePath, '.kite', 'conversations'), { recursive: true })

  // Create meta file
  const meta: SpaceMeta = {
    id,
    name: input.name,
    icon: input.icon,
    createdAt: now,
    updatedAt: now
  }

  writeFileSync(join(spacePath, '.kite', 'meta.json'), JSON.stringify(meta, null, 2))

  // Initialize empty toolkit for space isolation (whitelist mode)
  // Uses updateSpaceConfig to merge safely — preserves existing claudeCode config
  // when customPath points to a directory that already has space-config.json
  const initResult = updateSpaceConfig(spacePath, (config) => ({
    ...config,
    toolkit: config.toolkit ?? { skills: [], commands: [], agents: [] },
    resourcePolicy: {
      version: 1,
      mode: 'strict-space-only',
      allowHooks: false,
      allowMcp: false,
      allowPluginMcpDirective: false,
      allowedSources: ['space']
    }
  }))

  if (!initResult) {
    console.error(`[Space] Failed to initialize toolkit for space: ${spacePath}`)
  }

  // Register custom path in index
  if (isCustomPath) {
    addToSpaceIndex(spacePath)
  }

  return {
    id,
    name: input.name,
    icon: input.icon,
    path: spacePath,
    isTemp: false,
    createdAt: now,
    updatedAt: now,
    stats: {
      artifactCount: 0,
      conversationCount: 0
    }
  }
}

// Delete a space
export function deleteSpace(spaceId: string): boolean {
  // Find the space first
  const space = getSpace(spaceId)
  if (!space || space.isTemp) {
    return false
  }

  const spacePath = space.path
  const isCustomPath = !isInDefaultSpacesRoot(spacePath)

  try {
    if (isCustomPath) {
      // For custom path spaces, only delete the .kite folder (preserve user's files)
      const kiteDir = join(spacePath, '.kite')
      if (existsSync(kiteDir)) {
        rmSync(kiteDir, { recursive: true, force: true })
      }
      // Remove from index
      removeFromSpaceIndex(spacePath)
    } else {
      // For default path spaces, delete the entire folder
      rmSync(spacePath, { recursive: true, force: true })
    }
    return true
  } catch (error) {
    console.error(`Failed to delete space ${spaceId}:`, error)
    return false
  }
}

// Get a specific space by ID
export function getSpace(spaceId: string): Space | null {
  if (spaceId === 'kite-temp') {
    return getKiteSpace()
  }

  const spaces = listSpaces()
  return spaces.find(s => s.id === spaceId) || null
}

// Open space folder in file explorer
export function openSpaceFolder(spaceId: string): boolean {
  const space = getSpace(spaceId)

  if (space) {
    // For temp space, open artifacts folder
    if (space.isTemp) {
      const artifactsPath = join(space.path, 'artifacts')
      if (existsSync(artifactsPath)) {
        shell.openPath(artifactsPath)
        return true
      }
    } else {
      shell.openPath(space.path)
      return true
    }
  }

  return false
}

// Update space metadata
export function updateSpace(spaceId: string, updates: { name?: string; icon?: string }): Space | null {
  const space = getSpace(spaceId)

  if (!space || space.isTemp) {
    return null
  }

  const metaPath = join(space.path, '.kite', 'meta.json')

  try {
    const meta: SpaceMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))

    if (updates.name) meta.name = updates.name
    if (updates.icon) meta.icon = updates.icon
    meta.updatedAt = new Date().toISOString()

    writeFileSync(metaPath, JSON.stringify(meta, null, 2))

    return getSpace(spaceId)
  } catch (error) {
    console.error('Failed to update space:', error)
    return null
  }
}

// Update space preferences (layout settings, etc.)
export function updateSpacePreferences(
  spaceId: string,
  preferences: Partial<SpacePreferences>
): Space | null {
  const space = getSpace(spaceId)

  if (!space) {
    return null
  }

  // For temp space, store preferences in a special location
  const metaPath = space.isTemp
    ? join(space.path, '.kite', 'meta.json')
    : join(space.path, '.kite', 'meta.json')

  try {
    // Ensure .kite directory exists for temp space
    const kiteDir = join(space.path, '.kite')
    if (!existsSync(kiteDir)) {
      mkdirSync(kiteDir, { recursive: true })
    }

    // Load or create meta
    let meta: SpaceMeta
    if (existsSync(metaPath)) {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    } else {
      // Create new meta for temp space
      meta = {
        id: space.id,
        name: space.name,
        icon: space.icon,
        createdAt: space.createdAt,
        updatedAt: new Date().toISOString()
      }
    }

    // Deep merge preferences
    meta.preferences = meta.preferences || {}

    if (preferences.layout) {
      meta.preferences.layout = {
        ...meta.preferences.layout,
        ...preferences.layout
      }
    }

    if (preferences.skills) {
      meta.preferences.skills = {
        ...meta.preferences.skills,
        ...preferences.skills
      }
    }

    if (preferences.agents) {
      meta.preferences.agents = {
        ...meta.preferences.agents,
        ...preferences.agents
      }
    }

    meta.updatedAt = new Date().toISOString()

    writeFileSync(metaPath, JSON.stringify(meta, null, 2))

    console.log(`[Space] Updated preferences for ${spaceId}:`, preferences)

    return getSpace(spaceId)
  } catch (error) {
    console.error('Failed to update space preferences:', error)
    return null
  }
}

// Get space preferences only (lightweight, without full space load)
export function getSpacePreferences(spaceId: string): SpacePreferences | null {
  const space = getSpace(spaceId)

  if (!space) {
    return null
  }

  const metaPath = join(space.path, '.kite', 'meta.json')

  try {
    if (existsSync(metaPath)) {
      const meta: SpaceMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      return meta.preferences || null
    }
    return null
  } catch (error) {
    console.error('Failed to get space preferences:', error)
    return null
  }
}

// Write onboarding artifact - saves a file to the space's artifacts folder
export function writeOnboardingArtifact(spaceId: string, fileName: string, content: string): boolean {
  const space = getSpace(spaceId)
  if (!space) {
    console.error(`[Space] writeOnboardingArtifact: Space not found: ${spaceId}`)
    return false
  }

  try {
    // Determine artifacts directory based on space type
    const artifactsDir = space.isTemp
      ? join(space.path, 'artifacts')
      : space.path  // For regular spaces, save to root

    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true })

    // Write the file
    const filePath = join(artifactsDir, fileName)
    writeFileSync(filePath, content, 'utf-8')

    console.log(`[Space] writeOnboardingArtifact: Saved ${fileName} to ${filePath}`)
    return true
  } catch (error) {
    console.error(`[Space] writeOnboardingArtifact failed:`, error)
    return false
  }
}

// Save onboarding conversation - creates a conversation with the mock messages
export function saveOnboardingConversation(
  spaceId: string,
  userMessage: string,
  aiResponse: string
): string | null {
  const space = getSpace(spaceId)
  if (!space) {
    console.error(`[Space] saveOnboardingConversation: Space not found: ${spaceId}`)
    return null
  }

  try {
    const { v4: uuidv4 } = require('uuid')
    const conversationId = uuidv4()
    const now = new Date().toISOString()

    // Determine conversations directory
    const conversationsDir = space.isTemp
      ? join(space.path, 'conversations')
      : join(space.path, '.kite', 'conversations')

    // Ensure directory exists
    mkdirSync(conversationsDir, { recursive: true })

    // Create conversation data
    const conversation = {
      id: conversationId,
      title: 'Welcome to Kite',
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: uuidv4(),
          role: 'user',
          content: userMessage,
          timestamp: now
        },
        {
          id: uuidv4(),
          role: 'assistant',
          content: aiResponse,
          timestamp: now
        }
      ]
    }

    // Write conversation file
    const filePath = join(conversationsDir, `${conversationId}.json`)
    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8')

    console.log(`[Space] saveOnboardingConversation: Saved to ${filePath}`)
    return conversationId
  } catch (error) {
    console.error(`[Space] saveOnboardingConversation failed:`, error)
    return null
  }
}
