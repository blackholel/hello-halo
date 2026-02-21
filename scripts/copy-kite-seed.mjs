import { homedir } from 'os'
import { dirname, join, relative, resolve, sep } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const sourceDir = process.env.KITE_SEED_SOURCE_DIR
  ? resolve(process.env.KITE_SEED_SOURCE_DIR)
  : join(homedir(), '.kite')
const outputDir = join(projectRoot, 'build', 'default-kite-config')
const packageJsonPath = join(projectRoot, 'package.json')
const installPathTemplate = '__KITE_ROOT__'
const secretKeyPattern = /(key|token|secret|password)/i

const whitelist = new Set([
  'config.json',
  'settings.json',
  'agents',
  'commands',
  'hooks',
  'mcp',
  'rules',
  'skills',
  'contexts',
  'plugins'
])

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isPathInside(baseDir, targetPath) {
  const rel = relative(baseDir, targetPath)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    console.warn(`[Seed] Invalid JSON skipped: ${path}`, error)
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function copyDir(sourcePath, targetPath) {
  mkdirSync(targetPath, { recursive: true })
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const src = join(sourcePath, entry.name)
    const dst = join(targetPath, entry.name)
    if (entry.isDirectory()) {
      copyDir(src, dst)
      continue
    }
    if (entry.isFile()) {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
    }
  }
}

function sanitizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const sanitized = JSON.parse(JSON.stringify(config))

  if (sanitized.api && typeof sanitized.api === 'object') {
    sanitized.api.apiKey = ''
  }

  if (sanitized.mcpServers && typeof sanitized.mcpServers === 'object') {
    for (const server of Object.values(sanitized.mcpServers)) {
      if (server && typeof server === 'object') {
        server.env = {}
      }
    }
  }

  delete sanitized.analytics

  if (sanitized.claudeCode && typeof sanitized.claudeCode === 'object') {
    if (sanitized.claudeCode.plugins && typeof sanitized.claudeCode.plugins === 'object') {
      delete sanitized.claudeCode.plugins.globalPaths
    }
    if (sanitized.claudeCode.agents && typeof sanitized.claudeCode.agents === 'object') {
      delete sanitized.claudeCode.agents.paths
    }
  }

  return sanitized
}

function sanitizeSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecrets(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      result[key] = ''
      continue
    }
    result[key] = sanitizeSecrets(child)
  }
  return result
}

function sanitizePluginsRegistry(registry, pluginsCacheDir) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return null
  const sourcePlugins = registry.plugins
  if (!sourcePlugins || typeof sourcePlugins !== 'object' || Array.isArray(sourcePlugins)) {
    return {
      version: registry.version || 2,
      plugins: {}
    }
  }

  const sanitizedPlugins = {}
  for (const [fullName, installations] of Object.entries(sourcePlugins)) {
    if (!Array.isArray(installations)) continue

    const validInstallations = installations
      .filter((installation) => installation && typeof installation === 'object')
      .map((installation) => {
        const installPath = typeof installation.installPath === 'string'
          ? resolve(installation.installPath)
          : null
        if (!installPath || !isPathInside(pluginsCacheDir, installPath)) return null
        const relPath = relative(pluginsCacheDir, installPath).split(sep).join('/')
        return {
          ...installation,
          installPath: `${installPathTemplate}/plugins/cache/${relPath}`
        }
      })
      .filter(Boolean)

    if (validInstallations.length > 0) {
      sanitizedPlugins[fullName] = validInstallations
    }
  }

  return {
    version: registry.version || 2,
    plugins: sanitizedPlugins
  }
}

function copyWhitelistedSeed() {
  const copied = []
  for (const entryName of whitelist) {
    const src = join(sourceDir, entryName)
    if (!existsSync(src)) continue

    if (entryName === 'config.json') {
      const config = sanitizeConfig(readJson(src))
      if (config) {
        writeJson(join(outputDir, entryName), config)
        copied.push(entryName)
      }
      continue
    }

    if (entryName === 'settings.json') {
      const settings = sanitizeSecrets(readJson(src))
      if (settings && typeof settings === 'object') {
        writeJson(join(outputDir, entryName), settings)
        copied.push(entryName)
      }
      continue
    }

    if (entryName === 'plugins') {
      const srcCacheDir = join(src, 'cache')
      const dstCacheDir = join(outputDir, 'plugins', 'cache')
      if (isDirectory(srcCacheDir)) {
        copyDir(srcCacheDir, dstCacheDir)
        copied.push('plugins/cache')
      }

      const registryPath = join(src, 'installed_plugins.json')
      const registry = sanitizePluginsRegistry(readJson(registryPath), resolve(srcCacheDir))
      if (registry) {
        writeJson(join(outputDir, 'plugins', 'installed_plugins.json'), registry)
        copied.push('plugins/installed_plugins.json')
      }
      continue
    }

    if (isDirectory(src)) {
      copyDir(src, join(outputDir, entryName))
      copied.push(entryName)
    } else {
      mkdirSync(dirname(join(outputDir, entryName)), { recursive: true })
      copyFileSync(src, join(outputDir, entryName))
      copied.push(entryName)
    }
  }

  return copied
}

function assertSourceDirExists() {
  if (isDirectory(sourceDir)) {
    return
  }
  throw new Error(`[Seed] Source directory does not exist: ${sourceDir}`)
}

function writeManifest(copiedEntries) {
  const pkg = readJson(packageJsonPath) || {}
  const manifest = {
    schemaVersion: 1,
    appVersion: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    generatedAt: new Date().toISOString(),
    sourceDir,
    copiedEntries
  }
  writeJson(join(outputDir, 'seed-manifest.json'), manifest)
}

function main() {
  assertSourceDirExists()
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })

  const copiedEntries = copyWhitelistedSeed()
  writeManifest(copiedEntries)

  console.log(`[Seed] Prepared built-in seed at: ${outputDir}`)
  console.log(`[Seed] Source: ${sourceDir}`)
  console.log(`[Seed] Copied entries: ${copiedEntries.length > 0 ? copiedEntries.join(', ') : '(none)'}`)
}

try {
  main()
} catch (error) {
  console.error('[Seed] Failed to prepare built-in seed:', error)
  process.exit(1)
}
