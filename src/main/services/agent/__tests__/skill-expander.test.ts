/**
 * Unit Tests for Skill Expander
 *
 * Tests structured directive expansion, text-based expansion,
 * deduplication, fingerprint validation, and merge logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the service dependencies
vi.mock('../../skills.service', () => ({
  getSkillDefinition: vi.fn((name: string) => {
    const defs: Record<string, { source: string; exposure: 'public' | 'internal-only' }> = {
      'coding-standards': { source: 'app', exposure: 'public' },
      'tdd-workflow': { source: 'app', exposure: 'public' },
      'security-review': { source: 'app', exposure: 'public' },
      'deploy': { source: 'app', exposure: 'public' }
    }
    return defs[name] || null
  }),
  getSkillContent: vi.fn((name: string) => {
    const skills: Record<string, { content: string }> = {
      'coding-standards': { content: '# Coding Standards\nFollow best practices.' },
      'tdd-workflow': { content: '# TDD\nWrite tests first.' },
      'security-review': { content: '# Security\nReview for vulnerabilities.' },
      'deploy': { content: '# Deploy Skill\nDo deploy.' }
    }
    return skills[name] || null
  })
}))

vi.mock('../../commands.service', () => ({
  getCommand: vi.fn((name: string) => {
    const commands: Record<string, { source: string; exposure: 'public' | 'internal-only'; requiresSkills?: string[] }> = {
      review: { source: 'app', exposure: 'public' },
      deploy: { source: 'app', exposure: 'public', requiresSkills: ['deploy'] }
    }
    return commands[name] || null
  }),
  getCommandContent: vi.fn((name: string) => {
    const commands: Record<string, string> = {
      review: '# Review\nPlease review the code.',
      'deploy': '# Deploy\nInvoke the deploy skill.\nUse the deploy skill.'
    }
    return commands[name] || null
  })
}))

vi.mock('../../agents.service', () => ({
  getAgent: vi.fn((name: string) => {
    const defs: Record<string, { source: string; exposure: 'public' | 'internal-only' }> = {
      'code-reviewer': { source: 'app', exposure: 'public' },
      debugger: { source: 'app', exposure: 'public' }
    }
    return defs[name] || null
  }),
  getAgentContent: vi.fn((name: string) => {
    const agents: Record<string, string> = {
      'code-reviewer': '# Code Reviewer Agent\nReview code changes.',
      debugger: '# Debugger Agent\nDebug issues systematically.'
    }
    return agents[name] || null
  })
}))

import {
  expandStructuredDirectives,
  expandLazyDirectives,
  mergeExpansions,
  computeFingerprint,
  stripFrontmatter
} from '../skill-expander'
import type { DirectiveRef } from '../types'

describe('expandStructuredDirectives', () => {
  it('returns empty result for no directives', () => {
    const result = expandStructuredDirectives(undefined)
    expect(result.text).toBe('')
    expect(result.expanded).toEqual({ skills: [], commands: [], agents: [] })
    expect(result.missing).toEqual({ skills: [], commands: [], agents: [] })
  })

  it('returns empty result for empty array', () => {
    const result = expandStructuredDirectives([])
    expect(result.text).toBe('')
  })

  it('expands a skill directive', () => {
    const directives: DirectiveRef[] = [
      { id: 'skill:-:-:coding-standards', type: 'skill', name: 'coding-standards' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toContain('<skill name="coding-standards">')
    expect(result.text).toContain('# Coding Standards')
    expect(result.text).toContain('<!-- injected: skill (structured) -->')
    expect(result.expanded.skills).toEqual(['coding-standards'])
    expect(result.missing.skills).toEqual([])
  })

  it('expands a command directive', () => {
    const directives: DirectiveRef[] = [
      { id: 'command:-:-:review', type: 'command', name: 'review' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toContain('<command name="review">')
    expect(result.expanded.commands).toEqual(['review'])
  })

  it('expands an agent directive', () => {
    const directives: DirectiveRef[] = [
      { id: 'agent:-:-:code-reviewer', type: 'agent', name: 'code-reviewer' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toContain('<task-request name="code-reviewer">')
    expect(result.text).toContain('# Code Reviewer Agent')
    expect(result.expanded.agents).toEqual(['code-reviewer'])
  })

  it('reports missing resources', () => {
    const directives: DirectiveRef[] = [
      { id: 'skill:-:-:nonexistent', type: 'skill', name: 'nonexistent' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toBe('')
    expect(result.missing.skills).toEqual(['nonexistent'])
  })

  it('expands multiple directives', () => {
    const directives: DirectiveRef[] = [
      { id: 's1', type: 'skill', name: 'coding-standards' },
      { id: 'a1', type: 'agent', name: 'debugger' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.expanded.skills).toEqual(['coding-standards'])
    expect(result.expanded.agents).toEqual(['debugger'])
    expect(result.text).toContain('<skill name="coding-standards">')
    expect(result.text).toContain('<task-request name="debugger">')
  })

  it('includes args attribute when provided', () => {
    const directives: DirectiveRef[] = [
      { id: 's1', type: 'skill', name: 'coding-standards', args: 'typescript' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toContain('args="typescript"')
  })

  it('escapes HTML in args', () => {
    const directives: DirectiveRef[] = [
      { id: 's1', type: 'skill', name: 'coding-standards', args: '<script>alert("xss")</script>' }
    ]
    const result = expandStructuredDirectives(directives)
    expect(result.text).toContain('&lt;script&gt;')
    expect(result.text).not.toContain('<script>')
  })
})

describe('expandLazyDirectives with skip', () => {
  it('expands /skill text directives', () => {
    const result = expandLazyDirectives('/coding-standards')
    expect(result.text).toContain('<skill name="coding-standards">')
    expect(result.expanded.skills).toEqual(['coding-standards'])
  })

  it('expands @agent text directives', () => {
    const result = expandLazyDirectives('@code-reviewer')
    expect(result.text).toContain('<task-request name="code-reviewer">')
    expect(result.expanded.agents).toEqual(['code-reviewer'])
  })

  it('skips names in the skip set', () => {
    const skip = new Set(['coding-standards', 'code-reviewer'])
    const input = '/coding-standards\n@code-reviewer\n/tdd-workflow'
    const result = expandLazyDirectives(input, undefined, { skip })
    // coding-standards and code-reviewer should be skipped
    expect(result.expanded.skills).toEqual(['tdd-workflow'])
    expect(result.expanded.agents).toEqual([])
    expect(result.text).toContain('<skill name="tdd-workflow">')
    expect(result.text).not.toContain('<skill name="coding-standards">')
  })

  it('does not expand directives inside code fences', () => {
    const input = '```\n/coding-standards\n```'
    const result = expandLazyDirectives(input)
    expect(result.expanded.skills).toEqual([])
    expect(result.text).toContain('/coding-standards')
  })
})

describe('mergeExpansions', () => {
  it('merges two expansion results', () => {
    const structured = expandStructuredDirectives([
      { id: 's1', type: 'skill', name: 'coding-standards' }
    ])
    const lazy = expandLazyDirectives('/tdd-workflow')

    const merged = mergeExpansions(structured, lazy)
    expect(merged.expanded.skills).toContain('coding-standards')
    expect(merged.expanded.skills).toContain('tdd-workflow')
    expect(merged.text).toContain('<skill name="coding-standards">')
    expect(merged.text).toContain('<skill name="tdd-workflow">')
  })

  it('deduplicates expanded names', () => {
    const a = {
      text: 'a',
      expanded: { skills: ['x'], commands: [], agents: [] },
      missing: { skills: [], commands: [], agents: [] }
    }
    const b = {
      text: 'b',
      expanded: { skills: ['x', 'y'], commands: [], agents: [] },
      missing: { skills: [], commands: [], agents: [] }
    }
    const merged = mergeExpansions(a, b)
    expect(merged.expanded.skills).toEqual(['x', 'y'])
  })

  it('handles empty structured + non-empty lazy', () => {
    const empty = expandStructuredDirectives(undefined)
    const lazy = expandLazyDirectives('/coding-standards')
    const merged = mergeExpansions(empty, lazy)
    expect(merged.expanded.skills).toEqual(['coding-standards'])
  })
})

describe('computeFingerprint', () => {
  it('returns an 8-character hex string', () => {
    const fp = computeFingerprint('Hello World')
    expect(fp).toMatch(/^[a-f0-9]{8}$/)
  })

  it('returns same fingerprint for same content', () => {
    const fp1 = computeFingerprint('test content')
    const fp2 = computeFingerprint('test content')
    expect(fp1).toBe(fp2)
  })

  it('returns different fingerprints for different content', () => {
    const fp1 = computeFingerprint('content A')
    const fp2 = computeFingerprint('content B')
    expect(fp1).not.toBe(fp2)
  })

  it('only uses first 1KB', () => {
    const base = 'x'.repeat(1024)
    const fp1 = computeFingerprint(base)
    const fp2 = computeFingerprint(base + 'extra stuff that should not matter')
    expect(fp1).toBe(fp2)
  })
})

describe('stripFrontmatter', () => {
  it('returns content without frontmatter', () => {
    const input = '---\ntitle: Test\n---\n# Hello'
    expect(stripFrontmatter(input)).toBe('# Hello')
  })

  it('returns content as-is when no frontmatter', () => {
    const input = '# Hello\nWorld'
    expect(stripFrontmatter(input)).toBe(input)
  })

  it('throws for content over 1MB', () => {
    const large = 'x'.repeat(1024 * 1024 + 1)
    expect(() => stripFrontmatter(large)).toThrow('Input too large')
  })
})
