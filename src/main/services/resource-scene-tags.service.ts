import {
  DEFAULT_SCENE_DEFINITIONS,
  normalizeSceneTagKeys,
  type SceneDefinition,
  type SceneTagKey
} from '../../shared/scene-taxonomy'
import { getFrontmatterStringArray, stripFrontmatter, type ResourceFrontmatter } from './resource-metadata.service'

interface ResolveSceneTagInput {
  name?: string
  description?: string
  category?: string
  triggers?: string[]
  content?: string
  frontmatter?: ResourceFrontmatter
  resourceKey?: string
  definitions?: SceneDefinition[]
  resourceOverrides?: Record<string, SceneTagKey[]>
}

const BUILTIN_TAG_KEYWORDS: Record<string, string[]> = {
  coding: [
    'coding',
    'code',
    'debug',
    'refactor',
    'tdd',
    'test',
    'git',
    'program',
    'typescript',
    'javascript',
    'python',
    '编程',
    '代码',
    '调试',
    '重构',
    '测试'
  ],
  writing: [
    'writing',
    'write',
    'document',
    'blog',
    'translate',
    'copywriting',
    'email',
    '文档',
    '写作',
    '翻译',
    '文案',
    '邮件'
  ],
  design: [
    'design',
    'ui',
    'ux',
    'prototype',
    'figma',
    'visual',
    '创意',
    '设计',
    '原型',
    '可视化'
  ],
  data: [
    'data',
    'analysis',
    'analytics',
    'bi',
    'report',
    'sql',
    'database',
    'spreadsheet',
    '数据',
    '分析',
    '报表',
    '数据库'
  ],
  web: [
    'web',
    'browser',
    'scrape',
    'crawler',
    'api',
    'http',
    'automation',
    '网页',
    '浏览器',
    '抓取',
    '接口',
    '自动化'
  ],
  office: [
    'office',
    'word',
    'excel',
    'ppt',
    'pdf',
    'file',
    'document processing',
    '办公',
    '表格',
    '演示',
    '文稿',
    '文件'
  ]
}

const CJK_CHAR_REGEX = /[\u3400-\u9fff]/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasAsciiKeywordMatch(tokens: string[], tokenSet: Set<string>, normalizedText: string, keyword: string): boolean {
  if (keyword.includes(' ')) {
    const pattern = keyword
      .trim()
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('\\s+')
    return new RegExp(`\\b${pattern}\\b`).test(normalizedText)
  }

  if (tokenSet.has(keyword)) {
    return true
  }

  if (keyword.length >= 4) {
    return tokens.some((token) => token.startsWith(keyword))
  }

  return false
}

function getDefinitions(input: ResolveSceneTagInput): SceneDefinition[] {
  if (input.definitions && input.definitions.length > 0) {
    return input.definitions
  }
  return DEFAULT_SCENE_DEFINITIONS
}

function extractExplicitSceneTags(frontmatter: ResourceFrontmatter | undefined, knownKeys: Set<string>): SceneTagKey[] {
  if (!frontmatter) return []

  const direct = normalizeSceneTagKeys(frontmatter.sceneTags, knownKeys, { fallback: null })
  if (direct.length > 0) return direct

  return normalizeSceneTagKeys(frontmatter.scene_tags, knownKeys, { fallback: null })
}

function buildKeywordMap(definitions: SceneDefinition[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const definition of definitions) {
    const merged = [
      definition.key,
      definition.label.en,
      definition.label.zhCN,
      definition.label.zhTW,
      ...(definition.synonyms || []),
      ...(BUILTIN_TAG_KEYWORDS[definition.key] || [])
    ]
    const normalized = Array.from(new Set(
      merged
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
    ))
    map[definition.key] = normalized
  }
  return map
}

function scoreText(
  scores: Record<string, number>,
  text: string,
  weight: number,
  candidateKeys: string[],
  keywordMap: Record<string, string[]>
): void {
  const normalized = text.toLowerCase()
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)

  for (const key of candidateKeys) {
    for (const keyword of keywordMap[key] || []) {
      const normalizedKeyword = keyword.toLowerCase()
      const matched = CJK_CHAR_REGEX.test(normalizedKeyword)
        ? normalized.includes(normalizedKeyword)
        : hasAsciiKeywordMatch(tokens, tokenSet, normalized, normalizedKeyword)

      if (matched) {
        scores[key] += weight
      }
    }
  }
}

export function inferSceneTags(input: ResolveSceneTagInput): SceneTagKey[] {
  const candidates = getDefinitions(input).filter((item) => item.enabled)
  if (candidates.length === 0) {
    return ['office']
  }

  const candidateKeys = candidates.map((item) => item.key)
  const scores: Record<string, number> = {}
  for (const key of candidateKeys) scores[key] = 0
  const keywordMap = buildKeywordMap(candidates)
  const orderMap = new Map(candidates.map((item) => [item.key, item.order]))

  if (input.name) scoreText(scores, input.name, 2, candidateKeys, keywordMap)
  if (input.description) scoreText(scores, input.description, 2, candidateKeys, keywordMap)
  if (input.category) scoreText(scores, input.category, 3, candidateKeys, keywordMap)
  if (input.triggers && input.triggers.length > 0) {
    scoreText(scores, input.triggers.join(' '), 2, candidateKeys, keywordMap)
  }

  if (input.frontmatter) {
    const categoryAliases = getFrontmatterStringArray(input.frontmatter, ['category', 'categories'])
    if (categoryAliases && categoryAliases.length > 0) {
      scoreText(scores, categoryAliases.join(' '), 2, candidateKeys, keywordMap)
    }
  }

  if (input.content) {
    const body = stripFrontmatter(input.content)
    scoreText(scores, body.slice(0, 1200), 1, candidateKeys, keywordMap)
  }

  return [...candidateKeys]
    .filter((key) => scores[key] > 0)
    .sort((a, b) => {
      const diff = (scores[b] || 0) - (scores[a] || 0)
      if (diff !== 0) return diff
      const orderDiff = (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999)
      if (orderDiff !== 0) return orderDiff
      return a.localeCompare(b)
    })
    .slice(0, 3)
}

export function resolveSceneTags(input: ResolveSceneTagInput): SceneTagKey[] {
  const definitions = getDefinitions(input)
  const knownKeys = new Set(definitions.map((item) => item.key))

  if (input.resourceKey && input.resourceOverrides) {
    const override = input.resourceOverrides[input.resourceKey]
    const normalizedOverride = normalizeSceneTagKeys(override, knownKeys, { fallback: null })
    if (normalizedOverride.length > 0) {
      return normalizedOverride
    }
  }

  const explicit = extractExplicitSceneTags(input.frontmatter, knownKeys)
  if (explicit.length > 0) {
    return explicit
  }

  const inferred = inferSceneTags({
    ...input,
    definitions
  })
  if (inferred.length > 0) {
    return inferred
  }

  if (knownKeys.has('office')) {
    return ['office']
  }

  const firstEnabled = definitions.find((item) => item.enabled)
  if (firstEnabled) {
    return [firstEnabled.key]
  }

  const firstKnown = definitions[0]
  if (firstKnown) {
    return [firstKnown.key]
  }

  return ['office']
}
