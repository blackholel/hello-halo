import { describe, expect, it } from 'vitest'
import { shouldShowStarterActions } from '../../../../../src/renderer/components/chat/InputArea'

describe('shouldShowStarterActions', () => {
  it('returns true when composer is clean and idle', () => {
    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(true)
  })

  it('returns false when there is any user input context', () => {
    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: 'draft',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(false)

    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 1,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(false)

    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 1,
      fileContextCount: 0
    })).toBe(false)

    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 1
    })).toBe(false)
  })

  it('returns false during generation and onboarding send step', () => {
    expect(shouldShowStarterActions({
      isGenerating: true,
      isOnboardingSendStep: false,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(false)

    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: true,
      hasConversationStarted: false,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(false)
  })

  it('returns false once conversation has started', () => {
    expect(shouldShowStarterActions({
      isGenerating: false,
      isOnboardingSendStep: false,
      hasConversationStarted: true,
      content: '',
      selectedResourceChipCount: 0,
      imageCount: 0,
      fileContextCount: 0
    })).toBe(false)
  })
})
