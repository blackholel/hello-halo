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
import type { ResourceRef, CopyToSpaceOptions, CopyToSpaceResult } from './resource-ref.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError } from '../utils/path-validation'
import { FileCache } from '../utils/file-cache'

// ============================================
// Skill Types
// ============================================

export interface SkillDefinition {
  name: string
  path: string
  source: 'app' | 'global' | 'space' | 'installed'
  description?: string
  triggers?: string[]
  category?: string
  pluginRoot?: string
  namespace?: string
}

export interface SkillContent {
  name: string
  content: string
  frontmatter?: Record<string, unknown>
}

// Cache
let globalSkillsCache: SkillDefinition[] | null = null
const spaceSkillsCache = new Map<string, SkillDefinition[]>()
const contentCache = new FileCache<string>({ maxSize: 200 })

// ============================================
// Helpers
// ============================================

function skillKey(skill: SkillDefinition): string {
  return skill.namespace ? `${skill.namespace}:${skill.name}` : skill.name
}

function getAllowedSkillBaseDirs(): string[] {
  return getAllSpacePaths().map((spacePath) => join(spacePath, '.claude', 'skills'))
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveWorkDirForSkillPath(skillMdPath: string): string | null {
  const normalizedPath = normalizePath(skillMdPath)
  for (const base of getAllowedSkillBaseDirs().map(normalizePath)) {
    if (normalizedPath.startsWith(base)) {
      return dirname(dirname(base))
    }
  }
  return null
}

function findSkill(skills: SkillDefinition[], name: string): SkillDefinition | undefined {
  if (name.includes(':')) {
    const [namespace, skillName] = name.split(':', 2)
    return skills.find(s => s.name === skillName && s.namespace === namespace)
  }
  return skills.find(s => s.name === name && !s.namespace)
    ?? skills.find(s => s.name === name)
}

function findSkillByRef(skills: SkillDefinition[], ref: ResourceRef): SkillDefinition | undefined {
  if (ref.path) {
    const byPath = skills.find((skill) => skill.path === ref.path)
    if (byPath) return byPath
  }

  return skills.find((skill) => {
    if (skill.name !== ref.name) return false
    if ((ref.namespace || undefined) !== (skill.namespace || undefined)) return false
    if (ref.source && skill.source !== ref.source) return false
    return true
  })
}

// ============================================
// Frontmatter Parsing
// ============================================

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const result: Record<string, unknown> = {}
  let currentKey: string | null = null
  let currentArray: string[] | null = null

  for (const line of match[1].split('\n')) {
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && currentArray) {
        currentArray.push(line.replace(/^\s+-\s+/, '').trim())
      }
      continue
    }

    if (currentKey && currentArray) {
      result[currentKey] = currentArray
      currentArray = null
      currentKey = null
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)$/)
    if (kvMatch) {
      const [, key, value] = kvMatch
      if (value.trim() === '') {
        currentKey = key
        currentArray = []
      } else {
        result[key] = value.trim()
      }
    }
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray
  }

  return result
}

// ============================================
// Directory Scanning
// ============================================

