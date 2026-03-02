import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/resource-display-i18n.service', () => ({
  RESOURCE_DISPLAY_I18N_FILE_NAME: 'resource-display.i18n.json',
  clearResourceDisplayI18nCache: vi.fn(),
  getResourceDisplayI18nRoots: vi.fn(() => [
    { rootPath: '/home/test/.kite' },
    { rootPath: '/workspace/project-a/.claude', workDir: '/workspace/project-a' }
  ])
}))

vi.mock('electron', () => ({}))

import { _testGetDisplayI18nWatchTargets } from '../../../src/main/services/skills-agents-watch.service'

describe('skills-agents-watch display i18n targets', () => {
  it('resolves root/i18n/file watch targets for global and space roots', () => {
    const targets = _testGetDisplayI18nWatchTargets()
    expect(targets).toEqual([
      {
        rootPath: '/home/test/.kite',
        i18nDirPath: '/home/test/.kite/i18n',
        sidecarPath: '/home/test/.kite/i18n/resource-display.i18n.json'
      },
      {
        rootPath: '/workspace/project-a/.claude',
        i18nDirPath: '/workspace/project-a/.claude/i18n',
        sidecarPath: '/workspace/project-a/.claude/i18n/resource-display.i18n.json',
        workDir: '/workspace/project-a'
      }
    ])
  })
})
