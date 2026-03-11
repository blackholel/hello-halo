import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserView: class {},
  BrowserWindow: class {},
}))

import {
  appendSopStep,
  normalizeSopRawEvent,
  type SopRecordedStep,
} from '../../../src/main/services/browser-view.service'

describe('browser SOP recording helpers', () => {
  it('normalizes input event into fill step', () => {
    const step = normalizeSopRawEvent({
      source: 'dom',
      eventType: 'input',
      value: 'alice@example.com',
      target: {
        role: 'textbox',
        name: 'Email',
        inputType: 'text',
      },
    } as any)

    expect(step).toEqual({
      action: 'fill',
      target: {
        role: 'textbox',
        name: 'Email',
      },
      value: 'alice@example.com',
      retries: 3,
    })
  })

  it('redacts password and verification values', () => {
    const passwordStep = normalizeSopRawEvent({
      source: 'dom',
      eventType: 'input',
      value: 'my-password',
      target: {
        role: 'textbox',
        name: 'Password',
        inputType: 'password',
      },
    } as any)

    const otpStep = normalizeSopRawEvent({
      source: 'dom',
      eventType: 'input',
      value: '123456',
      target: {
        role: 'textbox',
        label: '验证码',
        inputType: 'text',
      },
    } as any)

    expect(passwordStep?.value).toBe('{{secret_value}}')
    expect(otpStep?.value).toBe('{{verification_code}}')
  })

  it('merges consecutive fill steps on same semantic target', () => {
    const first: SopRecordedStep = {
      id: 'step-1',
      action: 'fill',
      target: { role: 'textbox', name: 'Email' },
      value: 'a',
      retries: 3,
    }
    const second: SopRecordedStep = {
      id: 'step-2',
      action: 'fill',
      target: { role: 'textbox', name: 'Email' },
      value: 'alice@example.com',
      retries: 3,
    }

    const merged = appendSopStep([first], second)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('step-1')
    expect(merged[0].value).toBe('alice@example.com')
  })
})
