import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../../types'
import { MessageItem } from '../MessageItem'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('MessageItem file context rendering', () => {
  it('renders file context chips for user message without text content', () => {
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: '',
      timestamp: '2026-03-09T00:00:00.000Z',
      fileContexts: [
        {
          id: 'ctx-1',
          type: 'file-context',
          path: '/tmp/project/README.md',
          name: 'README.md',
          extension: 'md'
        },
        {
          id: 'ctx-2',
          type: 'file-context',
          path: '/tmp/project/src/main.ts',
          name: 'main.ts',
          extension: 'ts'
        }
      ]
    }

    const html = renderToStaticMarkup(React.createElement(MessageItem, { message }))

    expect(html).toContain('README.md')
    expect(html).toContain('main.ts')
    expect(html).toContain('/tmp/project/README.md')
  })
})
