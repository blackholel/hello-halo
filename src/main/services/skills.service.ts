/**
 * Skills Service - Manages Claude Code skills configuration
 *
 * Skills are loaded from multiple sources:
 * 1. ~/.halo/skills/ - Default app-level skills directory
 * 2. config.claudeCode.plugins.globalPaths - Custom global paths (skills/ subdirectory)
 * 3. Installed plugins - Skills from installed plugins
 * 4. {workDir}/.claude/skills/ - Space-level skills (Claude Code compatible)
 *
 * Each skill is a directory containing a SKILL.md file with frontmatter metadata.
 */

import { join, dirname } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getConfig, getHaloDir } from './config.service'
import { listEnabledPlugins } from './plugins.service'
import { getAllSpacePaths } from './space.service'
import { isPathWithinBasePaths, isValidDirectoryPath } from '../utils/path-validation'

// ============================================
// Skill Types
// ============================================

export interface SkillDefinition {
  name: string                              // Directory name
  path: string                              // Full path to skill directory
  source: 'app' | 'global' | 'space' | 'installed'  // Where the skill was loaded from
  description?: string                      // Description from frontmatter
  triggers?: string[]                       // Trigger patterns from frontmatter
  category?: string                         // Category from frontmatter
  pluginRoot?: string                       // Plugin root path (for installed skills)
  namespace?: string                        // Plugin namespace
}

export interface SkillContent {
  name: string
  content: string                           // Full SKILL.md content
  frontmatter?: Record<string, unknown>     // Parsed frontmatter
}

// Cache for skills list (in-memory only)
let globalSkillsCache: SkillDefinition[] | null = null
const spaceSkillsCache = new Map<string, SkillDefinition[]>()

// ============================================
// Frontmatter Parsing
// ============================================

/**
 * Parse YAML frontmatter from skill content
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null

  const frontmatterStr = frontmatterMatch[1]
  const result: Record<string, unknown> = {}

  // Simple YAML parsing for common fields
  const lines = frontmatterStr.split('\n')
  let currentKey: string | null = null
  let currentArray: string[] | null = null

  for (const line of lines) {
    // Check for array item
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && currentArray) {
        const value = line.replace(/^\s+-\s+/, '').trim()
        currentArray.push(value)
      }
      continue
    }

    // Save previous array if exists
    if (currentKey && currentArray) {
      result[currentKey] = currentArray
      currentArray = null
      currentKey = null
    }

    // Check for key-value pair
    const kvMatch = line.match(/^(\w+):\s*(.*)$/)
    if (kvMatch) {
      const [, key, value] = kvMatch
      if (value.trim() === '') {
        // Start of array
        currentKey = key
        currentArray = []
      } else {
        result[key] = value.trim()
      }
    }
  }

  // Save final array if exists
  if (currentKey && currentArray) {
    result[currentKey] = currentArray
  }

  return result
}

// ============================================
// Directory Scanning
// ============================================

/**
 * Validate skill directory path
 */
function isValidSkillDir(dirPath: string): boolean {
  return isValidDirectoryPath(dirPath, 'Skills')
}

function getAllowedSkillBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'skills'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveWorkDirForSkillPath(skillMdPath: string): string | null {
  const normalizedPath = normalizePath(skillMdPath)
  const allowedBases = getAllowedSkillBaseDirs().map(normalizePath)
  for (const base of allowedBases) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

/**
 * Scan a directory for skill subdirectories (each containing SKILL.md)
 */
function scanSkillDir(
  dirPath: string,
  source: SkillDefinition['source'],
  pluginRoot?: string,
  namespace?: string
): SkillDefinition[] {
  const skills: SkillDefinition[] = []

  if (!isValidSkillDir(dirPath)) {
    return skills
  }

  try {
    const entries = readdirSync(dirPath)
    for (const entry of entries) {
      const skillPath = join(dirPath, entry)
      try {
        const stat = statSync(skillPath)
        if (!stat.isDirectory()) continue

        // Check for SKILL.md file
        const skillMdPath = join(skillPath, 'SKILL.md')
        if (!existsSync(skillMdPath)) continue

        // Read and parse SKILL.md for metadata
        let description: string | undefined
        let triggers: string[] | undefined
        let category: string | undefined

        try {
          const content = readFileSync(skillMdPath, 'utf-8')
          const frontmatter = parseFrontmatter(content)
          if (frontmatter) {
            description = frontmatter.description as string | undefined
            triggers = frontmatter.triggers as string[] | undefined
            category = frontmatter.category as string | undefined
          }
        } catch {
          // Ignore read errors for metadata
        }

        skills.push({
          name: entry,
          path: skillPath,
          source,
          description,
          triggers,
          category,
          ...(pluginRoot ? { pluginRoot } : {}),
          ...(namespace ? { namespace } : {})
        })
      } catch {
        // Skip entries that can't be stat'd
      }
    }
  } catch (error) {
    console.warn(`[Skills] Failed to scan directory ${dirPath}:`, error)
  }

  return skills
}

function mergeSkills(globalSkills: SkillDefinition[], spaceSkills: SkillDefinition[]): SkillDefinition[] {
  const merged = new Map<string, SkillDefinition>()
  const skillKey = (skill: SkillDefinition) =>
    skill.namespace ? `${skill.namespace}:${skill.name}` : skill.name

  for (const skill of globalSkills) {
    merged.set(skillKey(skill), skill)
  }
  for (const skill of spaceSkills) {
    merged.set(skillKey(skill), skill)
  }
  return Array.from(merged.values())
}

function buildGlobalSkills(): SkillDefinition[] {
  const skills: SkillDefinition[] = []
  const seenNames = new Set<string>()
  const config = getConfig()

  const addSkills = (newSkills: SkillDefinition[]) => {
    for (const skill of newSkills) {
      const key = skill.namespace ? `${skill.namespace}:${skill.name}` : skill.name
      if (seenNames.has(key)) {
        const idx = skills.findIndex(s => (s.namespace ? `${s.namespace}:${s.name}` : s.name) === key)
        if (idx >= 0) {
          skills.splice(idx, 1)
        }
      }
      skills.push(skill)
      seenNames.add(key)
    }
  }

  // 0. Enabled plugins - lowest priority
  const enabledPlugins = listEnabledPlugins()
  for (const plugin of enabledPlugins) {
    const skillsSubdir = join(plugin.installPath, 'skills')
    if (existsSync(skillsSubdir)) {
      addSkills(scanSkillDir(skillsSubdir, 'installed', plugin.installPath, plugin.name))
    }
  }

  // 1. App-level skills (~/.halo/skills/)
  const haloDir = getHaloDir()
  if (haloDir) {
    const appSkillsPath = join(haloDir, 'skills')
    addSkills(scanSkillDir(appSkillsPath, 'app'))
  }

  // 2. Global custom paths from config.claudeCode.plugins.globalPaths
  const globalPaths = config.claudeCode?.plugins?.globalPaths || []
  for (const globalPath of globalPaths) {
    const resolvedPath = globalPath.startsWith('/')
      ? globalPath
      : join(require('os').homedir(), globalPath)
    const skillsSubdir = join(resolvedPath, 'skills')
    if (existsSync(skillsSubdir)) {
      addSkills(scanSkillDir(skillsSubdir, 'global'))
    }
  }

  return skills
}

function buildSpaceSkills(workDir: string): SkillDefinition[] {
  const spaceSkillsPath = join(workDir, '.claude', 'skills')
  return scanSkillDir(spaceSkillsPath, 'space')
}

// ============================================
// Public API
// ============================================

/**
 * List all available skills from all sources
 *
 * @param workDir - Optional workspace directory for space-level skills
 * @returns Array of skill definitions
 */
export function listSkills(workDir?: string): SkillDefinition[] {
  const globalSkills = globalSkillsCache ?? buildGlobalSkills()
  if (!globalSkillsCache) {
    globalSkillsCache = globalSkills
  }

  if (!workDir) {
    if (globalSkills.length > 0) {
      console.log(
        `[Skills] Found ${globalSkills.length} skills: ${globalSkills
          .map(s => (s.namespace ? `${s.namespace}:${s.name}` : s.name))
          .join(', ')}`
      )
    }
    return globalSkills
  }

  let spaceSkills = spaceSkillsCache.get(workDir)
  if (!spaceSkills) {
    spaceSkills = buildSpaceSkills(workDir)
    spaceSkillsCache.set(workDir, spaceSkills)
  }

  const skills = mergeSkills(globalSkills, spaceSkills)
  if (skills.length > 0) {
    console.log(
      `[Skills] Found ${skills.length} skills: ${skills
        .map(s => (s.namespace ? `${s.namespace}:${s.name}` : s.name))
        .join(', ')}`
    )
  }

  return skills
}

/**
 * Get skill content by name
 *
 * @param name - Skill name (directory name)
 * @param workDir - Optional workspace directory for space-level skills
 * @returns Skill content with parsed frontmatter or null if not found
 */
export function getSkillContent(name: string, workDir?: string): SkillContent | null {
  const skills = listSkills(workDir)
  let skill: SkillDefinition | undefined

  if (name.includes(':')) {
    const [namespace, skillName] = name.split(':', 2)
    skill = skills.find(s => s.name === skillName && s.namespace === namespace)
  } else {
    skill = skills.find(s => s.name === name && !s.namespace)
    if (!skill) {
      skill = skills.find(s => s.name === name)
    }
  }

  if (!skill) {
    console.warn(`[Skills] Skill not found: ${name}`)
    return null
  }

  try {
    const skillMdPath = join(skill.path, 'SKILL.md')
    let content = readFileSync(skillMdPath, 'utf-8')
    if (skill.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, skill.pluginRoot)
    }
    const frontmatter = parseFrontmatter(content) || undefined

    return {
      name: skill.name,
      content,
      frontmatter
    }
  } catch (error) {
    console.error(`[Skills] Failed to read skill ${name}:`, error)
    return null
  }
}

