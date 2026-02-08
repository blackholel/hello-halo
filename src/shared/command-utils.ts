export function commandKey(cmd: { name: string; namespace?: string }): string {
  return cmd.namespace ? `${cmd.namespace}:${cmd.name}` : cmd.name
}
