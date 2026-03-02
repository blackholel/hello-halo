export interface ResourceDisplayNameInput {
  name: string
  displayName?: string
  namespace?: string
}

export function getResourceDisplayName(input: ResourceDisplayNameInput): string {
  const base = input.displayName || input.name
  return input.namespace ? `${input.namespace}:${base}` : base
}
