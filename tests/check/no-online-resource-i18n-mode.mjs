#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const packageJsonPath = path.join(workspaceRoot, 'package.json')

if (!fs.existsSync(packageJsonPath)) {
  console.error(`[check] package.json not found: ${packageJsonPath}`)
  process.exit(1)
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
  ? packageJson.scripts
  : {}

const violations = []
const blockedPattern = /--mode\s+(api|google)\b/i

for (const [name, command] of Object.entries(scripts)) {
  if (typeof command !== 'string') continue
  if (blockedPattern.test(command)) {
    violations.push({ name, command })
  }
}

if (violations.length > 0) {
  console.error('[check] Found forbidden online translation mode in npm scripts (--mode api/google):')
  for (const item of violations) {
    console.error(`  - ${item.name}: ${item.command}`)
  }
  process.exit(1)
}

console.log('[check] OK: no npm scripts use --mode api/google.')
