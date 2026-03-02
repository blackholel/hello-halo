import { describe, expect, it } from 'vitest'
import { buildComposerResourceSuggestion } from '../../../src/renderer/utils/composer-resource-suggestion'

describe('composer-resource-suggestion', () => {
  it('skills: 展示 displayName，插入英文 key', () => {
    const suggestion = buildComposerResourceSuggestion('skill', {
      name: 'release-check',
      displayName: '发布检查',
      description: 'Release checklist',
      namespace: 'team',
      source: 'space',
      path: '/tmp/.claude/skills/release-check/SKILL.md'
    })

    expect(suggestion.displayName).toBe('team:发布检查')
    expect(suggestion.insertText).toBe('/team:release-check')
  })

  it('agents: 展示 displayName，插入英文 key', () => {
    const suggestion = buildComposerResourceSuggestion('agent', {
      name: 'planner',
      displayName: '规划助手',
      description: 'Plan tasks',
      namespace: 'ops',
      source: 'plugin',
      path: '/tmp/plugins/demo/agents/planner.md',
      pluginRoot: '/tmp/plugins/demo'
    })

    expect(suggestion.displayName).toBe('ops:规划助手')
    expect(suggestion.insertText).toBe('@ops:planner')
    expect(suggestion.scope).toBe('global')
  })

  it('commands: 未知 source 默认按 space 处理', () => {
    const suggestion = buildComposerResourceSuggestion('command', {
      name: 'deploy',
      displayName: '部署',
      source: 'unknown-source',
      path: '/tmp/.claude/commands/deploy.md'
    })

    expect(suggestion.displayName).toBe('部署')
    expect(suggestion.insertText).toBe('/deploy')
    expect(suggestion.scope).toBe('space')
  })
})
