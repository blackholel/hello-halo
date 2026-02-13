/**
 * Artifact Service - Scans and manages files created by the agent
 * Provides real-time artifact discovery and file information
 */

import { readdirSync, statSync, existsSync, readFileSync, promises as fsPromises } from 'fs'
import { join, extname, basename, dirname, normalize } from 'path'
import fs from 'fs'
import { getTempSpacePath } from './config.service'
import { getSpace, listSpaces } from './space.service'

// File type icon IDs mapping (mapped to Lucide icon names in renderer)
const FILE_ICON_IDS: Record<string, string> = {
  html: 'globe',
  htm: 'globe',
  css: 'palette',
  scss: 'palette',
  less: 'palette',
  js: 'file-code',
  jsx: 'file-code',
  ts: 'file-code',
  tsx: 'file-code',
  json: 'file-json',
  md: 'book',
  markdown: 'book',
  txt: 'file-text',
  py: 'file-code',
  rs: 'cpu',
  go: 'file-code',
  java: 'coffee',
  cpp: 'cpu',
  c: 'cpu',
  h: 'cpu',
  hpp: 'cpu',
  vue: 'file-code',
  svelte: 'file-code',
  php: 'file-code',
  rb: 'gem',
  swift: 'file-code',
  kt: 'file-code',
  sql: 'database',
  sh: 'terminal',
  bash: 'terminal',
  zsh: 'terminal',
  yaml: 'file-json',
  yml: 'file-json',
  xml: 'file-json',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  pdf: 'book',
  doc: 'file-text',
  docx: 'file-text',
  xls: 'database',
  xlsx: 'database',
  ppt: 'file-text',
  pptx: 'file-text',
  zip: 'package',
  tar: 'package',
  gz: 'package',
  rar: 'package',
  default: 'file-text'
}

// Get icon ID for file extension
function getFileIconId(ext: string): string {
  const normalized = ext.toLowerCase().replace('.', '')
  return FILE_ICON_IDS[normalized] || FILE_ICON_IDS.default
}

// Get readable file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Get file preview (first few lines for text files)
function getFilePreview(filePath: string, ext: string): string | undefined {
  const textExtensions = ['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'txt', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'vue', 'svelte', 'php', 'rb', 'swift', 'kt', 'sql', 'sh', 'bash', 'yaml', 'yml', 'xml', 'svg']

  if (!textExtensions.includes(ext.toLowerCase().replace('.', ''))) {
    return undefined
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').slice(0, 5)
    return lines.join('\n').substring(0, 200)
  } catch {
    return undefined
  }
}

export interface Artifact {
  id: string
  spaceId: string
  conversationId: string
  name: string
  type: 'file' | 'folder'
  path: string
  extension: string
  icon: string
  createdAt: string
  preview?: string
  size?: number
}

// Tree node structure for developer view
export interface ArtifactTreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  extension: string
  icon: string
  size?: number
  children?: ArtifactTreeNode[]
  depth: number
}

// Recursively scan directory for artifacts
function scanDirectory(
  dirPath: string,
  spaceId: string,
  conversationId: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Artifact[] {
  const artifacts: Artifact[] = []

  if (currentDepth >= maxDepth || !existsSync(dirPath)) {
    return artifacts
  }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      const fullPath = join(dirPath, entry.name)

      try {
        const stats = statSync(fullPath)
        const ext = extname(entry.name)

        const artifact: Artifact = {
          id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          spaceId,
          conversationId,
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          path: fullPath,
          extension: ext.replace('.', ''),
          icon: entry.isDirectory() ? 'folder' : getFileIconId(ext),
          createdAt: stats.birthtime.toISOString(),
          size: entry.isFile() ? stats.size : undefined,
          preview: entry.isFile() ? getFilePreview(fullPath, ext) : undefined
        }

        artifacts.push(artifact)

        // Recursively scan directories
        if (entry.isDirectory()) {
          const subArtifacts = scanDirectory(
            fullPath,
            spaceId,
            conversationId,
            maxDepth,
            currentDepth + 1
          )
          artifacts.push(...subArtifacts)
        }
      } catch (err) {
        console.error(`[Artifact] Failed to stat ${fullPath}:`, err)
      }
    }
  } catch (err) {
    console.error(`[Artifact] Failed to read directory ${dirPath}:`, err)
  }

  // Sort by creation time (newest first)
  return artifacts.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

// Get working directory for a space
function getWorkingDir(spaceId: string): string {
  if (spaceId === 'kite-temp') {
    const artifactsDir = join(getTempSpacePath(), 'artifacts')
    return artifactsDir
  }

  const space = getSpace(spaceId)
  if (space) {
    return space.path
  }

  return getTempSpacePath()
}

// List all artifacts in a space
export function listArtifacts(spaceId: string): Artifact[] {
  console.log(`[Artifact] Listing artifacts for space: ${spaceId}`)

  const workDir = getWorkingDir(spaceId)
  console.log(`[Artifact] Working directory: ${workDir}`)

  if (!existsSync(workDir)) {
    console.log(`[Artifact] Directory does not exist: ${workDir}`)
    return []
  }

  const artifacts = scanDirectory(workDir, spaceId, 'all', 2)
  console.log(`[Artifact] Found ${artifacts.length} artifacts`)

  return artifacts
}

