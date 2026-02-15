interface NamespacedResource {
  name: string
  namespace?: string
}

export function parseResourceKey(raw: string): NamespacedResource | null {
  const value = raw.trim()
  if (!value) return null

  if (!value.includes(':')) {
    return { name: value }
  }

  const [namespace, name] = value.split(':', 2)
  if (!namespace || !name) return null
  return { namespace, name }
}

export function toResourceKey(resource: NamespacedResource): string {
  return resource.namespace ? `${resource.namespace}:${resource.name}` : resource.name
}

export function normalizeEnabledValues(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const parsed = parseResourceKey(value)
    if (!parsed) continue
    const key = toResourceKey(parsed)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }

  return out
}

export function canonicalizeEnabledForResources<T extends NamespacedResource>(
  enabledValues: string[],
  resources: T[]
): string[] {
  const normalized = normalizeEnabledValues(enabledValues)
  const out: string[] = []
  const seen = new Set<string>()

  for (const value of normalized) {
    const parsed = parseResourceKey(value)
    if (!parsed) continue

    if (parsed.namespace) {
      const key = toResourceKey(parsed)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(key)
      }
      continue
    }

    const sameName = resources.filter(resource => resource.name === parsed.name)
    if (sameName.length === 0) {
      if (!seen.has(parsed.name)) {
        seen.add(parsed.name)
        out.push(parsed.name)
      }
      continue
    }

    for (const resource of sameName) {
      const key = toResourceKey(resource)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }

  return out
}

export function isResourceEnabled<T extends NamespacedResource>(
  enabledValues: string[],
  resource: T
): boolean {
  const parsedEnabled = normalizeEnabledValues(enabledValues)
  const enabledSet = new Set(parsedEnabled)
  const key = toResourceKey(resource)
  return enabledSet.has(key) || enabledSet.has(resource.name)
}

export function toggleEnabledForResource<T extends NamespacedResource>(
  enabledValues: string[],
  resource: T,
  allResources: T[]
): string[] {
  const canonical = canonicalizeEnabledForResources(enabledValues, allResources)
  const key = toResourceKey(resource)
  const enabledSet = new Set(canonical)

  if (enabledSet.has(key)) {
    enabledSet.delete(key)
    return Array.from(enabledSet)
  }

  enabledSet.add(key)
  return Array.from(enabledSet)
}
