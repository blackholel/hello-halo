export type ResourceFrontmatter = Record<string, unknown>

export interface ParsedResourceMetadata {
  frontmatter?: ResourceFrontmatter
  body: string
  description?: string
}

function clampDescription(value: string): string {
  return value.trim().slice(0, 100)
}

export function parseFrontmatter(content: string): ResourceFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const result: ResourceFrontmatter = {}
  let currentKey: string | null = null
  let currentArray: string[] | null = null

  for (const line of match[1].split('\n')) {
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && currentArray) {
        currentArray.push(line.replace(/^\s+-\s+/, '').trim())
      }
      continue
    }

    if (currentKey && currentArray) {
      result[currentKey] = currentArray
      currentArray = null
      currentKey = null
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kvMatch) continue

    const [, key, rawValue] = kvMatch
    const value = rawValue.trim()

    if (value === '') {
      currentKey = key
      currentArray = []
      continue
    }

    result[key] = value
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray
  }

  return result
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content
  }

  const lines = content.split('\n')
  if (lines[0].trim() !== '---') {
    return content
  }

  const maxLinesToCheck = Math.min(lines.length, 1000)
  for (let i = 1; i < maxLinesToCheck; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n')
    }
  }

  return content
}

export function getFrontmatterString(
  frontmatter: ResourceFrontmatter | null | undefined,
  keys: string[]
): string | undefined {
  if (!frontmatter) return undefined

  for (const key of keys) {
    const value = frontmatter[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

export function getFrontmatterStringArray(
  frontmatter: ResourceFrontmatter | null | undefined,
  keys: string[]
): string[] | undefined {
  if (!frontmatter) return undefined

  for (const key of keys) {
    const value = frontmatter[key]
    if (Array.isArray(value)) {
      const result = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
      if (result.length > 0) return result
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const result = value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (result.length > 0) return result
    }
  }

  return undefined
}

export function extractDescriptionFromBody(body: string): string | undefined {
  const lines = body.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const headingMatch = line.match(/^#+\s+(.+)$/)
    if (headingMatch) {
      return clampDescription(headingMatch[1])
    }

    return clampDescription(line)
  }

  return undefined
}

export function extractDescriptionFromContent(content: string): string | undefined {
  const frontmatter = parseFrontmatter(content)
  const frontmatterDescription = getFrontmatterString(frontmatter, ['description'])
  if (frontmatterDescription) {
    return clampDescription(frontmatterDescription)
  }

  const body = stripFrontmatter(content)
  return extractDescriptionFromBody(body)
}

export function parseResourceMetadata(content: string): ParsedResourceMetadata {
  const frontmatter = parseFrontmatter(content) ?? undefined
  const body = stripFrontmatter(content)
  const description = extractDescriptionFromContent(content)

  return {
    frontmatter,
    body,
    description
  }
}
