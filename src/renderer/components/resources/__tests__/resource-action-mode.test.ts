import { describe, expect, it, vi } from 'vitest'
import { copyResourceWithConflict, resolveActionButtonState } from '../resource-actions'

const t = (key: string): string => key

describe('resource action mode', () => {
  it('toolkit 模式文案与禁用态正确', () => {
    expect(resolveActionButtonState({
      actionMode: 'toolkit',
      t,
      hasToolkit: false,
      inToolkit: false
    })).toMatchObject({
      show: true,
      label: 'Activate in space',
      disabled: false
    })

    expect(resolveActionButtonState({
      actionMode: 'toolkit',
      t,
      hasToolkit: true,
      inToolkit: false
    })).toMatchObject({
      label: 'Add to toolkit'
    })

    expect(resolveActionButtonState({
      actionMode: 'toolkit',
      t,
      hasToolkit: true,
      inToolkit: true
    })).toMatchObject({
      label: 'Remove from toolkit'
    })

    expect(resolveActionButtonState({
      actionMode: 'toolkit',
      t,
      hasToolkit: true,
      inToolkit: false,
      isActionInProgress: true
    })).toMatchObject({
      label: 'Loading...',
      disabled: true
    })

    expect(resolveActionButtonState({
      actionMode: 'toolkit',
      t,
      hasToolkit: true,
      inToolkit: false,
      isActionDisabled: true
    })).toMatchObject({
      disabled: true
    })
  })

  it('copy-to-space 冲突覆盖分支正确', async () => {
    const copyFn = vi.fn(async (overwrite?: boolean) => {
      if (!overwrite) {
        return {
          success: true,
          data: { status: 'conflict' as const }
        }
      }
      return {
        success: true,
        data: { status: 'copied' as const }
      }
    })

    const confirmFn = vi.fn(() => true)
    const copied = await copyResourceWithConflict({
      copyFn,
      confirmFn,
      conflictMessage: 'Already added. Overwrite existing resource?'
    })

    expect(copied).toBe(true)
    expect(copyFn).toHaveBeenNthCalledWith(1, false)
    expect(copyFn).toHaveBeenNthCalledWith(2, true)
    expect(confirmFn).toHaveBeenCalledTimes(1)
  })

  it('workDir 缺失时 copy-to-space 禁用', () => {
    const state = resolveActionButtonState({
      actionMode: 'copy-to-space',
      t,
      isActionDisabled: true,
      actionDisabledReason: 'No space selected'
    })

    expect(state.show).toBe(true)
    expect(state.label).toBe('Add to space')
    expect(state.disabled).toBe(true)
    expect(state.reason).toBe('No space selected')
  })

  it('none 模式不渲染动作按钮', () => {
    const state = resolveActionButtonState({
      actionMode: 'none',
      t
    })

    expect(state.show).toBe(false)
    expect(state.disabled).toBe(true)
  })
})

