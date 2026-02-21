import { beforeEach, describe, expect, it } from 'vitest'
import { canvasLifecycle } from '../canvas-lifecycle'

describe('canvasLifecycle.openTemplateLibrary', () => {
  beforeEach(async () => {
    await canvasLifecycle.closeAll()
  })

  it('首次打开会创建 template-library tab 并激活', async () => {
    const tabId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )

    const tab = canvasLifecycle.getTab(tabId)
    expect(tab).toBeDefined()
    expect(tab?.type).toBe('template-library')
    expect(tab?.title).toBe('Template Library')
    expect(tab?.templateLibraryTab).toBe('skills')
    expect(tab?.workDir).toBe('/tmp/space-a')
    expect(canvasLifecycle.getActiveTabId()).toBe(tabId)
    expect(canvasLifecycle.getIsOpen()).toBe(true)
  })

  it('同一 workDir 重复打开会复用 tab 并更新目标子页签', async () => {
    const firstId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )

    const secondId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'agents',
      '/tmp/space-a'
    )

    expect(secondId).toBe(firstId)
    const tab = canvasLifecycle.getTab(secondId)
    expect(tab?.templateLibraryTab).toBe('agents')
    expect(canvasLifecycle.getTabs().filter(t => t.type === 'template-library')).toHaveLength(1)
  })

  it('不同 workDir 会创建不同 template-library tab', async () => {
    const firstId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )
    const secondId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-b'
    )

    expect(secondId).not.toBe(firstId)
    expect(canvasLifecycle.getTabs().filter(t => t.type === 'template-library')).toHaveLength(2)
  })
})
