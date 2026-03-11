/**
 * Skills Service - Manages Claude Code skills configuration
 *
 * Skills are loaded from multiple sources:
 * 1. {locked-user-root}/skills/ - Default app-level skills directory
 * 2. config.claudeCode.plugins.globalPaths - Custom global paths (skills/ subdirectory)
 * 3. Installed plugins - Skills from installed plugins
 * 4. {workDir}/.claude/skills/ - Space-level skills (Claude Code compatible)
 *
 * Each skill is a directory containing a SKILL.md file with frontmatter metadata.
 */

import { join, dirname, resolve } from 'path'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { getConfig } from './config.service'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'
import { getSpaceConfig } from './space-config.service'
import { listEnabledPlugins } from './plugins.service'
import { getAllSpacePaths } from './space.service'
import type { ResourceRef, CopyToSpaceOptions, CopyToSpaceResult } from './resource-ref.service'
import { isPathWithinBasePaths, isValidDirectoryPath, isFileNotFoundError } from '../utils/path-validation'
import { FileCache } from '../utils/file-cache'
import {
  parseFrontmatter,
  getFrontmatterString,
  getFrontmatterStringArray,
  getLocalizedFrontmatterStringForLocale
} from './resource-metadata.service'
import { resolveResourceDisplayOverride } from './resource-display-i18n.service'
import type { ResourceListView, ResourceExposure } from '../../shared/resource-access'
import { filterByResourceExposure, resolveResourceExposure } from './resource-exposure.service'

// ============================================
// Skill Types
// ============================================

export interface SkillDefinition {
  name: string
  displayName?: string
  path: string
  source: 'app' | 'global' | 'space' | 'installed'
  description?: string
  triggers?: string[]
  category?: string
  pluginRoot?: string
  namespace?: string
  exposure: ResourceExposure
}

export interface SkillContent {
  name: string
  content: string
  frontmatter?: Record<string, unknown>
}

export type SopAction =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'press_key'
  | 'wait_for'

export interface SemanticTarget {
  role?: string
  name?: string
  text?: string
  label?: string
  placeholder?: string
  urlPattern?: string
}

export interface SopRecordedStep {
  id: string
  action: SopAction
  target?: SemanticTarget
  value?: string
  assertion?: string
  retries: number
}

export interface SopSpec {
  version: string
  name: string
  steps: SopRecordedStep[]
  meta?: Record<string, unknown>
}

export interface SaveSopSkillInput {
  workDir: string
  skillName: string
  description?: string
  sopSpec: SopSpec
}

export interface SaveSopSkillResult {
  skillName: string
  skillPath: string
  created: boolean
  revision: number
}

// Cache
const DEFAULT_LOCALE_CACHE_KEY = '__default__'
const globalSkillsCacheByLocale = new Map<string, SkillDefinition[]>()
const spaceSkillsCacheByLocale = new Map<string, Map<string, SkillDefinition[]>>()
const fullMeshMergedSkillsCacheByLocale = new Map<string, Map<string, SkillDefinition[]>>()
const contentCache = new FileCache<string>({ maxSize: 200 })
const listLogSignatureCache = new Map<string, string>()
const fullMeshAggregationLogSignatureCache = new Map<string, string>()
const SOP_SPEC_BEGIN_MARKER = '## SOP_SPEC_JSON_BEGIN'
const SOP_SPEC_END_MARKER = '## SOP_SPEC_JSON_END'

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

function normalizeResolvedPath(path: string): string {
  return normalizePath(resolve(path))
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const normalizedTarget = normalizeResolvedPath(targetPath)
  const normalizedDirectory = normalizeResolvedPath(directoryPath)
  if (normalizedTarget === normalizedDirectory) return true
  return normalizedTarget.startsWith(`${normalizedDirectory}/`)
}

function toLocaleCacheKey(locale?: string): string {
  const trimmed = locale?.trim()
  if (!trimmed) return DEFAULT_LOCALE_CACHE_KEY
  return trimmed.replace(/_/g, '-').toLowerCase()
}

function getNormalizedWorkDirKey(workDir: string): string {
  return normalizeResolvedPath(workDir)
}

