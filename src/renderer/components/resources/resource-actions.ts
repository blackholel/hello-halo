import type { ResourceActionMode } from './types'

type Translate = (key: string) => string

export interface ActionButtonStateInput {
  actionMode: ResourceActionMode
  t: Translate
  hasToolkit?: boolean
  inToolkit?: boolean
  isActionDisabled?: boolean
  actionDisabledReason?: string
  isActionInProgress?: boolean
}

export interface ActionButtonState {
  show: boolean
  label: string
  disabled: boolean
  reason?: string
}

export interface CopyResourceResult {
  status: 'copied' | 'conflict' | 'not_found'
}

export interface CopyResourceResponse {
  success: boolean
  data?: CopyResourceResult
}

interface CopyWithConflictOptions {
  copyFn: (overwrite?: boolean) => Promise<CopyResourceResponse>
  confirmFn: (message: string) => boolean
  conflictMessage: string
}

export async function copyResourceWithConflict(options: CopyWithConflictOptions): Promise<boolean> {
  const first = await options.copyFn(false)
  if (!first.success || !first.data) return false

  if (first.data.status === 'copied') return true
  if (first.data.status !== 'conflict') return false

  if (!options.confirmFn(options.conflictMessage)) return false

  const second = await options.copyFn(true)
  return !!(second.success && second.data?.status === 'copied')
}

export function resolveActionButtonState(input: ActionButtonStateInput): ActionButtonState {
  if (input.actionMode === 'none') {
    return {
      show: false,
      label: '',
      disabled: true
    }
  }

  if (input.actionMode === 'toolkit') {
    const label = input.isActionInProgress
      ? input.t('Loading...')
      : input.hasToolkit
        ? (input.inToolkit ? input.t('Remove from toolkit') : input.t('Add to toolkit'))
        : input.t('Activate in space')

    return {
      show: true,
      label,
      disabled: !!input.isActionDisabled || !!input.isActionInProgress,
      reason: input.actionDisabledReason
    }
  }

  const alreadyAddedLabel = input.t('Already added')
  const isAlreadyAdded = input.actionDisabledReason === alreadyAddedLabel

  return {
    show: true,
    label: input.isActionInProgress
      ? input.t('Loading...')
      : (isAlreadyAdded ? alreadyAddedLabel : input.t('Add to space')),
    disabled: !!input.isActionDisabled || !!input.isActionInProgress,
    reason: input.actionDisabledReason
  }
}

