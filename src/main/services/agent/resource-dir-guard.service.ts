import { resolve } from 'path'

const PROTECTED_RESOURCE_SUBDIRS = [
  '.claude/skills',
  '.claude/agents',
  '.claude/commands'
]

function normalize(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

export function getProtectedResourceDirs(workDir: string): string[] {
  return PROTECTED_RESOURCE_SUBDIRS.map((subdir) => resolve(workDir, subdir))
}

export function isPathInProtectedResourceDir(candidatePath: string, workDir: string): boolean {
  const absolutePath = resolve(workDir, candidatePath)
  const normalizedCandidate = normalize(absolutePath)
  return getProtectedResourceDirs(workDir)
    .map(normalize)
    .some((protectedDir) => (
      normalizedCandidate === protectedDir || normalizedCandidate.startsWith(`${protectedDir}/`)
    ))
}

export function extractToolPath(input: Record<string, unknown>): string | null {
  const raw = (input.file_path || input.path) as string | undefined
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  return raw
}

export function isBashCommandTouchingProtectedResourceDir(command: string): boolean {
  const normalized = normalize(command).toLowerCase()
  return PROTECTED_RESOURCE_SUBDIRS.some((subdir) => normalized.includes(subdir))
}