function shouldVerboseResourceListLog(): boolean {
  const raw = process.env.KITE_VERBOSE_RESOURCE_LIST
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isFullMeshRuntimePolicy(workDir?: string): boolean {
  if (!workDir) return false
  const config = getConfig()
  const spaceConfig = getSpaceConfig(workDir)
  const runtimePolicy =
    spaceConfig?.claudeCode?.resourceRuntimePolicy ||
    config.claudeCode?.resourceRuntimePolicy ||
    'app-single-source'
  return runtimePolicy === 'full-mesh'
}

function getSpaceSkillsFromCache(workDir: string, localeKey: string, locale?: string): SkillDefinition[] {
  let spaceCache = spaceSkillsCacheByLocale.get(workDir)
  if (!spaceCache) {
    spaceCache = new Map<string, SkillDefinition[]>()
    spaceSkillsCacheByLocale.set(workDir, spaceCache)
  }

  let spaceSkills = spaceCache.get(localeKey)
  if (!spaceSkills) {
    spaceSkills = buildSpaceSkills(workDir, locale)
    spaceCache.set(localeKey, spaceSkills)
  }

  return spaceSkills
}

function getFullMeshSkillsFromCache(workDir: string, localeKey: string): SkillDefinition[] | null {
  const workDirKey = getNormalizedWorkDirKey(workDir)
  const localeCache = fullMeshMergedSkillsCacheByLocale.get(workDirKey)
  if (!localeCache) return null
  return localeCache.get(localeKey) || null
}

function setFullMeshSkillsCache(workDir: string, localeKey: string, skills: SkillDefinition[]): void {
  const workDirKey = getNormalizedWorkDirKey(workDir)
  let localeCache = fullMeshMergedSkillsCacheByLocale.get(workDirKey)
  if (!localeCache) {
    localeCache = new Map<string, SkillDefinition[]>()
    fullMeshMergedSkillsCacheByLocale.set(workDirKey, localeCache)
  }
  localeCache.set(localeKey, skills)
}

function getSortedSpacePaths(): string[] {
  return [...getAllSpacePaths()].sort((a, b) => a.localeCompare(b))
}

function getFullMeshLookupSpacePaths(currentWorkDir: string): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const spacePath of [currentWorkDir, ...getSortedSpacePaths()]) {
    const normalizedPath = normalizeResolvedPath(spacePath)
    if (seen.has(normalizedPath)) {
      continue
    }
    seen.add(normalizedPath)
    deduped.push(spacePath)
  }
  return deduped
}

function resolveSkillOwnerSpacePath(skill: SkillDefinition): string | null {
  if (skill.source !== 'space') return null
  for (const spacePath of getSortedSpacePaths()) {
    const skillRoot = join(spacePath, '.claude', 'skills')
    if (isPathWithinDirectory(skill.path, skillRoot)) {
      return normalizeResolvedPath(spacePath)
    }
  }
  return null
}

function getSkillPrecedence(
  skill: SkillDefinition,
  currentWorkDir: string
): { level: number; ownerSpacePath: string | null } {
  const ownerSpacePath = resolveSkillOwnerSpacePath(skill)
  if (!ownerSpacePath) return { level: 0, ownerSpacePath: null }
  if (ownerSpacePath === normalizeResolvedPath(currentWorkDir)) {
    return { level: 2, ownerSpacePath }
  }
  return { level: 1, ownerSpacePath }
}

function shouldReplaceSkill(existing: SkillDefinition, candidate: SkillDefinition, currentWorkDir: string): boolean {
  const existingPrecedence = getSkillPrecedence(existing, currentWorkDir)
  const candidatePrecedence = getSkillPrecedence(candidate, currentWorkDir)
  if (candidatePrecedence.level > existingPrecedence.level) return true
  if (candidatePrecedence.level < existingPrecedence.level) return false

  if (
    candidatePrecedence.level === 1 &&
    existingPrecedence.ownerSpacePath &&
    candidatePrecedence.ownerSpacePath
  ) {
    const ownerCompare = candidatePrecedence.ownerSpacePath.localeCompare(existingPrecedence.ownerSpacePath)
    if (ownerCompare < 0) return true
    if (ownerCompare > 0) return false
    return candidate.path.localeCompare(existing.path) < 0
  }

  return false
}

