#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'

const SKILL_REGEX = /\b(?:invoke|use|run)\s+(?:the\s+)?([A-Za-z0-9._:-]+)\s+skill\b/gi
const AGENT_REGEX = /(?:^|\s)@([A-Za-z0-9._:-]+)/g

function parseArgs(argv) {
  const args = {
    write: false,
    dirs: []
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') {
      args.write = true
      continue
    }
    if (arg === '--dir') {
      const next = argv[i + 1]
      if (next) {
        args.dirs.push(resolve(next))
        i += 1
      }
      continue
    }
  }

  return args
}

function unique(values) {
  return Array.from(new Set(values))
}

function collectDefaultDirs() {
  const dirs = []
  const home = os.homedir()

  dirs.push(join(home, '.kite', 'commands'))

  const cwdCommands = join(process.cwd(), '.claude', 'commands')
  dirs.push(cwdCommands)

  const spacesRoot = join(home, '.kite', 'kite')
  if (existsSync(spacesRoot)) {
    for (const entry of readdirSync(spacesRoot)) {
      const maybeCommands = join(spacesRoot, entry, '.claude', 'commands')
      dirs.push(maybeCommands)
    }
  }

  return unique(dirs)
}

function collectCommandFiles(dirPath) {
  if (!existsSync(dirPath)) return []

  try {
    if (!statSync(dirPath).isDirectory()) return []
  } catch {
    return []
  }

  return readdirSync(dirPath)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dirPath, name))
}

function stripFrontmatter(content) {
  if (!content.startsWith('---\n')) {
    return { frontmatter: '', body: content, hasFrontmatter: false }
  }

  const closeIndex = content.indexOf('\n---\n', 4)
  if (closeIndex === -1) {
    return { frontmatter: '', body: content, hasFrontmatter: false }
  }

  const frontmatter = content.slice(4, closeIndex)
  const body = content.slice(closeIndex + 5)
  return { frontmatter, body, hasFrontmatter: true }
}

function parseFrontmatterArrays(frontmatter) {
  const result = {
    requires_skills: [],
    requires_agents: []
  }

  const lines = frontmatter.split(/\r?\n/)
  let current = null

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/)
    if (keyMatch) {
      const key = keyMatch[1]
      current = key === 'requires_skills' || key === 'requires_agents' ? key : null
      continue
    }

    const inlineMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
    if (inlineMatch) {
      const key = inlineMatch[1]
      if ((key === 'requires_skills' || key === 'requires_agents') && inlineMatch[2].trim()) {
        const values = inlineMatch[2]
          .split(/[;,]/)
          .map((item) => item.trim())
          .filter(Boolean)
        result[key].push(...values)
      }
      current = null
      continue
    }

    if (!current) continue
    const itemMatch = line.match(/^\s*-\s+(.+)$/)
    if (itemMatch) {
      result[current].push(itemMatch[1].trim())
    }
  }

  result.requires_skills = unique(result.requires_skills)
  result.requires_agents = unique(result.requires_agents)
  return result
}

function detectDependencies(body) {
  const skills = []
  const agents = []

  for (const match of body.matchAll(SKILL_REGEX)) {
    if (match[1]) skills.push(match[1].trim())
  }

  for (const match of body.matchAll(AGENT_REGEX)) {
    if (match[1]) agents.push(match[1].trim())
  }

  return {
    skills: unique(skills),
    agents: unique(agents)
  }
}

function renderArrayField(name, values) {
  if (!values.length) return ''
  return `${name}:\n${values.map((value) => `  - ${value}`).join('\n')}\n`
}

function addMissingFrontmatterFields(content, missingSkills, missingAgents) {
  const { frontmatter, body, hasFrontmatter } = stripFrontmatter(content)
  const fieldText = `${renderArrayField('requires_skills', missingSkills)}${renderArrayField('requires_agents', missingAgents)}`
  if (!fieldText) return content

  if (!hasFrontmatter) {
    return `---\n${fieldText}---\n${body}`
  }

  const normalizedFrontmatter = frontmatter.endsWith('\n') ? frontmatter : `${frontmatter}\n`
  return `---\n${normalizedFrontmatter}${fieldText}---\n${body}`
}

function migrateFile(filePath, write) {
  const raw = readFileSync(filePath, 'utf-8')
  const { frontmatter, body, hasFrontmatter } = stripFrontmatter(raw)
  const existing = hasFrontmatter ? parseFrontmatterArrays(frontmatter) : { requires_skills: [], requires_agents: [] }
  const detected = detectDependencies(body)

  const missingSkills = detected.skills.filter((item) => !existing.requires_skills.includes(item))
  const missingAgents = detected.agents.filter((item) => !existing.requires_agents.includes(item))

  if (missingSkills.length === 0 && missingAgents.length === 0) {
    return { changed: false, filePath, missingSkills: [], missingAgents: [] }
  }

  if (write) {
    const nextContent = addMissingFrontmatterFields(raw, missingSkills, missingAgents)
    writeFileSync(filePath, nextContent, 'utf-8')
  }

  return {
    changed: true,
    filePath,
    missingSkills,
    missingAgents
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const candidateDirs = unique(args.dirs.length > 0 ? args.dirs : collectDefaultDirs())
  const files = unique(candidateDirs.flatMap((dirPath) => collectCommandFiles(dirPath)))

  if (files.length === 0) {
    console.log('[migrate-command-dependencies] No command files found.')
    return
  }

  const changed = []
  for (const filePath of files) {
    const result = migrateFile(filePath, args.write)
    if (result.changed) {
      changed.push(result)
    }
  }

  if (changed.length === 0) {
    console.log('[migrate-command-dependencies] No migration needed.')
    return
  }

  for (const item of changed) {
    const parts = []
    if (item.missingSkills.length > 0) {
      parts.push(`requires_skills=[${item.missingSkills.join(', ')}]`)
    }
    if (item.missingAgents.length > 0) {
      parts.push(`requires_agents=[${item.missingAgents.join(', ')}]`)
    }
    console.log(`${args.write ? 'UPDATED' : 'DRY-RUN'} ${item.filePath} ${parts.join(' ')}`)
  }

  console.log(`\n[migrate-command-dependencies] ${args.write ? 'Updated' : 'Would update'} ${changed.length}/${files.length} files.`)
  if (!args.write) {
    console.log('[migrate-command-dependencies] Re-run with --write to apply changes.')
  }
}

main()
