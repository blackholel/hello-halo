import { SCENE_TAGS, type SceneTag, isSceneTag } from '../../shared/extension-taxonomy'
import { getFrontmatterStringArray, stripFrontmatter, type ResourceFrontmatter } from './resource-metadata.service'

interface ResolveSceneTagInput {
  name?: string
  description?: string
  category?: string
  triggers?: string[]
  content?: string
  frontmatter?: ResourceFrontmatter
}

const TAG_KEYWORDS: Record<SceneTag, string[]> = {
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

function normalizeSceneTags(value: unknown): SceneTag[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;,]/)
      : []

  const deduped: SceneTag[] = []
  const seen = new Set<SceneTag>()

  for (const item of rawValues) {
    if (typeof item !== 'string') continue
    const normalized = item.trim().toLowerCase()
    if (!isSceneTag(normalized)) continue
    if (seen.has(normalized)) continue
    deduped.push(normalized)
    seen.add(normalized)
    if (deduped.length >= 3) break
  }

  return deduped
}

function extractExplicitSceneTags(frontmatter?: ResourceFrontmatter): SceneTag[] {
  if (!frontmatter) return []

  const direct = normalizeSceneTags(frontmatter.sceneTags)
  if (direct.length > 0) return direct

  return normalizeSceneTags(frontmatter.scene_tags)
}

function scoreText(scores: Record<SceneTag, number>, text: string, weight: number): void {
  const normalized = text.toLowerCase()
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)

  for (const tag of SCENE_TAGS) {
    for (const keyword of TAG_KEYWORDS[tag]) {
      const normalizedKeyword = keyword.toLowerCase()
      const matched = CJK_CHAR_REGEX.test(normalizedKeyword)
        ? normalized.includes(normalizedKeyword)
        : hasAsciiKeywordMatch(tokens, tokenSet, normalized, normalizedKeyword)

      if (matched) {
        scores[tag] += weight
      }
    }
  }
}

export function inferSceneTags(input: ResolveSceneTagInput): SceneTag[] {
  const scores: Record<SceneTag, number> = {
    coding: 0,
    writing: 0,
    design: 0,
    data: 0,
    web: 0,
    office: 0
  }

  if (input.name) scoreText(scores, input.name, 2)
  if (input.description) scoreText(scores, input.description, 2)
  if (input.category) scoreText(scores, input.category, 3)
  if (input.triggers && input.triggers.length > 0) {
    scoreText(scores, input.triggers.join(' '), 2)
  }

  if (input.frontmatter) {
    const categoryAliases = getFrontmatterStringArray(input.frontmatter, ['category', 'categories'])
    if (categoryAliases && categoryAliases.length > 0) {
      scoreText(scores, categoryAliases.join(' '), 2)
    }
  }

  if (input.content) {
    const body = stripFrontmatter(input.content)
    scoreText(scores, body.slice(0, 1200), 1)
  }

  return [...SCENE_TAGS]
    .filter((tag) => scores[tag] > 0)
    .sort((a, b) => {
      const diff = scores[b] - scores[a]
      if (diff !== 0) return diff
      return SCENE_TAGS.indexOf(a) - SCENE_TAGS.indexOf(b)
    })
    .slice(0, 3)
}

export function resolveSceneTags(input: ResolveSceneTagInput): SceneTag[] {
  const explicit = extractExplicitSceneTags(input.frontmatter)
  if (explicit.length > 0) {
    return explicit
  }

  const inferred = inferSceneTags(input)
  if (inferred.length > 0) {
    return inferred
  }

  return ['office']
}
