export function normalizePathForCompare(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function isDefaultSpacePath(spacePath: string, defaultRoot: string): boolean {
  if (!spacePath || !defaultRoot) {
    return false
  }

  const normalizedPath = normalizePathForCompare(spacePath)
  const normalizedRoot = normalizePathForCompare(defaultRoot)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export type SpacePathKind = 'default' | 'custom' | 'unknown'

export function resolveSpacePathKind(spacePath: string, defaultRoot: string): SpacePathKind {
  if (!spacePath || !defaultRoot) {
    return 'unknown'
  }

  return isDefaultSpacePath(spacePath, defaultRoot) ? 'default' : 'custom'
}

export function shortenDisplayPath(rawPath: string): string {
  const normalizedPath = rawPath.replace(/\\/g, '/')

  if (/^[a-z]:\/users\/[^/]+/i.test(normalizedPath)) {
    return normalizedPath.replace(/^[a-z]:\/users\/[^/]+/i, '~')
  }

  if (/^\/Users\/[^/]+/.test(normalizedPath)) {
    return normalizedPath.replace(/^\/Users\/[^/]+/, '~')
  }

  if (/^\/home\/[^/]+/.test(normalizedPath)) {
    return normalizedPath.replace(/^\/home\/[^/]+/, '~')
  }

  return normalizedPath
}
