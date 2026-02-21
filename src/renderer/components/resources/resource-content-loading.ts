export interface ShouldLoadResourceContentInput {
  isOpen: boolean
  hasContent: boolean
  hasError: boolean
  hasAttemptedInCurrentOpen: boolean
}

export function shouldLoadResourceContent(input: ShouldLoadResourceContentInput): boolean {
  if (!input.isOpen) return false
  if (input.hasContent && !input.hasError) return false
  if (input.hasAttemptedInCurrentOpen) return false
  return true
}