function mergeSkillsFullMesh(
  globalSkills: SkillDefinition[],
  allSpaceSkills: SkillDefinition[],
  currentWorkDir: string
): SkillDefinition[] {
  const merged = new Map<string, SkillDefinition>()
  const conflicts: string[] = []

  for (const skill of globalSkills) {
    merged.set(skillKey(skill), skill)
  }

  for (const skill of allSpaceSkills) {
    const key = skillKey(skill)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, skill)
      continue
    }
    if (shouldReplaceSkill(existing, skill, currentWorkDir)) {
      conflicts.push(`${key}: ${existing.path} -> ${skill.path}`)
      merged.set(key, skill)
    }
  }

  if (conflicts.length > 0) {
    console.log(
      `[Skills][full-mesh] Resolved ${conflicts.length} conflicts by precedence (current space > lexicographic space > global)`
    )
  }

  return Array.from(merged.values())
}

function logFullMeshAggregation(
  workDir: string,
  localeKey: string,
  globalCount: number,
  spaceCount: number,
  mergedCount: number
): void {
  const cacheKey = `${getNormalizedWorkDirKey(workDir)}:${localeKey}`
  const signature = `${globalCount}:${spaceCount}:${mergedCount}`
  if (fullMeshAggregationLogSignatureCache.get(cacheKey) === signature) {
    return
  }
  fullMeshAggregationLogSignatureCache.set(cacheKey, signature)
  console.log(
    `[Skills][full-mesh] Aggregated resources: global=${globalCount}, spaces=${spaceCount}, merged=${mergedCount}`
  )
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

function toYamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (/^[a-zA-Z0-9._-]+$/.test(value)) {
    return value
  }

  return JSON.stringify(value)
}

function extractFrontmatterRange(content: string): { start: number; end: number; body: string } | null {
  if (!content.startsWith('---\n')) return null
  const endIndex = content.indexOf('\n---\n', 4)
  if (endIndex < 0) return null
  return {
    start: 0,
    end: endIndex + '\n---\n'.length,
    body: content.slice(4, endIndex),
  }
}

function upsertFrontmatterField(content: string, key: string, value: string | number | boolean): string {
  const yamlLine = `${key}: ${toYamlScalar(value)}`
  const range = extractFrontmatterRange(content)
  if (!range) {
    return `---\n${yamlLine}\n---\n\n${content.trimStart()}`
  }

  const lines = range.body.length > 0 ? range.body.split('\n') : []
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`)
  let replaced = false
  const nextLines = lines.map((line) => {
    if (keyPattern.test(line)) {
      replaced = true
      return yamlLine
    }
    return line
  })
  if (!replaced) {
    nextLines.push(yamlLine)
  }

  const nextFrontmatter = `---\n${nextLines.join('\n')}\n---\n`
  return `${nextFrontmatter}${content.slice(range.end)}`
}

function buildSopSpecJsonBlock(spec: SopSpec): string {
  return [
    SOP_SPEC_BEGIN_MARKER,
    '```json',
    JSON.stringify(spec, null, 2),
    '```',
    SOP_SPEC_END_MARKER,
  ].join('\n')
}

function replaceSopSpecJsonBlock(content: string, block: string): string {
  const blockRegex = new RegExp(
    `${SOP_SPEC_BEGIN_MARKER}[\\s\\S]*?${SOP_SPEC_END_MARKER}`,
    'm'
  )
  if (!blockRegex.test(content)) {
    return ''
  }
  return content.replace(blockRegex, block)
}

function normalizeSopSpec(spec: SopSpec, name: string, revision: number): SopSpec {
  return {
    ...spec,
    name: spec.name || name,
    steps: Array.isArray(spec.steps)
      ? spec.steps.map((step, idx) => ({
        id: typeof step.id === 'string' && step.id.trim().length > 0 ? step.id : `step-${idx + 1}`,
        action: step.action,
        target: step.target,
        value: step.value,
        assertion: step.assertion,
        retries: Number.isFinite(step.retries) && step.retries > 0 ? step.retries : 3,
      }))
      : [],
    meta: {
      ...(spec.meta || {}),
      sop_mode: 'manual_browser',
      sop_revision: revision,
      updated_at: new Date().toISOString(),
    },
  }
}

