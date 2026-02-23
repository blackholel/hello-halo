#!/usr/bin/env node
/**
 * Batch migrate ~/.kite skills/agents/commands frontmatter to include
 * localized display metadata fields (name_zh-CN, description_zh-CN).
 *
 * Usage:
 *   node scripts/migrate-kite-resource-i18n.mjs --dry-run
 *   node scripts/migrate-kite-resource-i18n.mjs --apply
 *   node scripts/migrate-kite-resource-i18n.mjs --apply --mode api
 *   node scripts/migrate-kite-resource-i18n.mjs --apply --force
 *   node scripts/migrate-kite-resource-i18n.mjs --pending-only
 *   node scripts/migrate-kite-resource-i18n.mjs --apply --translations-file /tmp/kite-resource-translations-zhCN.json
 *
 * Env for API mode:
 *   KITE_TEST_API_KEY
 *   KITE_TEST_API_URL
 *   KITE_TEST_MODEL (optional)
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_LOCALE = 'zh-CN'
const DEFAULT_MODE = 'auto'
const DEFAULT_BATCH_SIZE = 40
const GOOGLE_TRANSLATE_MAX_CHARS = 1200

function parseArgs(argv) {
  const args = {
    root: process.env.KITE_CONFIG_DIR || path.join(os.homedir(), '.kite'),
    locale: DEFAULT_LOCALE,
    mode: DEFAULT_MODE,
    dryRun: true,
    apply: false,
    force: false,
    pendingOnly: false,
    pendingOut: '',
    translationsFile: ''
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--apply') {
      args.apply = true
      args.dryRun = false
      continue
    }
    if (token === '--dry-run') {
      args.dryRun = true
      args.apply = false
      continue
    }
    if (token === '--force') {
      args.force = true
      continue
    }
    if (token === '--pending-only') {
      args.pendingOnly = true
      args.apply = false
      args.dryRun = true
      continue
    }
    if (token === '--pending-out' && argv[i + 1]) {
      args.pendingOut = path.resolve(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--translations-file' && argv[i + 1]) {
      args.translationsFile = path.resolve(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--root' && argv[i + 1]) {
      args.root = path.resolve(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--locale' && argv[i + 1]) {
      args.locale = argv[i + 1]
      i += 1
      continue
    }
    if (token === '--mode' && argv[i + 1]) {
      args.mode = argv[i + 1]
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  if (!['auto', 'api', 'google', 'copy'].includes(args.mode)) {
    throw new Error(`Invalid --mode: ${args.mode}. Expected one of: auto, api, google, copy`)
  }

  if (args.pendingOnly && args.apply) {
    throw new Error('Cannot use --pending-only with --apply')
  }

  if (args.translationsFile && !fs.existsSync(args.translationsFile)) {
    throw new Error(`--translations-file does not exist: ${args.translationsFile}`)
  }

  return args
}

function printHelp() {
  console.log(`
Batch migrate ~/.kite resource frontmatter for localized title/description.

Options:
  --root <path>      Root kite directory (default: $KITE_CONFIG_DIR or ~/.kite)
  --locale <code>    Locale suffix (default: zh-CN)
  --mode <mode>      Translation mode: auto | api | google | copy (default: auto)
  --dry-run          Scan and preview only (default)
  --apply            Write changes to files
  --force            Overwrite existing localized values
  --pending-only     Scan only resources missing localized fields and export list
  --pending-out <p>  Output path for pending list JSON (default: /tmp/kite-resource-pending-<locale>.json)
  --translations-file <path>
                     Read GPT-translated JSON array and apply directly (fields: file, nameZh, descriptionZh)
  --help, -h         Show help

Examples:
  node scripts/migrate-kite-resource-i18n.mjs --dry-run
  node scripts/migrate-kite-resource-i18n.mjs --apply
  node scripts/migrate-kite-resource-i18n.mjs --apply --mode api --force
  node scripts/migrate-kite-resource-i18n.mjs --pending-only
  node scripts/migrate-kite-resource-i18n.mjs --apply --translations-file /tmp/kite-resource-translations-zhCN.json
  `)
}

function normalizeMode(mode) {
  if (mode === 'copy' || mode === 'api' || mode === 'google') return mode

  const hasApi = Boolean(process.env.KITE_TEST_API_KEY && process.env.KITE_TEST_API_URL)
  return hasApi ? 'api' : 'google'
}

function walkFiles(dirPath, predicate, results = []) {
  if (!fs.existsSync(dirPath)) return results

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
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

function collectResourceFiles(rootPath) {
  const skillsDir = path.join(rootPath, 'skills')
  const agentsDir = path.join(rootPath, 'agents')
  const commandsDir = path.join(rootPath, 'commands')

  return [
    ...walkFiles(skillsDir, (p) => path.basename(p) === 'SKILL.md').map((filePath) => ({ kind: 'skill', filePath })),
    ...walkFiles(agentsDir, (p) => p.endsWith('.md')).map((filePath) => ({ kind: 'agent', filePath })),
    ...walkFiles(commandsDir, (p) => p.endsWith('.md')).map((filePath) => ({ kind: 'command', filePath }))
  ]
}

function splitFrontmatter(content) {
  if (!content.startsWith('---\n')) {
    return {
      hasFrontmatter: false,
      frontmatterLines: [],
      body: content
    }
  }

  const lines = content.split('\n')
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      return {
        hasFrontmatter: true,
        frontmatterLines: lines.slice(1, i),
        body: lines.slice(i + 1).join('\n')
      }
    }
  }

  return {
    hasFrontmatter: false,
    frontmatterLines: [],
    body: content
  }
}

function parseScalarValue(rawValue) {
  const value = rawValue.trim()
  if (!value) return ''

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }

  if (value.startsWith('\'') && value.endsWith('\'')) {
    return value.slice(1, -1).replace(/''/g, '\'')
  }

  return value
}

function parseScalarFrontmatterEntries(frontmatterLines) {
  const entries = new Map()

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index]
    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kvMatch) continue

    const key = kvMatch[1]
    const rawValue = kvMatch[2] ?? ''
    entries.set(key, {
      index,
      rawValue,
      parsedValue: parseScalarValue(rawValue)
    })
  }

  return entries
}

function extractDescriptionFromBody(body) {
  const lines = body.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const headingMatch = line.match(/^#+\s+(.+)$/)
    if (headingMatch) return headingMatch[1].trim().slice(0, 100)
    return line.slice(0, 100)
  }
  return ''
}

function quoteYamlString(value) {
  return JSON.stringify(value)
}

function shouldFillValue(entry, force) {
  if (!entry) return true
  if (force) return true
  const raw = (entry.rawValue ?? '').trim()
  return raw === '' || raw === '""' || raw === '\'\''
}

function hasFilledValue(entry) {
  if (!entry) return false
  const raw = (entry.rawValue ?? '').trim()
  return !(raw === '' || raw === '""' || raw === '\'\'')
}

function deriveDefaultName(kind, filePath, scalarEntries) {
  const nameEntry = scalarEntries.get('name')
  if (nameEntry?.parsedValue) return String(nameEntry.parsedValue)

  const titleEntry = scalarEntries.get('title')
  if (titleEntry?.parsedValue) return String(titleEntry.parsedValue)

  if (kind === 'skill') {
    return path.basename(path.dirname(filePath))
  }
  return path.basename(filePath, '.md')
}

function deriveDefaultDescription(body, scalarEntries) {
  const descriptionEntry = scalarEntries.get('description')
  if (descriptionEntry?.parsedValue) return String(descriptionEntry.parsedValue)

  return extractDescriptionFromBody(body)
}

function buildTranslationInputs(records, nameLocaleKey, descriptionLocaleKey, force) {
  const jobs = []
  const dedupe = new Map()

  for (const record of records) {
    const nameEntry = record.scalarEntries.get(nameLocaleKey)
    if (record.defaultName && shouldFillValue(nameEntry, force)) {
      const key = `name:${record.kind}:${record.filePath}`
      jobs.push({
        filePath: record.filePath,
        key,
        fieldKey: nameLocaleKey,
        text: record.defaultName
      })
      dedupe.set(key, record.defaultName)
    }

    const descEntry = record.scalarEntries.get(descriptionLocaleKey)
    if (record.defaultDescription && shouldFillValue(descEntry, force)) {
      const key = `description:${record.kind}:${record.filePath}`
      jobs.push({
        filePath: record.filePath,
        key,
        fieldKey: descriptionLocaleKey,
        text: record.defaultDescription
      })
      dedupe.set(key, record.defaultDescription)
    }
  }

  return { jobs, textMap: dedupe }
}

function buildPendingList(records, nameLocaleKey, descriptionLocaleKey) {
  return records
    .filter((record) => !hasFilledValue(record.scalarEntries.get(nameLocaleKey)) || !hasFilledValue(record.scalarEntries.get(descriptionLocaleKey)))
    .map((record) => ({
      kind: record.kind,
      file: record.filePath,
      name: record.defaultName,
      description: record.defaultDescription
    }))
}

function loadTranslationsFromFile(translationFilePath) {
  const raw = fs.readFileSync(translationFilePath, 'utf-8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse translation file: ${translationFilePath}. ${error.message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Translation file must be a JSON array: ${translationFilePath}`)
  }

  const byFile = new Map()
  for (const item of parsed) {
    const file = typeof item?.file === 'string' ? item.file : ''
    if (!file) continue
    byFile.set(path.resolve(file), item)
  }
  return byFile
}

async function translateTextsWithApi(textMap, locale) {
  const apiKey = process.env.KITE_TEST_API_KEY
  const apiUrl = process.env.KITE_TEST_API_URL
  const model = process.env.KITE_TEST_MODEL || 'claude-haiku-4-5-20251001'

  if (!apiKey || !apiUrl) {
    throw new Error('Missing KITE_TEST_API_KEY or KITE_TEST_API_URL')
  }

  const entries = Array.from(textMap.entries())
  const translated = new Map()

  for (let i = 0; i < entries.length; i += DEFAULT_BATCH_SIZE) {
    const batchEntries = entries.slice(i, i + DEFAULT_BATCH_SIZE)
    const payload = Object.fromEntries(batchEntries)
    const prompt = `Translate JSON values into ${locale}.
Rules:
1) Keep keys unchanged.
2) Return JSON only, no explanation.
3) Keep placeholders like {{name}} unchanged.
4) Keep brand/product names unchanged if uncertain.

JSON:
${JSON.stringify(payload, null, 2)}
`

    const response = await fetch(`${apiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API request failed: ${response.status} ${text}`)
    }

    const data = await response.json()
    const content = data?.content?.[0]?.text ?? ''
    const parsed = extractJsonObject(content)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Failed to parse translation JSON from API response')
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        translated.set(key, value)
      }
    }
  }

  return translated
}

function chunkTextForGoogleTranslate(text, maxChars = GOOGLE_TRANSLATE_MAX_CHARS) {
  if (!text) return ['']
  if (text.length <= maxChars) return [text]

  const lines = text.split('\n')
  const chunks = []
  let current = ''

  for (const line of lines) {
    if (!current) {
      current = line
      continue
    }

    const candidate = `${current}\n${line}`
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    chunks.push(current)
    current = line
  }

  if (current) chunks.push(current)

  const splitLongChunks = []
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      splitLongChunks.push(chunk)
      continue
    }
    for (let i = 0; i < chunk.length; i += maxChars) {
      splitLongChunks.push(chunk.slice(i, i + maxChars))
    }
  }

  return splitLongChunks
}

async function translateWithGoogle(text, locale) {
  if (!text) return text

  const chunks = chunkTextForGoogleTranslate(text)
  const translatedChunks = []

  for (const chunk of chunks) {
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(locale)}&dt=t&q=${encodeURIComponent(chunk)}`
    const response = await fetch(endpoint)
    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Google translate request failed: ${response.status} ${errText}`)
    }
    const data = await response.json()
    const segments = Array.isArray(data?.[0]) ? data[0] : []
    const translated = segments
      .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? '') : ''))
      .join('')
    translatedChunks.push(translated)

    // Small delay to avoid throttling
    await new Promise((resolve) => setTimeout(resolve, 60))
  }

  return translatedChunks.join('')
}

async function translateTextsWithGoogle(textMap, locale) {
  const translated = new Map()
  const entries = Array.from(textMap.entries())

  for (let i = 0; i < entries.length; i += 1) {
    const [key, value] = entries[i]
    const translatedValue = await translateWithGoogle(value, locale)
    translated.set(key, translatedValue)
  }

  return translated
}

function extractJsonObject(content) {
  const jsonBlock = content.match(/```json\s*([\s\S]*?)```/)
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock[1].trim())
    } catch {
      // noop
    }
  }

  const block = content.match(/```\s*([\s\S]*?)```/)
  if (block) {
    try {
      return JSON.parse(block[1].trim())
    } catch {
      // noop
    }
  }

  try {
    return JSON.parse(content.trim())
  } catch {
    // noop
  }

  const firstBrace = content.indexOf('{')
  const lastBrace = content.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1))
    } catch {
      // noop
    }
  }

  return null
}

function upsertFrontmatterLine(lines, key, value, force) {
  const kvRegex = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`)
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(kvRegex)
    if (!match) continue

    const existingRaw = (match[1] || '').trim()
    const canWrite = force || existingRaw === '' || existingRaw === '""' || existingRaw === '\'\''
    if (!canWrite) {
      return false
    }
    lines[i] = `${key}: ${quoteYamlString(value)}`
    return true
  }

  lines.push(`${key}: ${quoteYamlString(value)}`)
  return true
}

function serializeContent(hasFrontmatter, frontmatterLines, body) {
  if (!hasFrontmatter) {
    const normalizedBody = body.startsWith('\n') ? body.slice(1) : body
    return `---\n${frontmatterLines.join('\n')}\n---\n\n${normalizedBody}`
  }
  return `---\n${frontmatterLines.join('\n')}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`
}

async function main() {
  const args = parseArgs(process.argv)
  const mode = normalizeMode(args.mode)
  const localeKeyName = `name_${args.locale}`
  const localeKeyDescription = `description_${args.locale}`

  if (!fs.existsSync(args.root)) {
    throw new Error(`Kite root does not exist: ${args.root}`)
  }

  const resources = collectResourceFiles(args.root)
  const records = resources.map(({ kind, filePath }) => {
    const content = fs.readFileSync(filePath, 'utf-8')
    const frontmatter = splitFrontmatter(content)
    const scalarEntries = parseScalarFrontmatterEntries(frontmatter.frontmatterLines)
    const defaultName = deriveDefaultName(kind, filePath, scalarEntries)
    const defaultDescription = deriveDefaultDescription(frontmatter.body, scalarEntries)
    return {
      kind,
      filePath,
      content,
      hasFrontmatter: frontmatter.hasFrontmatter,
      frontmatterLines: frontmatter.frontmatterLines,
      body: frontmatter.body,
      scalarEntries,
      defaultName,
      defaultDescription
    }
  })

  if (args.pendingOnly) {
    const pendingList = buildPendingList(records, localeKeyName, localeKeyDescription)
    const outPath = args.pendingOut || path.join(os.tmpdir(), `kite-resource-pending-${args.locale}.json`)
    fs.writeFileSync(outPath, JSON.stringify(pendingList, null, 2), 'utf-8')
    console.log(`[migrate] pending-only root=${args.root}`)
    console.log(`[migrate] pending=${pendingList.length} / total=${records.length}`)
    console.log(`[migrate] output=${outPath}`)
    return
  }

  const { jobs, textMap } = buildTranslationInputs(records, localeKeyName, localeKeyDescription, args.force)
  const translations = new Map()

  if (jobs.length > 0) {
    if (args.translationsFile) {
      const byFile = loadTranslationsFromFile(args.translationsFile)
      for (const job of jobs) {
        const item = byFile.get(path.resolve(job.filePath))
        if (!item) continue

        if (job.fieldKey === localeKeyName) {
          const value = typeof item.nameZh === 'string' ? item.nameZh.trim() : ''
          if (value) translations.set(job.key, value)
          continue
        }

        if (job.fieldKey === localeKeyDescription) {
          const value = typeof item.descriptionZh === 'string' ? item.descriptionZh.trim() : ''
          if (value) translations.set(job.key, value)
        }
      }
      console.log(`[migrate] Loaded translations from file: ${args.translationsFile}`)
    } else if (mode === 'api') {
      console.log(`[migrate] Translating ${textMap.size} texts via API...`)
      const translated = await translateTextsWithApi(textMap, args.locale)
      for (const [key, value] of translated.entries()) {
        translations.set(key, value)
      }
    } else if (mode === 'google') {
      console.log(`[migrate] Translating ${textMap.size} texts via Google...`)
      const translated = await translateTextsWithGoogle(textMap, args.locale)
      for (const [key, value] of translated.entries()) {
        translations.set(key, value)
      }
    } else {
      for (const [key, value] of textMap.entries()) {
        translations.set(key, value)
      }
    }
  }

  const jobsByFile = new Map()
  for (const job of jobs) {
    if (!jobsByFile.has(job.filePath)) {
      jobsByFile.set(job.filePath, [])
    }
    jobsByFile.get(job.filePath).push(job)
  }

  let changedFiles = 0
  let changedFields = 0
  const changedByKind = { skill: 0, agent: 0, command: 0 }

  for (const record of records) {
    const fileJobs = jobsByFile.get(record.filePath) || []
    if (fileJobs.length === 0) continue

    const mutableLines = [...record.frontmatterLines]
    let wroteAny = false

    for (const job of fileJobs) {
      const translatedValue = translations.get(job.key)
      if (!translatedValue || !translatedValue.trim()) continue

      const changed = upsertFrontmatterLine(mutableLines, job.fieldKey, translatedValue.trim(), args.force)
      if (changed) {
        wroteAny = true
        changedFields += 1
      }
    }

    if (!wroteAny) continue

    const nextContent = serializeContent(record.hasFrontmatter, mutableLines, record.body)
    changedFiles += 1
    changedByKind[record.kind] += 1

    if (args.apply) {
      fs.writeFileSync(record.filePath, nextContent, 'utf-8')
    }
  }

  const modeLabel = args.apply ? 'apply' : 'dry-run'
  const translationModeLabel = args.translationsFile ? 'file' : mode
  console.log(`[migrate] mode=${modeLabel} translation-mode=${translationModeLabel}`)
  console.log(`[migrate] root=${args.root}`)
  console.log(`[migrate] scanned=${records.length} files (skills=${resources.filter(r => r.kind === 'skill').length}, agents=${resources.filter(r => r.kind === 'agent').length}, commands=${resources.filter(r => r.kind === 'command').length})`)
  console.log(`[migrate] changed-files=${changedFiles}, changed-fields=${changedFields}`)
  console.log(`[migrate] changed-by-kind: skills=${changedByKind.skill}, agents=${changedByKind.agent}, commands=${changedByKind.command}`)
}

main().catch((error) => {
  console.error(`[migrate] failed: ${error.message}`)
  process.exit(1)
})
