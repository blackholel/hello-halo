/**
 * MessageList Layout Tests (v3)
 *
 * New layout contract:
 * 1. FinalBubble is the only assistant answer container
 * 2. ProcessPanel is a unified process entry (thought/tool/subagent/browser/task)
 * 3. ProcessPanel must render before FinalBubble while generating
 */

import { describe, expect, it } from 'vitest'

interface LayoutConfig {
  isGenerating: boolean
  hasProcessPanel: boolean
  hasFinalBubble: boolean
}

type LayoutElement = 'ProcessPanel' | 'FinalBubble'

function getLayout(config: LayoutConfig): LayoutElement[] {
  const elements: LayoutElement[] = []

  if (config.isGenerating && config.hasProcessPanel) {
    elements.push('ProcessPanel')
  }

  if (config.hasFinalBubble) {
    elements.push('FinalBubble')
  }

  return elements
}

describe('MessageList Layout (v3)', () => {
  it('generating 时 ProcessPanel 在 FinalBubble 之前', () => {
    const layout = getLayout({
      isGenerating: true,
      hasProcessPanel: true,
      hasFinalBubble: true
    })

    expect(layout).toEqual(['ProcessPanel', 'FinalBubble'])
  })

  it('非生成态不再渲染运行中的 ProcessPanel', () => {
    const layout = getLayout({
      isGenerating: false,
      hasProcessPanel: true,
      hasFinalBubble: true
    })

    expect(layout).toEqual(['FinalBubble'])
  })

  it('无过程数据时仅渲染 FinalBubble', () => {
    const layout = getLayout({
      isGenerating: true,
      hasProcessPanel: false,
      hasFinalBubble: true
    })

    expect(layout).toEqual(['FinalBubble'])
  })
})