function extractSopRevision(frontmatter: Record<string, unknown> | null | undefined): number {
  if (!frontmatter) return 0
  const rawValue = frontmatter.sop_revision
  const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function buildSopSkillContent(
  skillName: string,
  description: string | undefined,
  normalizedSpec: SopSpec,
  revision: number
): string {
  const block = buildSopSpecJsonBlock(normalizedSpec)
  const frontmatterLines = [
    '---',
    `name: ${toYamlScalar(skillName)}`,
    `description: ${toYamlScalar(description || `Recorded browser SOP for ${skillName}`)}`,
    'sop_mode: manual_browser',
    `sop_revision: ${revision}`,
    '---',
  ]

  const body = [
    `# ${skillName}`,
    '',
    'This skill replays a manually recorded browser SOP. Follow the steps exactly and stop on uncertainty.',
    '',
    '## Execution Rules',
    '1. Always run snapshot before each action.',
    '2. Resolve targets using role/name/text/label/placeholder/urlPattern in this priority.',
    '3. Maximum retries per step: 3.',
    '4. If semantic match confidence is low, stop and report the failed step.',
    '',
    block,
    '',
  ]

  return `${frontmatterLines.join('\n')}\n${body.join('\n')}`
}

function findSkill(skills: SkillDefinition[], name: string): SkillDefinition | undefined {
  const lookup = name.trim()
  if (!lookup) return undefined

  if (lookup.includes(':')) {
    const [namespace, skillName] = lookup.split(':', 2)
    if (!namespace || !skillName) return undefined

    const exact = skills.find((skill) => skill.name === skillName && skill.namespace === namespace)
    if (exact) return exact

    const byAlias = findSkillByAlias(skills, skillName, namespace)
    return resolveAliasedSkill(byAlias, lookup)
  }

  const exactWithoutNamespace = skills.find((skill) => skill.name === lookup && !skill.namespace)
  if (exactWithoutNamespace) return exactWithoutNamespace

  const exactWithNamespace = skills.find((skill) => skill.name === lookup)
  if (exactWithNamespace) return exactWithNamespace

  const byAlias = findSkillByAlias(skills, lookup)
  return resolveAliasedSkill(byAlias, lookup)
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function findSkillByAlias(
  skills: SkillDefinition[],
  lookup: string,
  namespace?: string
): SkillDefinition[] {
  const normalizedLookup = normalizeLookupValue(lookup)
  if (!normalizedLookup) return []

  return skills.filter((skill) => {
    if (namespace && skill.namespace !== namespace) return false

    const candidates: string[] = []
    if (skill.displayName) candidates.push(skill.displayName)
    if (Array.isArray(skill.triggers)) candidates.push(...skill.triggers)
    if (namespace && skill.namespace) {
      if (skill.displayName) candidates.push(`${skill.namespace}:${skill.displayName}`)
      if (Array.isArray(skill.triggers)) {
        for (const trigger of skill.triggers) {
          candidates.push(`${skill.namespace}:${trigger}`)
        }
      }
    }

    return candidates.some((candidate) => normalizeLookupValue(candidate) === normalizedLookup)
  })
}

function resolveAliasedSkill(matches: SkillDefinition[], lookup: string): SkillDefinition | undefined {
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]

  const withoutNamespace = matches.filter((skill) => !skill.namespace)
  if (withoutNamespace.length === 1) return withoutNamespace[0]

  const uniqueKeys = new Set(matches.map(skillKey))
  if (uniqueKeys.size === 1) return matches[0]

  console.warn(
    `[Skills] Ambiguous aliased skill lookup "${lookup}", fallback to first match: ${matches.map(skillKey).join(', ')}`
  )
  return matches[0]
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
// Directory Scanning
// ============================================

function scanSkillDir(
  dirPath: string,
  source: SkillDefinition['source'],
  sourceRoot?: string,
  pluginRoot?: string,
  namespace?: string,
  workDir?: string,
  locale?: string
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
        let displayName: string | undefined
        let triggers: string[] | undefined
        let category: string | undefined
        let frontmatterExposure: unknown
        let frontmatterDescription: string | undefined
        let localizedFrontmatterDescription: string | undefined
        let frontmatterDisplayName: string | undefined
        let localizedFrontmatterDisplayName: string | undefined
        try {
          const content = readFileSync(skillMdPath, 'utf-8')
          const frontmatter = parseFrontmatter(content)
          if (frontmatter) {
            frontmatterDescription = getFrontmatterString(frontmatter, ['description'])
            localizedFrontmatterDescription = getLocalizedFrontmatterStringForLocale(frontmatter, ['description'], locale)
            frontmatterDisplayName = getFrontmatterString(frontmatter, ['name', 'title'])
            localizedFrontmatterDisplayName = getLocalizedFrontmatterStringForLocale(frontmatter, ['name', 'title'], locale)
            triggers = getFrontmatterStringArray(frontmatter, ['triggers'])
            category = getFrontmatterString(frontmatter, ['category'])
            frontmatterExposure = frontmatter.exposure
          }
        } catch {
          // Ignore read errors for metadata
        }

        const resourceKey = namespace ? `${namespace}:${entry}` : entry
        const sidecar = resolveResourceDisplayOverride(sourceRoot, 'skill', resourceKey, locale)
        description = sidecar.descriptionLocale
          ?? localizedFrontmatterDescription
          ?? sidecar.descriptionDefault
          ?? frontmatterDescription
        displayName = sidecar.titleLocale
          ?? localizedFrontmatterDisplayName
          ?? sidecar.titleDefault
          ?? frontmatterDisplayName

        skills.push({
          name: entry,
          path: skillPath,
          source,
          exposure: resolveResourceExposure({
            type: 'skill',
            source,
            name: entry,
            namespace,
            workDir,
            frontmatterExposure
          }),
          description,
          triggers,
          category,
          ...(displayName && { displayName }),
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

function buildGlobalSkills(locale?: string): SkillDefinition[] {
  const sourceMode = getLockedConfigSourceMode()
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
  const enabledPlugins = listEnabledPlugins()
  console.log(`[Skills] Building global skills, found ${enabledPlugins.length} enabled plugins`)
  for (const plugin of enabledPlugins) {
    const skillsSubdir = join(plugin.installPath, 'skills')
    console.log(`[Skills] Checking plugin ${plugin.name} at ${skillsSubdir}, exists: ${existsSync(skillsSubdir)}`)
    if (existsSync(skillsSubdir)) {
      const scanned = scanSkillDir(skillsSubdir, 'installed', plugin.installPath, plugin.installPath, plugin.name, undefined, locale)
      console.log(`[Skills] Scanned ${scanned.length} skills from plugin ${plugin.name}`)
      addSkills(scanned)
    }
  }

  // 1. App-level skills ({locked-user-root}/skills/)
  addSkills(scanSkillDir(join(getLockedUserConfigRootDir(), 'skills'), 'app', getLockedUserConfigRootDir(), undefined, undefined, undefined, locale))

  // 2. Kite mode only: global custom paths from config.claudeCode.plugins.globalPaths
  if (sourceMode === 'kite') {
    const globalPaths = getConfig().claudeCode?.plugins?.globalPaths || []
    for (const globalPath of globalPaths) {
      const resolvedPath = globalPath.startsWith('/')
        ? globalPath
        : join(require('os').homedir(), globalPath)
      const skillsSubdir = join(resolvedPath, 'skills')
      if (existsSync(skillsSubdir)) {
        addSkills(scanSkillDir(skillsSubdir, 'global', resolvedPath, undefined, undefined, undefined, locale))
      }
    }
  }

  return skills
}

function buildSpaceSkills(workDir: string, locale?: string): SkillDefinition[] {
  return scanSkillDir(join(workDir, '.claude', 'skills'), 'space', join(workDir, '.claude'), undefined, undefined, workDir, locale)
}

function logFound(items: SkillDefinition[], view: ResourceListView, workDir?: string, locale?: string): void {
  if (items.length > 0) {
    const localeKey = toLocaleCacheKey(locale)
    const scopeKey = workDir ? getNormalizedWorkDirKey(workDir) : '__global__'
    const cacheKey = `${scopeKey}:${localeKey}:${view}`
    const signature = `${items.length}:${items.map(skillKey).join(',')}`
    if (listLogSignatureCache.get(cacheKey) === signature) {
      return
    }
    listLogSignatureCache.set(cacheKey, signature)
    const details = shouldVerboseResourceListLog()
      ? `: ${items.map(skillKey).join(', ')}`
      : ''
    console.log(`[Skills] Found ${items.length} skills${details}`)
  }
}

// ============================================
// Public API
// ============================================

/**
 * List all available skills from all sources
 */
function listSkillsUnfiltered(workDir?: string, locale?: string): SkillDefinition[] {
  const localeKey = toLocaleCacheKey(locale)
  let globalSkills = globalSkillsCacheByLocale.get(localeKey)
  if (!globalSkills) {
    globalSkills = buildGlobalSkills(locale)
    globalSkillsCacheByLocale.set(localeKey, globalSkills)
  }

  if (!workDir) {
    return globalSkills
  }

  if (isFullMeshRuntimePolicy(workDir)) {
    const cached = getFullMeshSkillsFromCache(workDir, localeKey)
    if (cached) {
      return cached
    }
    const allSpaceSkills: SkillDefinition[] = []
    for (const spacePath of getSortedSpacePaths()) {
      allSpaceSkills.push(...getSpaceSkillsFromCache(spacePath, localeKey, locale))
    }
    const mergedSkills = mergeSkillsFullMesh(globalSkills, allSpaceSkills, workDir)
    setFullMeshSkillsCache(workDir, localeKey, mergedSkills)
    logFullMeshAggregation(workDir, localeKey, globalSkills.length, allSpaceSkills.length, mergedSkills.length)
    return mergedSkills
  }

  const spaceSkills = getSpaceSkillsFromCache(workDir, localeKey, locale)

  const skills = mergeSkills(globalSkills, spaceSkills)
  return skills
}

export function listSkills(workDir: string | undefined, view: ResourceListView, locale?: string): SkillDefinition[] {
  const skills = filterByResourceExposure(listSkillsUnfiltered(workDir, locale), view)
  logFound(skills, view, workDir, locale)
  return skills
}

export function listSpaceSkills(workDir: string): SkillDefinition[] {
  return getSpaceSkillsFromCache(workDir, DEFAULT_LOCALE_CACHE_KEY)
}

function listSkillsForRefLookup(workDir: string): SkillDefinition[] {
  let globalSkills = globalSkillsCacheByLocale.get(DEFAULT_LOCALE_CACHE_KEY)
  if (!globalSkills) {
    globalSkills = buildGlobalSkills()
    globalSkillsCacheByLocale.set(DEFAULT_LOCALE_CACHE_KEY, globalSkills)
  }

  if (isFullMeshRuntimePolicy(workDir)) {
    const allSpaceSkills: SkillDefinition[] = []
    for (const spacePath of getFullMeshLookupSpacePaths(workDir)) {
      allSpaceSkills.push(...getSpaceSkillsFromCache(spacePath, DEFAULT_LOCALE_CACHE_KEY))
    }
    return [...allSpaceSkills, ...globalSkills]
  }

  const spaceSkills = getSpaceSkillsFromCache(workDir, DEFAULT_LOCALE_CACHE_KEY)

  // Keep source-distinct entries for by-ref copy lookup; do not merge by key.
  return [...spaceSkills, ...globalSkills]
}

export function getSkillDefinition(
  name: string,
  workDir?: string,
  opts?: { allowedSources?: SkillDefinition['source'][]; locale?: string }
): SkillDefinition | null {
  const localeCandidates = opts?.locale ? [opts.locale, undefined] : [undefined]
  for (const locale of localeCandidates) {
    const allSkills = listSkillsUnfiltered(workDir, locale)
    const lookupSkills = opts?.allowedSources
      ? allSkills.filter((skill) => opts.allowedSources?.includes(skill.source))
      : allSkills
    const skill = findSkill(lookupSkills, name)
    if (skill) {
      if (isFullMeshRuntimePolicy(workDir)) {
        console.log(
          `[Skills][full-mesh] Resolved "${name}" -> source=${skill.source}, path=${skill.path}`
        )
      }
      return skill
    }
  }

  return null
}

/**
 * Get skill content by name
 */
export function getSkillContent(
  name: string,
  workDir?: string,
  opts?: { locale?: string; allowedSources?: SkillDefinition['source'][] }
): SkillContent | null {
  const skill = getSkillDefinition(name, workDir, opts)
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
  const description = getFrontmatterString(frontmatter, ['description'])
  const displayName = getFrontmatterString(frontmatter, ['name', 'title'])
  const triggers = getFrontmatterStringArray(frontmatter, ['triggers'])
  const category = getFrontmatterString(frontmatter, ['category'])
  const exposure = resolveResourceExposure({
    type: 'skill',
    source: 'space',
    workDir,
    name,
    frontmatterExposure: frontmatter?.exposure
  })
  return {
    name,
    path: skillDir,
    source: 'space',
    exposure,
    description,
    triggers,
    category,
    ...(displayName && { displayName })
  }
}

export function saveSopSkill(input: SaveSopSkillInput): SaveSopSkillResult {
  const { workDir, sopSpec } = input
  const skillName = input.skillName.trim()
  if (!skillName || skillName.includes('/') || skillName.includes('\\') || skillName.includes('..') || skillName.startsWith('.')) {
    throw new Error(`Invalid skill name: ${input.skillName}`)
  }

  const skillDir = join(workDir, '.claude', 'skills', skillName)
  const skillMdPath = join(skillDir, 'SKILL.md')
  const exists = existsSync(skillMdPath)

  let existingContent: string | null = null
  let existingFrontmatter: Record<string, unknown> | null = null
  let description = input.description?.trim() || ''
  let nextRevision = 1

  if (exists) {
    existingContent = readFileSync(skillMdPath, 'utf-8')
    existingFrontmatter = parseFrontmatter(existingContent)
    if (!description) {
      description = getFrontmatterString(existingFrontmatter, ['description']) || ''
    }
    nextRevision = extractSopRevision(existingFrontmatter) + 1
  }

  const normalizedSpec = normalizeSopSpec(sopSpec, skillName, nextRevision)
  const nextBlock = buildSopSpecJsonBlock(normalizedSpec)

  let nextContent = ''
  if (existingContent) {
    const replaced = replaceSopSpecJsonBlock(existingContent, nextBlock)
    if (replaced) {
      nextContent = replaced
      nextContent = upsertFrontmatterField(nextContent, 'name', skillName)
      nextContent = upsertFrontmatterField(
        nextContent,
        'description',
        description || `Recorded browser SOP for ${skillName}`
      )
      nextContent = upsertFrontmatterField(nextContent, 'sop_mode', 'manual_browser')
      nextContent = upsertFrontmatterField(nextContent, 'sop_revision', nextRevision)
    }
  }

  if (!nextContent) {
    const revision = exists ? nextRevision : 1
    const rebuiltSpec = normalizeSopSpec(sopSpec, skillName, revision)
    nextContent = buildSopSkillContent(skillName, description, rebuiltSpec, revision)
    nextRevision = revision
  }

  mkdirSync(skillDir, { recursive: true })
  writeFileSync(skillMdPath, nextContent, 'utf-8')
  invalidateSkillsCache(workDir)

  return {
    skillName,
    skillPath: skillMdPath,
    created: !exists,
    revision: nextRevision,
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
    const skillMdPath = skillPath.endsWith('SKILL.md')
      ? skillPath
      : join(skillPath, 'SKILL.md')

    if (!isPathWithinBasePaths(skillMdPath, getAllowedSkillBaseDirs())) {
      console.warn(`[Skills] Cannot delete skill outside of space skills directory: ${skillPath}`)
      return false
    }

    if (!existsSync(skillMdPath)) {
      console.warn(`[Skills] Skill file not found: ${skillMdPath}`)
      return false
    }

    const targetDir = dirname(skillMdPath)
    rmSync(targetDir, { recursive: true, force: true })
    const workDir = resolveWorkDirForSkillPath(skillMdPath)
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
  globalSkillsCacheByLocale.clear()
  spaceSkillsCacheByLocale.clear()
  fullMeshMergedSkillsCacheByLocale.clear()
  contentCache.clear()
  listLogSignatureCache.clear()
  fullMeshAggregationLogSignatureCache.clear()
}

/**
 * Invalidate cache for a specific space or global scope
 */
export function invalidateSkillsCache(workDir?: string | null): void {
  if (!workDir) {
    globalSkillsCacheByLocale.clear()
    fullMeshMergedSkillsCacheByLocale.clear()
    contentCache.clear()
    listLogSignatureCache.clear()
    fullMeshAggregationLogSignatureCache.clear()
    return
  }
  spaceSkillsCacheByLocale.delete(workDir)
  fullMeshMergedSkillsCacheByLocale.clear()
  contentCache.clearForDir(workDir)
  listLogSignatureCache.clear()
  fullMeshAggregationLogSignatureCache.clear()
}
