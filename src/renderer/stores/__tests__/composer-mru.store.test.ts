import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSuggestionStableId } from '../../utils/composer-suggestion-ranking'

const MODULE_PATH = '../composer-mru.store'

interface MockStorage {
  getItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
  removeItem: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  key: ReturnType<typeof vi.fn>
  length: number
}

async function loadStoreModule() {
  vi.resetModules()
  return import(MODULE_PATH)
}

function installWindowStorage(storage: MockStorage): void {
  ;(globalThis as { window?: unknown }).window = {
    localStorage: storage
  }
}

function removeWindow(): void {
  delete (globalThis as { window?: unknown }).window
}

describe('composer-mru.store', () => {
  afterEach(() => {
    removeWindow()
    vi.restoreAllMocks()
  })

  it('写入即裁剪：同 space+type 仅保留最近 100 条', async () => {
    removeWindow()
    const store = await loadStoreModule()

    for (let i = 0; i < 120; i += 1) {
      store.touchComposerMru('space-a', 'skill', `skill-${i}`, i)
    }

    const map = store.getComposerMruMap('space-a', 'skill')
    expect(Object.keys(map)).toHaveLength(100)
    expect(map['skill-119']).toBe(119)
    expect(map['skill-20']).toBe(20)
    expect(map['skill-19']).toBeUndefined()
  })

  it('重名跨来源 stableId 不冲突', async () => {
    removeWindow()
    const store = await loadStoreModule()

    const appStableId = buildSuggestionStableId({
      type: 'command',
      source: 'app',
      namespace: 'common',
      name: 'deploy',
      pluginRoot: '/plugins/a'
    })
    const pluginStableId = buildSuggestionStableId({
      type: 'command',
      source: 'plugin',
      namespace: 'common',
      name: 'deploy',
      pluginRoot: '/plugins/a'
    })

    store.touchComposerMru('space-a', 'command', appStableId, 1)
    store.touchComposerMru('space-a', 'command', pluginStableId, 2)

    const map = store.getComposerMruMap('space-a', 'command')
    expect(Object.keys(map)).toHaveLength(2)
    expect(map[appStableId]).toBe(1)
    expect(map[pluginStableId]).toBe(2)
  })

  it('localStorage 损坏时回退空状态并覆盖坏数据', async () => {
    const getItem = vi.fn(() => '{broken json')
    const setItem = vi.fn()
    installWindowStorage({
      getItem,
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0
    })

    const store = await loadStoreModule()
    const map = store.getComposerMruMap('space-a', 'agent')

    expect(map).toEqual({})
    expect(setItem).toHaveBeenCalledWith('kite-composer-mru-v1', '{}')
  })
})
