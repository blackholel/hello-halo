#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const projectRoot = process.cwd()
const runtimeFiles = [
  'src/main/services/config-source-mode.service.ts',
  'src/main/services/agent/sdk-config.builder.ts',
  'src/main/services/config.service.ts',
  'src/main/utils/instance.ts',
  'src/main/services/hooks.service.ts',
  'src/main/services/plugins.service.ts'
]

const forbiddenPatterns = [
  {
    name: 'homedir-claude-join',
    pattern: /join\(\s*homedir\(\)\s*,\s*['"]\.claude['"]\s*\)/g
  }
]

const findings = []

for (const relativePath of runtimeFiles) {
  const absolutePath = path.join(projectRoot, relativePath)
  const content = fs.readFileSync(absolutePath, 'utf-8')

  for (const entry of forbiddenPatterns) {
    const matches = content.match(entry.pattern)
    if (!matches || matches.length === 0) {
      continue
    }
    findings.push({
      file: relativePath,
      pattern: entry.name,
      count: matches.length
    })
  }
}

if (findings.length > 0) {
  console.error('[no-claude-user-root] Forbidden ~/.claude runtime path construction detected:')
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.pattern}) x${finding.count}`)
  }
  process.exit(1)
}

console.log('[no-claude-user-root] OK')