// Get artifact by ID
export function getArtifact(artifactId: string): Artifact | null {
  // This would typically query a database or cache
  // For now, we don't have persistent artifact storage
  return null
}

// Watch for file changes (future feature)
export function watchArtifacts(
  spaceId: string,
  callback: (artifacts: Artifact[]) => void
): () => void {
  // TODO: Implement file watching with chokidar or similar
  // For now, return a no-op cleanup function
  return () => {}
}

// Recursively scan directory and return tree structure
function scanDirectoryTree(
  dirPath: string,
  maxDepth: number = 5,
  currentDepth: number = 0
): ArtifactTreeNode[] {
  const nodes: ArtifactTreeNode[] = []

  if (currentDepth >= maxDepth || !existsSync(dirPath)) {
    return nodes
  }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })

    // Sort: folders first, then files, alphabetically within each group
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      // Skip hidden files and common ignored directories
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === '.git') {
        continue
      }

      const fullPath = join(dirPath, entry.name)

      try {
        const stats = statSync(fullPath)
        const ext = extname(entry.name)

        const node: ArtifactTreeNode = {
          id: `tree-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          path: fullPath,
          extension: ext.replace('.', ''),
          icon: entry.isDirectory() ? 'folder' : getFileIconId(ext),
          size: entry.isFile() ? stats.size : undefined,
          depth: currentDepth
        }

        // Recursively scan directories
        if (entry.isDirectory()) {
          const children = scanDirectoryTree(
            fullPath,
            maxDepth,
            currentDepth + 1
          )
          if (children.length > 0) {
            node.children = children
          }
        }

        nodes.push(node)
      } catch (err) {
        console.error(`[Artifact] Failed to stat ${fullPath}:`, err)
      }
    }
  } catch (err) {
    console.error(`[Artifact] Failed to read directory ${dirPath}:`, err)
  }

  return nodes
}

// List artifacts as tree structure for developer view
export function listArtifactsTree(spaceId: string): ArtifactTreeNode[] {
  console.log(`[Artifact] Listing artifacts tree for space: ${spaceId}`)

  const workDir = getWorkingDir(spaceId)
  console.log(`[Artifact] Working directory: ${workDir}`)

  if (!existsSync(workDir)) {
    console.log(`[Artifact] Directory does not exist: ${workDir}`)
    return []
  }

  const tree = scanDirectoryTree(workDir, 5, 0)
  console.log(`[Artifact] Found ${tree.length} root nodes`)

  return tree
}

// ============================================
// Content Canvas Support
// ============================================

// MIME type mapping for common extensions
const MIME_TYPES: Record<string, string> = {
  // Text
  txt: 'text/plain',
  log: 'text/plain',
  // Code
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  php: 'text/x-php',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  sql: 'text/x-sql',
  // Markup
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  xml: 'text/xml',
  svg: 'image/svg+xml',
  // Data
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  md: 'text/markdown',
  markdown: 'text/markdown',
  // Config
  env: 'text/plain',
  gitignore: 'text/plain',
  dockerignore: 'text/plain',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
}

/**
 * Get MIME type for a file extension
 */
function getMimeType(ext: string): string {
  const normalized = ext.toLowerCase().replace('.', '')
  return MIME_TYPES[normalized] || 'text/plain'
}

/**
 * Check if file is binary (image, etc.)
 */
function isBinaryFile(ext: string): boolean {
  const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'tar', 'gz', 'rar']
  return binaryExtensions.includes(ext.toLowerCase().replace('.', ''))
}

/**
 * Read file content for Content Canvas
 * Returns content as string (for text files) or base64 (for binary files)
 */
export interface ArtifactContent {
  content: string
  mimeType: string
  encoding: 'utf-8' | 'base64'
  size: number
}

export function readArtifactContent(filePath: string): ArtifactContent {
  console.log(`[Artifact] Reading content: ${filePath}`)

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const stats = statSync(filePath)
  if (stats.isDirectory()) {
    throw new Error(`Cannot read directory content: ${filePath}`)
  }

  const ext = extname(filePath)
  const mimeType = getMimeType(ext)

  // Check file size limit (10MB for text, 50MB for binary)
  const maxTextSize = 10 * 1024 * 1024  // 10MB
  const maxBinarySize = 50 * 1024 * 1024  // 50MB
  const isBinary = isBinaryFile(ext)
  const maxSize = isBinary ? maxBinarySize : maxTextSize

  if (stats.size > maxSize) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${maxSize} bytes)`)
  }

  try {
    if (isBinary) {
      // Read as base64 for binary files
      const buffer = readFileSync(filePath)
      return {
        content: buffer.toString('base64'),
        mimeType,
        encoding: 'base64',
        size: stats.size
      }
    } else {
      // Read as UTF-8 for text files
      const content = readFileSync(filePath, 'utf-8')
      return {
        content,
        mimeType,
        encoding: 'utf-8',
        size: stats.size
      }
    }
  } catch (error) {
    console.error(`[Artifact] Failed to read file: ${filePath}`, error)
    throw new Error(`Failed to read file: ${(error as Error).message}`)
  }
}

