/**
 * Shared helpers for building DirectiveRef from resource definitions.
 *
 * Extracted from duplicated code across AgentsPanel, SkillsPanel,
 * CommandsPanel, ResourceCard, and WorkflowEditorModal.
 */

import type { DirectiveRef, DirectiveType } from '../types'

interface ResourceLike {
  name: string
  namespace?: string
  source?: string
}

/**
 * Build a DirectiveRef from a skill/agent/command definition.
 * The `id` is left empty so the toolkit service can compute a normalized one.
 */
export function buildDirective(type: DirectiveType, resource: ResourceLike): DirectiveRef {
  return {
    id: '',
    type,
    name: resource.name,
    namespace: resource.namespace,
    source: resource.source
  }
}

/**
 * Format a DirectiveRef for display.
 * Agents get @ prefix, skills/commands get / prefix.
 */
export function formatDirectiveName(ref: DirectiveRef): string {
  const baseName = ref.namespace ? `${ref.namespace}:${ref.name}` : ref.name
  if (ref.type === 'agent') return `@${baseName}`
  return `/${baseName}`
}
