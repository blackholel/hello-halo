#!/usr/bin/env node
/**
 * Offline sidecar builder for resource display i18n.
 *
 * Modes:
 *   scan   - Collect inventory from local files (no writes)
 *   apply  - Generate and write sidecar files
 *   report - Output entries that need manual review
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SIDECAR_FILE_NAME = 'resource-display.i18n.json'
const DEFAULT_LOCALE = 'zh-CN'

function parseArgs(argv) {
  const args = {
    mode: 'scan',
    root: process.env.KITE_CONFIG_DIR || path.join(os.homedir(), '.kite'),
    locale: DEFAULT_LOCALE,
    out: '',
    workdir: '',
    dryRun: false
  }

  const positional = []
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--root' && argv[i + 1]) {
      args.root = path.resolve(argv[++i])
      continue
    }
    if (token === '--locale' && argv[i + 1]) {
      args.locale = argv[++i]
      continue
    }
    if (token === '--out' && argv[i + 1]) {
      args.out = path.resolve(argv[++i])
      continue
    }
    if (token === '--workdir' && argv[i + 1]) {
      args.workdir = path.resolve(argv[++i])
      continue
    }
    if (token === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (token === '--help' || token === '-h') {
      printHelp()
      process.exit(0)
    }
    positional.push(token)
  }

  if (positional[0]) {
    args.mode = positional[0]
  }

  if (!['scan', 'apply', 'report'].includes(args.mode)) {
    throw new Error(`Invalid mode: ${args.mode}. Expected scan|apply|report`)
  }

  return args
}

function printHelp() {
  console.log(`
Offline sidecar builder for resource display i18n.

Usage:
  node scripts/build-resource-sidecar.mjs scan
  node scripts/build-resource-sidecar.mjs apply --locale zh-CN
  node scripts/build-resource-sidecar.mjs report --out /tmp/sidecar-review.json

Options:
  --root <path>      Kite root path (default: ~/.kite or $KITE_CONFIG_DIR)
  --locale <code>    Target locale (default: zh-CN)
  --workdir <path>   Current space path. If provided and contains .claude, include it
  --out <path>       Output JSON path for scan/report summary
  --dry-run          Do not write files in apply mode
`)
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function resolveGlobalPath(value) {
  return value.startsWith('/') ? value : path.join(os.homedir(), value)
}

function loadEnabledPlugins(root) {
  const settingsPath = path.join(root, 'settings.json')
  const registryPath = path.join(root, 'plugins', 'installed_plugins.json')

  const settings = readJson(settingsPath, {})
  const enabledMap = settings?.enabledPlugins && typeof settings.enabledPlugins === 'object'
    ? settings.enabledPlugins
    : null

  const registry = readJson(registryPath, { plugins: {} })
  const pluginsObj = registry?.plugins && typeof registry.plugins === 'object' ? registry.plugins : {}

  const installed = []
  for (const [fullName, installations] of Object.entries(pluginsObj)) {
    const first = Array.isArray(installations) ? installations[0] : null
    if (!first || typeof first.installPath !== 'string') continue
    const [name] = fullName.split('@')
    installed.push({ fullName, name: name || fullName, installPath: first.installPath })
  }

  if (!enabledMap || Object.keys(enabledMap).length === 0) {
    return installed
  }

  return installed.filter((plugin) => enabledMap[plugin.fullName] === true)
}

function discoverRoots(args) {
  const config = readJson(path.join(args.root, 'config.json'), {})
  const roots = new Map()

  const addRoot = (id, value) => {
    roots.set(id, value)
  }

  addRoot(`app:${args.root}`, {
    source: 'app',
    rootPath: args.root,
    namespace: undefined,
    workDir: undefined
  })

  const globalSkillPaths = config?.claudeCode?.plugins?.globalPaths || []
  for (const rawPath of globalSkillPaths) {
    const rootPath = resolveGlobalPath(rawPath)
    addRoot(`global:${rootPath}`, {
      source: 'global',
      rootPath,
      namespace: undefined,
      workDir: undefined
    })
  }

  const globalAgentPaths = config?.claudeCode?.agents?.paths || []
  for (const rawPath of globalAgentPaths) {
    const rootPath = resolveGlobalPath(rawPath)
    addRoot(`global:${rootPath}`, {
      source: 'global',
      rootPath,
      namespace: undefined,
      workDir: undefined
    })
  }

  for (const plugin of loadEnabledPlugins(args.root)) {
    addRoot(`plugin:${plugin.installPath}`, {
      source: 'plugin',
      rootPath: plugin.installPath,
      namespace: plugin.name,
      workDir: undefined
    })
  }

  if (args.workdir) {
    const claudeRoot = path.join(args.workdir, '.claude')
    if (fs.existsSync(claudeRoot) && fs.statSync(claudeRoot).isDirectory()) {
      addRoot(`space:${claudeRoot}`, {
        source: 'space',
        rootPath: claudeRoot,
        namespace: undefined,
        workDir: args.workdir
      })
    }
  }

  return Array.from(roots.values())
}

function walkFiles(dirPath, predicate, results = []) {
  if (!fs.existsSync(dirPath)) return results
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results)
      continue
    }
    if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath)
    }
  }
  return results
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const result = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const value = (kv[2] || '').trim()
    result[key] = value
  }
  return result
}

function stripFrontmatter(content) {
  if (!content.startsWith('---\n')) return content
  const idx = content.indexOf('\n---\n')
  if (idx < 0) return content
  return content.slice(idx + 5)
}

function firstBodyLine(content) {
  const body = stripFrontmatter(content)
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.match(/^#+\s+(.+)$/)
    if (heading) return heading[1].trim().slice(0, 120)
    return line.slice(0, 120)
  }
  return ''
}

const phraseMap = new Map(Object.entries({
  'code review': '代码审查',
  'best practices': '最佳实践',
  'data analysis': '数据分析',
  'web design': '网页设计',
  'frontend design': '前端设计',
  'template library': '模板库'
}))

const tokenMap = new Map(Object.entries({
  skill: '技能',
  skills: '技能',
  agent: '代理',
  agents: '代理',
  command: '命令',
  commands: '命令',
  review: '审查',
  code: '代码',
  tests: '测试',
  test: '测试',
  plan: '计划',
  planning: '规划',
  execute: '执行',
  execution: '执行',
  workflow: '工作流',
  debug: '调试',
  debugging: '调试',
  design: '设计',
  docs: '文档',
  document: '文档',
  translation: '翻译',
  browser: '浏览器',
  search: '搜索'
}))

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(value)
}

function looksLikeCode(value) {
  return /[`{}$]|\b[A-Z_]{2,}\b|--[a-z]|\/[a-zA-Z0-9._:-]+/.test(value)
}

function offlineTranslate(text) {
  const source = (text || '').trim()
  if (!source) return { translated: '', needsReview: false }
  if (containsCjk(source)) return { translated: source, needsReview: false }
  if (looksLikeCode(source)) return { translated: source, needsReview: true }

  const lower = source.toLowerCase()
  if (phraseMap.has(lower)) {
    return { translated: phraseMap.get(lower), needsReview: false }
  }

  const tokens = source.split(/(\s+|[-_/,:()\[\]])/)
  let translatedCount = 0
  const out = tokens.map((token) => {
    const normalized = token.trim().toLowerCase()
    if (!normalized || !tokenMap.has(normalized)) return token
    translatedCount += 1
    const translated = tokenMap.get(normalized)
    if (/^[A-Z]/.test(token) && translated) {
      return translated
    }
    return translated || token
  })

  const translated = out.join('').replace(/\s+/g, ' ').trim()
  const words = source.split(/\s+/).filter(Boolean).length
  const ratio = words > 0 ? translatedCount / words : 0

  if (!translated || ratio < 0.35) {
    return { translated: source, needsReview: true }
  }

  return { translated, needsReview: ratio < 0.75 }
}

function collectResources(roots) {
  const items = []

  for (const root of roots) {
    const skillsDir = path.join(root.rootPath, 'skills')
    const agentsDir = path.join(root.rootPath, 'agents')
    const commandsDir = path.join(root.rootPath, 'commands')

    const skillFiles = walkFiles(skillsDir, (p) => path.basename(p) === 'SKILL.md')
    const agentFiles = walkFiles(agentsDir, (p) => p.endsWith('.md'))
    const commandFiles = walkFiles(commandsDir, (p) => p.endsWith('.md'))

    for (const filePath of skillFiles) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const frontmatter = parseFrontmatter(content) || {}
      const name = path.basename(path.dirname(filePath))
      const key = root.namespace ? `${root.namespace}:${name}` : name
      const titleEn = (frontmatter.name || frontmatter.title || name || '').trim()
      const descriptionEn = (frontmatter.description || firstBodyLine(content) || '').trim()
      items.push({
        type: 'skill',
        key,
        name,
        filePath,
        source: root.source,
        rootPath: root.rootPath,
        titleEn,
        descriptionEn
      })
    }

    for (const filePath of agentFiles) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const frontmatter = parseFrontmatter(content) || {}
      const name = path.basename(filePath, '.md')
      const key = root.namespace ? `${root.namespace}:${name}` : name
      const titleEn = (frontmatter.name || frontmatter.title || name || '').trim()
      const descriptionEn = (frontmatter.description || firstBodyLine(content) || '').trim()
      items.push({
        type: 'agent',
        key,
        name,
        filePath,
        source: root.source,
        rootPath: root.rootPath,
        titleEn,
        descriptionEn
      })
    }

    for (const filePath of commandFiles) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const frontmatter = parseFrontmatter(content) || {}
      const name = path.basename(filePath, '.md')
      const key = root.namespace ? `${root.namespace}:${name}` : name
      const titleEn = (frontmatter.name || frontmatter.title || name || '').trim()
      const descriptionEn = (frontmatter.description || firstBodyLine(content) || '').trim()
      items.push({
        type: 'command',
        key,
        name,
        filePath,
        source: root.source,
        rootPath: root.rootPath,
        titleEn,
        descriptionEn
      })
    }
  }

  return items
}

function buildLocalizedEntries(items, locale) {
  return items.map((item) => {
    const titleZh = offlineTranslate(item.titleEn)
    const descriptionZh = offlineTranslate(item.descriptionEn)
    return {
      ...item,
      locale,
      titleZh: titleZh.translated,
      descriptionZh: descriptionZh.translated,
      needsReview: titleZh.needsReview || descriptionZh.needsReview
    }
  })
}

function buildSidecarByRoot(entries, locale) {
  const byRoot = new Map()

  for (const entry of entries) {
    if (!byRoot.has(entry.rootPath)) {
      byRoot.set(entry.rootPath, {
        version: 1,
        defaultLocale: 'en',
        resources: {
          skills: {},
          agents: {},
          commands: {}
        }
      })
    }

    const sidecar = byRoot.get(entry.rootPath)
    const section = entry.type === 'skill'
      ? sidecar.resources.skills
      : entry.type === 'agent'
        ? sidecar.resources.agents
        : sidecar.resources.commands

    section[entry.key] = {
      title: {
        en: entry.titleEn,
        [locale]: entry.titleZh || entry.titleEn
      },
      description: {
        en: entry.descriptionEn,
        [locale]: entry.descriptionZh || entry.descriptionEn
      }
    }
  }

  return byRoot
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function summarize(entries) {
  const counts = {
    total: entries.length,
    skills: entries.filter(item => item.type === 'skill').length,
    agents: entries.filter(item => item.type === 'agent').length,
    commands: entries.filter(item => item.type === 'command').length,
    needsReview: entries.filter(item => item.needsReview).length
  }
  return counts
}

function outputJson(data, outPath) {
  if (outPath) {
    writeJson(outPath, data)
    console.log(`[sidecar] wrote: ${outPath}`)
    return
  }
  console.log(JSON.stringify(data, null, 2))
}

function runScan(entries, args) {
  outputJson({
    locale: args.locale,
    summary: summarize(entries),
    items: entries
  }, args.out)
}

function runReport(entries, args) {
  const pending = entries.filter(item => item.needsReview)
  outputJson({
    locale: args.locale,
    summary: summarize(entries),
    pendingCount: pending.length,
    pending
  }, args.out)
}

function runApply(entries, args) {
  const sidecars = buildSidecarByRoot(entries, args.locale)
  let changed = 0

  for (const [rootPath, sidecar] of sidecars.entries()) {
    const outputPath = path.join(rootPath, 'i18n', SIDECAR_FILE_NAME)
    if (args.dryRun) {
      console.log(`[sidecar] dry-run write: ${outputPath}`)
      changed += 1
      continue
    }
    writeJson(outputPath, sidecar)
    changed += 1
  }

  const summary = summarize(entries)
  console.log(`[sidecar] mode=apply locale=${args.locale} roots=${sidecars.size} changed=${changed}`)
  console.log(`[sidecar] total=${summary.total} skills=${summary.skills} agents=${summary.agents} commands=${summary.commands} needsReview=${summary.needsReview}`)

  if (args.out) {
    const pending = entries.filter(item => item.needsReview)
    outputJson({ locale: args.locale, summary, pending }, args.out)
  }
}

function main() {
  const args = parseArgs(process.argv)

  if (!fs.existsSync(args.root)) {
    throw new Error(`Kite root does not exist: ${args.root}`)
  }

  const roots = discoverRoots(args)
  const resources = collectResources(roots)
  const entries = buildLocalizedEntries(resources, args.locale)

  if (args.mode === 'scan') {
    runScan(entries, args)
    return
  }

  if (args.mode === 'report') {
    runReport(entries, args)
    return
  }

  runApply(entries, args)
}

main()
