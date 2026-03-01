/**
 * Toolkit Service - Manages space-level toolkit allowlist
 *
 * Toolkit is a whitelist of DirectiveRef[] stored in space-config.json.
 * When toolkit is null, the space loads all global resources (default behavior).
 * When toolkit is set, only listed resources are loaded.
 */

import { getSpaceConfig, updateSpaceConfig } from './space-config.service'
import type { SpaceToolkit } from './space-config.service'
import type { DirectiveRef, DirectiveType } from './agent/types'

const TOOLKIT_WRITE_DISABLED_ERROR = 'Toolkit write operations are deprecated and disabled in global execution mode'

const TYPE_TO_KEY: Record<DirectiveType, keyof SpaceToolkit> = {
  skill: 'skills',
  command: 'commands',
  agent: 'agents'
}

function assertToolkitWriteEnabled(): void {
  throw new Error(TOOLKIT_WRITE_DISABLED_ERROR)
}

/**
 * Build a deterministic ID from a DirectiveRef's identity fields.
 * Format: "{type}:{source}:{namespace}:{name}"
 */
export function buildDirectiveId(ref: Pick<DirectiveRef, 'type' | 'name' | 'namespace' | 'source'>): string {
  return `${ref.type}:${ref.source ?? '-'}:${ref.namespace ?? '-'}:${ref.name}`
}

function normalizeDirective(ref: DirectiveRef): DirectiveRef {
  if (ref.id) return ref
  return { ...ref, id: buildDirectiveId(ref) }
}

function normalizeToolkit(toolkit?: SpaceToolkit | null): SpaceToolkit {
  return {
    skills: toolkit?.skills ? [...toolkit.skills] : [],
    commands: toolkit?.commands ? [...toolkit.commands] : [],
    agents: toolkit?.agents ? [...toolkit.agents] : []
  }
}

function dedupe(list: DirectiveRef[]): DirectiveRef[] {
  const seen = new Set<string>()
  const out: DirectiveRef[] = []
  for (const item of list) {
    const normalized = normalizeDirective(item)
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    out.push(normalized)
  }
  return out
}

function matchesRef(
  candidate: { name: string; namespace?: string; source?: string; id?: string },
  ref: DirectiveRef
): boolean {
  if (candidate.id && candidate.id === ref.id) return true
  if (ref.name !== candidate.name) return false
  if (candidate.namespace && ref.namespace !== candidate.namespace) return false
  if (candidate.source && ref.source !== candidate.source) return false
  return true
}

interface ParsedDirectiveName {
  name: string
  namespace?: string
}

/**
 * Parse namespaced resource key using the first ":" as separator.
 * Keeps behavior aligned with services that resolve "namespace:name" via split(':', 2).
 */
export function parseDirectiveName(raw: string): ParsedDirectiveName | null {
  const value = raw.trim()
  if (!value) return null

  if (!value.includes(':')) {
    return { name: value }
  }

  const [namespace, name] = value.split(':', 2)
  if (!namespace || !name) return null
  return { namespace, name }
}

function makeRef(type: DirectiveType, parsed: ParsedDirectiveName): DirectiveRef {
  return normalizeDirective({ id: '', type, name: parsed.name, namespace: parsed.namespace })
}

/**
 * Check if a toolkit contains a given resource.
 */
export function toolkitContains(
  toolkit: SpaceToolkit | null,
  type: DirectiveType,
  candidate: { name: string; namespace?: string; source?: string; id?: string }
): boolean {
  if (!toolkit) return false
  return toolkit[TYPE_TO_KEY[type]].some(ref => matchesRef(candidate, ref))
}

/**
 * Compute a stable hash-like fingerprint for toolkit change detection.
 */
export function getToolkitHash(toolkit: SpaceToolkit | null): string {
  if (!toolkit) return ''
  const allIds = [
    ...toolkit.skills.map(ref => normalizeDirective(ref).id),
    ...toolkit.commands.map(ref => normalizeDirective(ref).id),
    ...toolkit.agents.map(ref => normalizeDirective(ref).id)
  ].sort()
  return allIds.join('|')
}

/**
 * Get the space toolkit. Returns null if not configured (meaning "load all global resources").
 */
export function getSpaceToolkit(workDir: string): SpaceToolkit | null {
  const config = getSpaceConfig(workDir)
  if (!config?.toolkit) return null
  const normalized = normalizeToolkit(config.toolkit)
  return {
    skills: dedupe(normalized.skills),
    commands: dedupe(normalized.commands),
    agents: dedupe(normalized.agents)
  }
}

/**
 * Add a resource to the space toolkit.
 * If toolkit doesn't exist yet, creates it (entering whitelist mode).
 */
export function addToolkitResource(workDir: string, ref: DirectiveRef): SpaceToolkit | null {
  assertToolkitWriteEnabled()
  const normalizedRef = normalizeDirective(ref)
  const key = TYPE_TO_KEY[normalizedRef.type]

  const updated = updateSpaceConfig(workDir, (config) => {
    const toolkit = normalizeToolkit(config.toolkit)
    toolkit[key] = dedupe([...toolkit[key], normalizedRef])
    return { ...config, toolkit }
  })
  return updated?.toolkit ?? null
}

/**
 * Remove a resource from the space toolkit.
 */
export function removeToolkitResource(workDir: string, ref: DirectiveRef): SpaceToolkit | null {
  assertToolkitWriteEnabled()
  const normalizedRef = normalizeDirective(ref)
  const key = TYPE_TO_KEY[normalizedRef.type]

  const updated = updateSpaceConfig(workDir, (config) => {
    const toolkit = normalizeToolkit(config.toolkit)
    toolkit[key] = toolkit[key].filter(existing => !matchesRef(normalizedRef, existing))
    return { ...config, toolkit }
  })
  return updated?.toolkit ?? null
}

/**
 * Clear the entire toolkit (return to "load all global" mode).
 */
export function clearSpaceToolkit(workDir: string): void {
  assertToolkitWriteEnabled()
  updateSpaceConfig(workDir, (config) => {
    const { toolkit: _removed, ...rest } = config
    return rest
  })
}

/**
 * Migrate enabled skills/agents preferences to a toolkit whitelist.
 */
export function migrateToToolkit(
  workDir: string,
  enabledSkills: string[],
  enabledAgents: string[]
): SpaceToolkit | null {
  assertToolkitWriteEnabled()
  const parsedSkills = enabledSkills
    .map(parseDirectiveName)
    .filter((item): item is ParsedDirectiveName => item !== null)

  const parsedAgents = enabledAgents
    .map(parseDirectiveName)
    .filter((item): item is ParsedDirectiveName => item !== null)

  const updated = updateSpaceConfig(workDir, (config) => ({
    ...config,
    toolkit: {
      skills: dedupe(parsedSkills.map(parsed => makeRef('skill', parsed))),
      commands: [],
      agents: dedupe(parsedAgents.map(parsed => makeRef('agent', parsed)))
    }
  }))
  return updated?.toolkit ?? null
}
