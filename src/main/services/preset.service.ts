/**
 * Preset Service - Manages toolkit presets (read-only templates)
 *
 * Presets are reusable SpaceToolkit snapshots. Built-in presets are read-only.
 * Users can save current toolkit as a custom preset for reuse.
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { getKiteDir } from './config.service'
import type { DirectiveRef } from './agent/types'
import type { SpaceToolkit } from './space-config.service'

export interface ToolkitPreset {
  id: string
  name: string
  description: string
  resources: SpaceToolkit
  systemPromptAppend?: string
  readOnly: boolean
}

// ============================================
// Built-in Presets
// ============================================

function ref(type: DirectiveRef['type'], name: string): DirectiveRef {
  return { id: `${type}:-:-:${name}`, type, name }
}

const BUILTIN_PRESETS: ToolkitPreset[] = [
  {
    id: 'preset:code-review',
    name: 'Code Review',
    description: 'Code review workflow with quality and security checks',
    resources: {
      skills: [ref('skill', 'coding-standards'), ref('skill', 'security-review')],
      commands: [ref('command', 'review')],
      agents: [ref('agent', 'code-reviewer'), ref('agent', 'security-reviewer')]
    },
    readOnly: true
  },
  {
    id: 'preset:tdd',
    name: 'TDD Workflow',
    description: 'Test-driven development with test-first methodology',
    resources: {
      skills: [ref('skill', 'tdd-workflow'), ref('skill', 'coding-standards')],
      commands: [],
      agents: [ref('agent', 'tdd-guide'), ref('agent', 'debugger')]
    },
    readOnly: true
  },
  {
    id: 'preset:full-stack',
    name: 'Full Stack',
    description: 'Frontend and backend development patterns',
    resources: {
      skills: [ref('skill', 'frontend-patterns'), ref('skill', 'backend-patterns'), ref('skill', 'coding-standards')],
      commands: [],
      agents: [ref('agent', 'code-reviewer'), ref('agent', 'build-error-resolver')]
    },
    readOnly: true
  }
]

// ============================================
// Custom Presets (stored in ~/.kite/toolkit-presets/)
// ============================================

function getPresetsDir(): string {
  return join(getKiteDir(), 'toolkit-presets')
}

function loadCustomPresets(): ToolkitPreset[] {
  const presetsDir = getPresetsDir()
  if (!existsSync(presetsDir)) return []

  try {
    const presets: ToolkitPreset[] = []
    for (const file of readdirSync(presetsDir).filter(f => f.endsWith('.json'))) {
      try {
        const preset = JSON.parse(readFileSync(join(presetsDir, file), 'utf-8')) as ToolkitPreset
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

// ============================================
// Public API
// ============================================

export function listPresets(): ToolkitPreset[] {
  return [...BUILTIN_PRESETS, ...loadCustomPresets()]
}

export function getPreset(presetId: string): ToolkitPreset | null {
  return listPresets().find(p => p.id === presetId) ?? null
}

export function savePreset(name: string, description: string, toolkit: SpaceToolkit): ToolkitPreset {
  const presetsDir = getPresetsDir()
  mkdirSync(presetsDir, { recursive: true })

  const id = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const preset: ToolkitPreset = { id, name, description, resources: toolkit, readOnly: false }

  const filePath = join(presetsDir, `${id.replace(':', '-')}.json`)
  writeFileSync(filePath, JSON.stringify(preset, null, 2))
  console.log(`[Preset] Saved custom preset: ${name} → ${filePath}`)
  return preset
}