function scanSkillDir(
  dirPath: string,
  source: SkillDefinition['source'],
  pluginRoot?: string,
  namespace?: string
): SkillDefinition[] {
  if (!isValidDirectoryPath(dirPath, 'Skills')) return []

  const skills: SkillDefinition[] = []
  try {
    for (const entry of readdirSync(dirPath)) {
      const skillPath = join(dirPath, entry)
      try {
        if (!statSync(skillPath).isDirectory()) continue

        const skillMdPath = join(skillPath, 'SKILL.md')
        if (!existsSync(skillMdPath)) continue

        let description: string | undefined
        let triggers: string[] | undefined
        let category: string | undefined
        try {
          const frontmatter = parseFrontmatter(readFileSync(skillMdPath, 'utf-8'))
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
          ...(pluginRoot && { pluginRoot }),
          ...(namespace && { namespace })
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
  for (const skill of globalSkills) merged.set(skillKey(skill), skill)
  for (const skill of spaceSkills) merged.set(skillKey(skill), skill)
  return Array.from(merged.values())
}

function buildGlobalSkills(): SkillDefinition[] {
  const skills: SkillDefinition[] = []
  const seenNames = new Set<string>()

  const addSkills = (newSkills: SkillDefinition[]): void => {
    for (const skill of newSkills) {
      const key = skillKey(skill)
      if (seenNames.has(key)) {
        const idx = skills.findIndex(s => skillKey(s) === key)
        if (idx >= 0) skills.splice(idx, 1)
      }
      skills.push(skill)
      seenNames.add(key)
    }
  }

  // 0. Enabled plugins - lowest priority
  for (const plugin of listEnabledPlugins()) {
    const skillsSubdir = join(plugin.installPath, 'skills')
    if (existsSync(skillsSubdir)) {
      addSkills(scanSkillDir(skillsSubdir, 'installed', plugin.installPath, plugin.name))
    }
  }

  // 1. App-level skills (~/.halo/skills/)
  const haloDir = getHaloDir()
  if (haloDir) {
    addSkills(scanSkillDir(join(haloDir, 'skills'), 'app'))
  }

  // 2. Global custom paths from config.claudeCode.plugins.globalPaths
  const globalPaths = getConfig().claudeCode?.plugins?.globalPaths || []
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
  return scanSkillDir(join(workDir, '.claude', 'skills'), 'space')
}

function logFound(items: SkillDefinition[]): void {
  if (items.length > 0) {
    console.log(`[Skills] Found ${items.length} skills: ${items.map(skillKey).join(', ')}`)
  }
}

// ============================================
// Public API
// ============================================

/**
 * List all available skills from all sources
 */
export function listSkills(workDir?: string): SkillDefinition[] {
  if (!globalSkillsCache) {
    globalSkillsCache = buildGlobalSkills()
  }

  if (!workDir) {
    logFound(globalSkillsCache)
    return globalSkillsCache
  }

  let spaceSkills = spaceSkillsCache.get(workDir)
  if (!spaceSkills) {
    spaceSkills = buildSpaceSkills(workDir)
    spaceSkillsCache.set(workDir, spaceSkills)
  }

  const skills = mergeSkills(globalSkillsCache, spaceSkills)
  logFound(skills)
  return skills
}

export function listSpaceSkills(workDir: string): SkillDefinition[] {
  return listSkills(workDir).filter(skill => skill.source === 'space')
}

function listSkillsForRefLookup(workDir: string): SkillDefinition[] {
  if (!globalSkillsCache) {
    globalSkillsCache = buildGlobalSkills()
  }

  let spaceSkills = spaceSkillsCache.get(workDir)
  if (!spaceSkills) {
    spaceSkills = buildSpaceSkills(workDir)
    spaceSkillsCache.set(workDir, spaceSkills)
  }

  // Keep source-distinct entries for by-ref copy lookup; do not merge by key.
  return [...spaceSkills, ...globalSkillsCache]
}

export function getSkillDefinition(
  name: string,
  workDir?: string,
  opts?: { allowedSources?: SkillDefinition['source'][] }
): SkillDefinition | null {
  const skill = findSkill(listSkills(workDir), name)
  if (!skill) return null

  if (opts?.allowedSources && !opts.allowedSources.includes(skill.source)) {
    return null
  }
  return skill
}

/**
 * Get skill content by name
 */
export function getSkillContent(name: string, workDir?: string): SkillContent | null {
  const skill = getSkillDefinition(name, workDir)
  if (!skill) {
    console.warn(`[Skills] Skill not found: ${name}`)
    return null
  }

  try {
    const skillMdPath = join(skill.path, 'SKILL.md')
    let content = contentCache.get(skillMdPath, () => readFileSync(skillMdPath, 'utf-8'))
    if (skill.pluginRoot) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, skill.pluginRoot)
    }
    return {
      name: skill.name,
      content,
      frontmatter: parseFrontmatter(content) ?? undefined
    }
  } catch (error) {
    contentCache.clear(join(skill.path, 'SKILL.md'))
    if (isFileNotFoundError(error)) {
      console.debug(`[Skills] Skill file not found: ${name}`)
    } else {
      console.warn(`[Skills] Failed to read skill ${name}:`, error)
    }
    return null
  }
}

/**
 * Create a new skill in the space directory
 */
export function createSkill(workDir: string, name: string, content: string): SkillDefinition {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`Invalid skill name: ${name}`)
  }

  const skillDir = join(workDir, '.claude', 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')
  invalidateSkillsCache(workDir)

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
 */
export function updateSkill(skillPath: string, content: string): boolean {
  try {
    const skillMdPath = skillPath.endsWith('SKILL.md')
      ? skillPath
      : join(skillPath, 'SKILL.md')

    if (!isPathWithinBasePaths(skillMdPath, getAllowedSkillBaseDirs())) {
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
    console.error('[Skills] Failed to update skill:', error)
    return false
  }
}

/**
 * Delete a skill
 */
export function deleteSkill(skillPath: string): boolean {
  try {
    const normalizedPath = skillPath.replace(/\\/g, '/')
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
    console.error('[Skills] Failed to delete skill:', error)
    return false
  }
}

/**
 * Copy a skill to the space directory
 */
export function copySkillToSpace(skillName: string, workDir: string): SkillDefinition | null {
  const result = copySkillToSpaceByRef({ type: 'skill', name: skillName }, workDir)
  return result.status === 'copied' ? (result.data ?? null) : null
}

export function copySkillToSpaceByRef(
  ref: ResourceRef,
  workDir: string,
  options?: CopyToSpaceOptions
): CopyToSpaceResult<SkillDefinition> {
  const sourceSkill = findSkillByRef(listSkillsForRefLookup(workDir), ref)
  if (!sourceSkill) {
    console.warn(`[Skills] Source skill not found: ${ref.name}`)
    return { status: 'not_found' }
  }

  const targetDir = join(workDir, '.claude', 'skills', sourceSkill.name)
  const targetSkillPath = join(targetDir, 'SKILL.md')

  if (sourceSkill.source === 'space' && sourceSkill.path === targetDir) {
    return { status: 'copied', data: sourceSkill }
  }

  if (existsSync(targetSkillPath) && !options?.overwrite) {
    return { status: 'conflict', existingPath: targetDir }
  }

  try {
    if (existsSync(targetDir) && options?.overwrite) {
      rmSync(targetDir, { recursive: true, force: true })
    }

    mkdirSync(targetDir, { recursive: true })
    copyFileSync(join(sourceSkill.path, 'SKILL.md'), targetSkillPath)
    invalidateSkillsCache(workDir)
    return {
      status: 'copied',
      data: { ...sourceSkill, path: targetDir, source: 'space' }
    }
  } catch (error) {
    console.error('[Skills] Failed to copy skill to space:', error)
    return { status: 'not_found', error: (error as Error).message }
  }
}

/**
 * Clear skills cache
 */
export function clearSkillsCache(): void {
  globalSkillsCache = null
  spaceSkillsCache.clear()
  contentCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateSkillsCache(workDir?: string | null): void {
  if (!workDir) {
    globalSkillsCache = null
    contentCache.clear()
    return
  }
  spaceSkillsCache.delete(workDir)
  contentCache.clearForDir(workDir)
}