/**
 * Get artifact download info for remote mode
 */
export function getArtifactDownloadInfo(filePath: string): {
  exists: boolean
  name: string
  size: number
  mimeType: string
} | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const stats = statSync(filePath)
    const ext = extname(filePath)
    return {
      exists: true,
      name: basename(filePath),
      size: stats.size,
      mimeType: getMimeType(ext)
    }
  } catch {
    return null
  }
}

/**
 * Check if a file path is within allowed space directories
 * Returns true if the path is within any space directory or the temp space
 */
function isPathInAllowedSpace(filePath: string): boolean {
  const normalizedPath = normalize(filePath)

  // Check temp space
  const tempSpacePath = getTempSpacePath()
  if (normalizedPath.startsWith(normalize(tempSpacePath))) {
    return true
  }

  // Check all user spaces
  const spaces = listSpaces()
  for (const space of spaces) {
    if (normalizedPath.startsWith(normalize(space.path))) {
      return true
    }
  }

  return false
}

/**
 * Write content to a file (for Content Canvas editing)
 * Validates that the file path is within allowed space directories
 */
export async function writeArtifactContent(
  filePath: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Writing content to: ${filePath}`)

  // Validate file path is within allowed spaces
  if (!isPathInAllowedSpace(filePath)) {
    const error = `Access denied: File path is not within allowed space directories`
    console.error(`[Artifact] ${error}`)
    return { success: false, error }
  }

  try {
    // Ensure parent directory exists
    const parentDir = dirname(filePath)
    if (!existsSync(parentDir)) {
      await fsPromises.mkdir(parentDir, { recursive: true })
    }

    // Write the file
    await fsPromises.writeFile(filePath, content, 'utf-8')
    console.log(`[Artifact] Successfully wrote file: ${filePath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to write file: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

// ============================================
// File Management Operations
// ============================================

/**
 * Create a new folder
 */
export async function createFolder(folderPath: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Creating folder: ${folderPath}`)

  try {
    if (!isPathInAllowedSpace(folderPath)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    await fs.promises.mkdir(folderPath, { recursive: true })
    console.log(`[Artifact] Successfully created folder: ${folderPath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to create folder: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Create a new file with optional content
 */
export async function createFile(filePath: string, content: string = ''): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Creating file: ${filePath}`)

  try {
    if (!isPathInAllowedSpace(filePath)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    const dir = dirname(filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(filePath, content, 'utf-8')
    console.log(`[Artifact] Successfully created file: ${filePath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to create file: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Rename a file or folder
 */
export async function renameArtifact(oldPath: string, newName: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Renaming: ${oldPath} to ${newName}`)

  try {
    if (!isPathInAllowedSpace(oldPath)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    const dir = dirname(oldPath)
    const newPath = join(dir, newName)
    if (!isPathInAllowedSpace(newPath)) {
      return { success: false, error: 'Target path not in allowed space' }
    }
    await fs.promises.rename(oldPath, newPath)
    console.log(`[Artifact] Successfully renamed to: ${newPath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to rename: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Delete a file or folder
 */
export async function deleteArtifact(filePath: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Deleting: ${filePath}`)

  try {
    if (!isPathInAllowedSpace(filePath)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    const stat = await fs.promises.stat(filePath)
    if (stat.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true })
    } else {
      await fs.promises.unlink(filePath)
    }
    console.log(`[Artifact] Successfully deleted: ${filePath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to delete: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Move a file or folder to a new directory
 */
export async function moveArtifact(sourcePath: string, targetDir: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Moving: ${sourcePath} to ${targetDir}`)

  try {
    if (!isPathInAllowedSpace(sourcePath) || !isPathInAllowedSpace(targetDir)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    const fileName = basename(sourcePath)
    const targetPath = join(targetDir, fileName)
    await fs.promises.rename(sourcePath, targetPath)
    console.log(`[Artifact] Successfully moved to: ${targetPath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to move: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

/**
 * Copy a file or folder to a new directory
 */
export async function copyArtifact(sourcePath: string, targetDir: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[Artifact] Copying: ${sourcePath} to ${targetDir}`)

  try {
    if (!isPathInAllowedSpace(sourcePath) || !isPathInAllowedSpace(targetDir)) {
      return { success: false, error: 'Path not in allowed space' }
    }
    const fileName = basename(sourcePath)
    const targetPath = join(targetDir, fileName)
    await fs.promises.cp(sourcePath, targetPath, { recursive: true })
    console.log(`[Artifact] Successfully copied to: ${targetPath}`)
    return { success: true }
  } catch (error) {
    const errorMessage = `Failed to copy: ${(error as Error).message}`
    console.error(`[Artifact] ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}
