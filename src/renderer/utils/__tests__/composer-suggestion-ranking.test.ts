import { describe, expect, it } from 'vitest'
import {
  buildGlobalExpandStateKey,
  buildSuggestionStableId,
  buildVisibleSuggestions,
  rankSuggestions,
  shouldResetGlobalExpandState
} from '../composer-suggestion-ranking'
import type { ComposerResourceSuggestionItem } from '../composer-suggestion-types'

function createResourceItem(input: Partial<ComposerResourceSuggestionItem> & {
  id: string
  stableId: string
  displayName: string
}): ComposerResourceSuggestionItem {
  return {
    kind: 'resource',
    id: input.id,
    stableId: input.stableId,
    type: input.type || 'skill',
    source: input.source || 'space',
    scope: input.scope || (input.source === 'space' ? 'space' : 'global'),
    displayName: input.displayName,
    insertText: input.insertText || `/${input.displayName}`,
    keywords: input.keywords || [input.displayName],
    description: input.description
  }
}

describe('composer-suggestion-ranking', () => {
  it('遵循 来源优先级 -> 匹配度 -> MRU -> 字典序', () => {
    const items: ComposerResourceSuggestionItem[] = [
      createResourceItem({
        id: 'global-exact',
        stableId: 'global-exact',
        source: 'global',
        scope: 'global',
        displayName: 'alpha-global',
        keywords: ['alpha']
      }),
      createResourceItem({
        id: 'space-contains',
        stableId: 'space-contains',
        source: 'space',
        scope: 'space',
        displayName: 'zeta-space',
        keywords: ['zeta alpha']
      }),
      createResourceItem({
        id: 'space-exact-low-mru',
        stableId: 'space-exact-low-mru',
        source: 'space',
        scope: 'space',
        displayName: 'alpha-space-low',
        keywords: ['alpha']
      }),
      createResourceItem({
        id: 'space-exact-high-mru',
        stableId: 'space-exact-high-mru',
        source: 'space',
        scope: 'space',
        displayName: 'alpha-space-high',
        keywords: ['alpha']
      })
    ]

    const ranked = rankSuggestions(items, {
      query: 'alpha',
      mruMap: {
        'space-contains': 99999,
        'space-exact-high-mru': 1000,
        'space-exact-low-mru': 10,
        'global-exact': 5000
      }
    })

    expect(ranked.map(item => item.id)).toEqual([
      'space-exact-high-mru',
      'space-exact-low-mru',
      'space-contains',
      'global-exact'
    ])
  })

  it('同来源同匹配等级时按 MRU 排序', () => {
    const items: ComposerResourceSuggestionItem[] = [
      createResourceItem({
        id: 'space-prefix-a',
        stableId: 'space-prefix-a',
        source: 'space',
        displayName: 'alpha-A',
        keywords: ['alpha-a']
      }),
      createResourceItem({
        id: 'space-prefix-b',
        stableId: 'space-prefix-b',
        source: 'space',
        displayName: 'alpha-B',
        keywords: ['alpha-b']
      })
    ]

    const ranked = rankSuggestions(items, {
      query: 'alpha',
      mruMap: {
        'space-prefix-a': 1,
        'space-prefix-b': 2
      }
    })

    expect(ranked.map(item => item.id)).toEqual(['space-prefix-b', 'space-prefix-a'])
  })

  it('同来源同匹配同MRU时按字典序稳定排序', () => {
    const items: ComposerResourceSuggestionItem[] = [
      createResourceItem({
        id: 'b-id',
        stableId: 'b-id',
        source: 'space',
        displayName: 'beta',
        keywords: ['be']
      }),
      createResourceItem({
        id: 'a-id',
        stableId: 'a-id',
        source: 'space',
        displayName: 'alpha',
        keywords: ['al']
      })
    ]

    const ranked = rankSuggestions(items, { query: '' })
    expect(ranked.map(item => item.displayName)).toEqual(['alpha', 'beta'])
  })

  it('来源优先级中 installed 高于 plugin', () => {
    const items: ComposerResourceSuggestionItem[] = [
      createResourceItem({
        id: 'plugin-item',
        stableId: 'plugin-item',
        source: 'plugin',
        scope: 'global',
        displayName: 'same',
        keywords: ['same']
      }),
      createResourceItem({
        id: 'installed-item',
        stableId: 'installed-item',
        source: 'installed',
        scope: 'global',
        displayName: 'same',
        keywords: ['same']
      })
    ]

    const ranked = rankSuggestions(items, { query: 'same' })
    expect(ranked.map(item => item.id)).toEqual(['installed-item', 'plugin-item'])
  })

  it('stableId 包含 source，重名跨来源不冲突', () => {
    const appId = buildSuggestionStableId({
      type: 'skill',
      source: 'app',
      namespace: 'shared',
      name: 'lint',
      pluginRoot: '/plugins/a'
    })
    const spaceId = buildSuggestionStableId({
      type: 'skill',
      source: 'space',
      namespace: 'shared',
      name: 'lint',
      pluginRoot: '/plugins/a'
    })

    expect(appId).not.toBe(spaceId)
  })

  it('构建可见列表时支持 action 行与空分支语义', () => {
    const space = createResourceItem({
      id: 'space-1',
      stableId: 'space-1',
      source: 'space',
      scope: 'space',
      displayName: 'space-only'
    })
    const global = createResourceItem({
      id: 'global-1',
      stableId: 'global-1',
      source: 'global',
      scope: 'global',
      displayName: 'global-only'
    })

    const collapsed = buildVisibleSuggestions({
      spaceSuggestions: [space],
      globalSuggestions: [global],
      expanded: false,
      type: 'skill',
      expandLabel: '显示全局资源 (1)',
      collapseLabel: '收起全局资源',
      expandDescription: '包含应用、插件与共享资源'
    })
    expect(collapsed.map(item => item.kind)).toEqual(['resource', 'action'])
    expect(collapsed[1]).toMatchObject({ kind: 'action', actionId: 'expand-global' })

    const expanded = buildVisibleSuggestions({
      spaceSuggestions: [space],
      globalSuggestions: [global],
      expanded: true,
      type: 'skill',
      expandLabel: '显示全局资源 (1)',
      collapseLabel: '收起全局资源'
    })
    expect(expanded.map(item => item.kind)).toEqual(['resource', 'resource', 'action'])
    expect(expanded[2]).toMatchObject({ kind: 'action', actionId: 'collapse-global' })

    const spaceZeroGlobalPositive = buildVisibleSuggestions({
      spaceSuggestions: [],
      globalSuggestions: [global],
      expanded: false,
      type: 'skill',
      expandLabel: '显示全局资源 (1)',
      collapseLabel: '收起全局资源'
    })
    expect(spaceZeroGlobalPositive).toHaveLength(1)
    expect(spaceZeroGlobalPositive[0]).toMatchObject({ kind: 'action', actionId: 'expand-global' })

    const allZero = buildVisibleSuggestions({
      spaceSuggestions: [],
      globalSuggestions: [],
      expanded: false,
      type: 'skill',
      expandLabel: '显示全局资源 (0)',
      collapseLabel: '收起全局资源'
    })
    expect(allZero).toEqual([])
  })

  it('仅有空间资源时不展示全局 action（权限透传）', () => {
    const onlySpace = buildVisibleSuggestions({
      spaceSuggestions: [
        createResourceItem({
          id: 'space-1',
          stableId: 'space-1',
          source: 'space',
          scope: 'space',
          displayName: 'space-only'
        })
      ],
      globalSuggestions: [],
      expanded: false,
      type: 'agent',
      expandLabel: '显示全局资源 (0)',
      collapseLabel: '收起全局资源'
    })

    expect(onlySpace.every(item => item.kind === 'resource')).toBe(true)
  })

  it('展开状态重置策略：模式/Tab/Space/Query 变化重置，IME 组合态不重置', () => {
    const slashSkillsKey = buildGlobalExpandStateKey({
      spaceId: 's1',
      triggerMode: 'slash',
      tab: 'skills'
    })
    const mentionAgentsKey = buildGlobalExpandStateKey({
      spaceId: 's1',
      triggerMode: 'mention',
      tab: 'agents'
    })
    const slashCommandsKey = buildGlobalExpandStateKey({
      spaceId: 's1',
      triggerMode: 'slash',
      tab: 'commands'
    })

    expect(shouldResetGlobalExpandState({
      prevStateKey: slashSkillsKey,
      nextStateKey: mentionAgentsKey,
      prevQuery: 'a',
      nextQuery: 'a',
      isComposing: false
    })).toBe(true)

    expect(shouldResetGlobalExpandState({
      prevStateKey: mentionAgentsKey,
      nextStateKey: slashCommandsKey,
      prevQuery: 'a',
      nextQuery: 'a',
      isComposing: false
    })).toBe(true)

    expect(shouldResetGlobalExpandState({
      prevStateKey: slashCommandsKey,
      nextStateKey: slashCommandsKey,
      prevQuery: 'abc',
      nextQuery: 'abcd',
      isComposing: false
    })).toBe(true)

    expect(shouldResetGlobalExpandState({
      prevStateKey: slashCommandsKey,
      nextStateKey: slashCommandsKey,
      prevQuery: 'abc',
      nextQuery: 'abcd',
      isComposing: true
    })).toBe(false)
  })
})
