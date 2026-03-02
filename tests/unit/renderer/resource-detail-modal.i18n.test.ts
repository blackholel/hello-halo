import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../../src/renderer/components/chat/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => React.createElement('div', null, content)
}))

vi.mock('../../../src/renderer/stores/skills.store', () => ({
  useSkillsStore: () => ({
    loadSkillContent: vi.fn(async () => null),
    deleteSkill: vi.fn(async () => true),
    copyToSpace: vi.fn(async () => ({ status: 'copied' }))
  })
}))

vi.mock('../../../src/renderer/stores/space.store', () => ({
  useSpaceStore: () => ({
    currentSpace: null,
    updateSpacePreferences: vi.fn(async () => true)
  })
}))

vi.mock('../../../src/renderer/stores/agents.store', () => ({
  useAgentsStore: () => ({
    loadAgentContent: vi.fn(async () => null),
    deleteAgent: vi.fn(async () => true),
    copyToSpace: vi.fn(async () => ({ status: 'copied' }))
  })
}))

import { SkillDetailModal } from '../../../src/renderer/components/skills/SkillDetailModal'
import { AgentDetailModal } from '../../../src/renderer/components/agents/AgentDetailModal'

describe('resource detail modal i18n title', () => {
  it('SkillDetailModal 标题使用本地化 displayName', () => {
    const html = renderToStaticMarkup(
      React.createElement(SkillDetailModal, {
        skill: {
          name: 'review',
          displayName: '代码审查',
          namespace: 'toolkit',
          path: '/tmp/.claude/skills/review/SKILL.md',
          source: 'space',
          exposure: 'runtime-direct'
        },
        workDir: '/tmp',
        onClose: () => undefined
      })
    )

    expect(html).toContain('/toolkit:代码审查')
  })

  it('AgentDetailModal 标题使用本地化 displayName', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentDetailModal, {
        agent: {
          name: 'planner',
          displayName: '规划助手',
          namespace: 'ops',
          path: '/tmp/.claude/agents/planner.md',
          source: 'space',
          exposure: 'runtime-direct'
        },
        workDir: '/tmp',
        onClose: () => undefined
      })
    )

    expect(html).toContain('@ops:规划助手')
  })
})