/**
 * Create a new skill in the space directory
 *
 * @param workDir - Workspace directory
 * @param name - Skill name (will be used as directory name)
 * @param content - SKILL.md content
 * @returns Created skill definition or throws on error
 */
export function createSkill(workDir: string, name: string, content: string): SkillDefinition {
  // Validate skill name (no path traversal, no special chrs)
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`Invalid skill name: ${name}`)
  }

  const skillDir = join(workDir, '.claude', 'skills', name)
  const skillMdPath = join(skillDir, 'SKILL.md')

  // Create directory
  mkdirSync(skillDir, { recursive: true })

  // Write SKILL.md
  writeFileSync(skillMdPath, content, 'utf-8')

  // Clear cache for this space
  invalidateSkillsCache(workDir)

  // Parse frontmatter for return value
  const frontmatter = parseFrontmatter(content)

  return {
    name,
    path: skillDir,
    source: 'space',
    description: frontmatter?.description as string | undefined,
    triggers: frontmatter?.triggers as string[] | undefined,
    category: frontmatter?.category as string | undefined
  }
}

/**
 * Update an existing skill's content
 *
 * @param skillPath - Full path to the skill directory or SKILL.md file
 * @param content - New SKILL.md content
 * @returns true if successful, false otherwise
 */
export function updateSkill(skillPath: string, content: string): boolean {
  try {
    // Determine the SKILL.md path
    const skillMdPath = skillPath.endsWith('SKILL.md')
      ? skillPath
      : join(skillPath, 'SKILL.md')

    const allowedBases = getAllowedSkillBaseDirs()
    if (!isPathWithinBasePaths(skillMdPath, allowedBases)) {
      console.warn(`[Skills] Cannot update skill outside of space skills directory: ${skillPath}`)
      return false
    }

    if (!existsSync(skillMdPath)) {
      console.warn(`[Skills] Skill file not found: ${skillMdPath}`)
      return false
    }

    writeFileSync(skillMdPath, content, 'utf-8')
    const workDir = resolveWorkDirForSkillPath(skillMdPath)
    if (workDir) {
      invalidateSkillsCache(workDir)
    } else {
      clearSkillsCache()
    }
    return true
  } catch (error) {
    console.error(`[Skills] Failed to update skill:`, error)
    return false
  }
}

/**
 * Delete a skill
 *
 * @param skillPath - Full path to the skill directory
 * @returns true if successful, false otherwise
 */
export function deleteSkill(skillPath: string): boolean {
  try {
    // Security check: only allow deleting from known skill directories
    const normalizedPath = skillPath.replace(/\\/g, '/')

    // Must be in a skills directory
    if (!normalizedPath.includes('/skills/') && !normalizedPath.includes('/.claude/skills/')) {
      console.warn(`[Skills] Cannot delete skill outside of skills directory: ${skillPath}`)
      return false
    }

    if (!existsSync(skillPath)) {
      console.warn(`[Skills] Skill directory not found: ${skillPath}`)
      return false
    }

    rmSync(skillPath, { recursive: true, force: true })
    const workDir = resolveWorkDirForSkillPath(skillPath)
    if (workDir) {
      invalidateSkillsCache(workDir)
    } else {
      clearSkillsCache()
    }
    return true
  } catch (error) {
    console.error(`[Skills] Failed to delete skill:`, error)
    return false
  }
}

/**
 * Copy a skill to the space directory
 *
 * @param skillName - Name of the skill to copy
 * @param workDir - Target workspace directory
 * @returns New skill definition or null if source not found
 */
export function copySkillToSpace(skillName: string, workDir: string): SkillDefinition | null {
  const skills = listSkills(workDir)
  const sourceSkill = skills.find(s => s.name === skillName)

  if (!sourceSkill) {
    console.warn(`[Skills] Source skill not found: ${skillName}`)
    return null
  }

  // Don't copy if already in space
  if (sourceSkill.source === 'space') {
    console.warn(`[Skills] Skill is already in space: ${skillName}`)
    return sourceSkill
  }

  try {
    const targetDir = join(workDir, '.claude', 'skills', skillName)
    const sourceMdPath = join(sourceSkill.path, 'SKILL.md')
    const targetMdPath = join(targetDir, 'SKILL.md')

    // Create target directory
    mkdirSync(targetDir, { recursive: true })

    // Copy SKILL.md
    copyFileSync(sourceMdPath, targetMdPath)

    // Clear cache for this space
    invalidateSkillsCache(workDir)

    return {
      ...sourceSkill,
      path: targetDir,
      source: 'space'
    }
  } catch (error) {
    console.error(`[Skills] Failed to copy skill to space:`, error)
    return null
  }
}

/**
 * Clear skills cache
 * Call this when skill files are modified
 */
export function clearSkillsCache(): void {
  globalSkillsCache = null
  spaceSkillsCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateSkillsCache(workDir?: string | null): void {
  if (!workDir) {
    globalSkillsCache = null
    return
  }
  spaceSkillsCache.delete(workDir)
}
