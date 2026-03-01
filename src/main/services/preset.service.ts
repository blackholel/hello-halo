/**
 * Preset Service - Manages resource bundle presets (read-only templates)
 *
 * Presets are reusable resource bundles and no longer depend on SpaceToolkit.
 * Backward compatibility: old toolkit-shaped preset files are read and normalized.
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { getKiteDir } from './config.service'
import type { ResourceRef } from './resource-ref.service'
import type { SpaceToolkit } from './space-config.service'

export interface ResourceBundlePreset {
  id: string
  name: string
  description: string
  resources: ResourceRef[]
  systemPromptAppend?: string
  readOnly: boolean
}

// ============================================
// Built-in Presets
// ============================================

function resource(type: ResourceRef['type'], name: string, namespace?: string): ResourceRef {
  return { type, name, namespace }
}

const BUILTIN_PRESETS: ResourceBundlePreset[] = [
  {
    id: 'preset:code-review',
    name: 'Code Review',
    description: 'Code review workflow with quality and security checks',
    resources: [
      resource('skill', 'coding-standards'),
      resource('skill', 'security-review'),
      resource('command', 'review'),
      resource('agent', 'code-reviewer'),
      resource('agent', 'security-reviewer')
    ],
    readOnly: true
  },
  {
    id: 'preset:tdd',
    name: 'TDD Workflow',
    description: 'Test-driven development with test-first methodology',
    resources: [
      resource('skill', 'tdd-workflow'),
      resource('skill', 'coding-standards'),
      resource('agent', 'tdd-guide'),
      resource('agent', 'debugger')
    ],
    readOnly: true
  },
  {
    id: 'preset:full-stack',
    name: 'Full Stack',
    description: 'Frontend and backend development patterns',
    resources: [
      resource('skill', 'frontend-patterns'),
      resource('skill', 'backend-patterns'),
      resource('skill', 'coding-standards'),
      resource('agent', 'code-reviewer'),
      resource('agent', 'build-error-resolver')
    ],
    readOnly: true
  }
]

// ============================================
// Custom Presets (stored in ~/.kite/presets/)
// ============================================

function getPresetsDir(): string {
  return join(getKiteDir(), 'presets')
}

function getLegacyToolkitPresetsDir(): string {
  return join(getKiteDir(), 'toolkit-presets')
}

function loadPresetsFromDir(dirPath: string): ResourceBundlePreset[] {
  if (!existsSync(dirPath)) return []

  try {
    const presets: ResourceBundlePreset[] = []
    for (const file of readdirSync(dirPath).filter(f => f.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(readFileSync(join(dirPath, file), 'utf-8'))
        const preset = normalizePreset(parsed)
        if (!preset) {
          console.warn(`[Preset] Invalid preset shape: ${file}`)
          continue
        }
        preset.readOnly = false
        presets.push(preset)
      } catch {
        console.warn(`[Preset] Failed to load preset: ${file}`)
      }
    }
    return presets
  } catch {
    return []
  }
}

function normalizeResourceRef(ref: ResourceRef): ResourceRef {
  return {
    type: ref.type,
    name: ref.name,
    ...(ref.namespace && { namespace: ref.namespace }),
    ...(ref.source && { source: ref.source }),
    ...(ref.path && { path: ref.path })
  }
}

function toolkitToResourceRefs(toolkit: SpaceToolkit): ResourceRef[] {
  const skillRefs = toolkit.skills.map((ref) => normalizeResourceRef({
    type: 'skill',
    name: ref.name,
    namespace: ref.namespace,
    source: ref.source as ResourceRef['source'] | undefined,
    path: ref.path
  }))
  const commandRefs = toolkit.commands.map((ref) => normalizeResourceRef({
    type: 'command',
    name: ref.name,
    namespace: ref.namespace,
    source: ref.source as ResourceRef['source'] | undefined,
    path: ref.path
  }))
  const agentRefs = toolkit.agents.map((ref) => normalizeResourceRef({
    type: 'agent',
    name: ref.name,
    namespace: ref.namespace,
    source: ref.source as ResourceRef['source'] | undefined,
    path: ref.path
  }))
  return [...skillRefs, ...commandRefs, ...agentRefs]
}

function normalizePreset(input: unknown): ResourceBundlePreset | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.description !== 'string') {
    return null
  }

  const resourcesValue = raw.resources
  if (Array.isArray(resourcesValue)) {
    const resources = resourcesValue
      .filter((item): item is ResourceRef => Boolean(item && typeof item === 'object'))
      .map((item) => normalizeResourceRef(item))
      .filter((item) => !!item.type && !!item.name)
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      resources,
      ...(typeof raw.systemPromptAppend === 'string' ? { systemPromptAppend: raw.systemPromptAppend } : {}),
      readOnly: Boolean(raw.readOnly)
    }
  }

  // Backward compatibility for old SpaceToolkit-shaped presets
  if (resourcesValue && typeof resourcesValue === 'object') {
    const toolkit = resourcesValue as SpaceToolkit
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      resources: toolkitToResourceRefs(toolkit),
      ...(typeof raw.systemPromptAppend === 'string' ? { systemPromptAppend: raw.systemPromptAppend } : {}),
      readOnly: Boolean(raw.readOnly)
    }
  }

  return null
}

function loadCustomPresets(): ResourceBundlePreset[] {
  const nextGenPresets = loadPresetsFromDir(getPresetsDir())
  const legacyPresets = loadPresetsFromDir(getLegacyToolkitPresetsDir())

  // Prefer the new ~/.kite/presets entries when id collides.
  const merged = new Map<string, ResourceBundlePreset>()
  for (const preset of legacyPresets) {
    merged.set(preset.id, preset)
  }
  for (const preset of nextGenPresets) {
    merged.set(preset.id, preset)
  }

  if (legacyPresets.length > 0) {
    console.log(`[Preset] Loaded ${legacyPresets.length} legacy toolkit preset(s) from ~/.kite/toolkit-presets`)
  }

  return Array.from(merged.values())
}

function ensurePresetsDir(): string {
  const presetsDir = getPresetsDir()
  if (!existsSync(presetsDir)) {
    mkdirSync(presetsDir, { recursive: true })
    if (existsSync(getLegacyToolkitPresetsDir())) {
      console.log('[Preset] Using new custom preset directory ~/.kite/presets (legacy toolkit-presets still readable)')
    }
  }
  return presetsDir
}

// ============================================
// Public API
// ============================================

export function listPresets(): ResourceBundlePreset[] {
  return [...BUILTIN_PRESETS, ...loadCustomPresets()]
}

export function getPreset(presetId: string): ResourceBundlePreset | null {
  return listPresets().find(p => p.id === presetId) ?? null
}

export function savePreset(
  name: string,
  description: string,
  resources: ResourceRef[] | SpaceToolkit
): ResourceBundlePreset {
  const presetsDir = ensurePresetsDir()

  const id = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const normalizedResources = Array.isArray(resources)
    ? resources.map((item) => normalizeResourceRef(item))
    : toolkitToResourceRefs(resources)
  const preset: ResourceBundlePreset = { id, name, description, resources: normalizedResources, readOnly: false }

  const filePath = join(presetsDir, `${id.replace(':', '-')}.json`)
  writeFileSync(filePath, JSON.stringify(preset, null, 2))
  console.log(`[Preset] Saved custom preset: ${name} → ${filePath}`)
  return preset
}
