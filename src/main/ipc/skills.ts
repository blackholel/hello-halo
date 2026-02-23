/**
 * Skills IPC Handlers
 *
 * Handles IPC communication for skills management between renderer and main process.
 */

import { ipcMain } from 'electron'
import {
  listSkills,
  getSkillContent,
  createSkill,
  updateSkill,
  deleteSkill,
  copySkillToSpace,
  copySkillToSpaceByRef,
  clearSkillsCache
} from '../services/skills.service'
import type { ResourceRef } from '../services/resource-ref.service'

export function registerSkillsHandlers(): void {
  // List all available skills
  ipcMain.handle('skills:list', async (_event, workDir?: string, locale?: string) => {
    try {
      const skills = listSkills(workDir, locale)
      return { success: true, data: skills }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get skill content by name
  ipcMain.handle('skills:get-content', async (_event, name: string, workDir?: string) => {
    try {
      const content = getSkillContent(name, workDir)
      if (!content) {
        return { success: false, error: `Skill not found: ${name}` }
      }
      return { success: true, data: content }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Create a new skill in space directory
  ipcMain.handle('skills:create', async (_event, workDir: string, name: string, content: string) => {
    try {
      const skill = createSkill(workDir, name, content)
      return { success: true, data: skill }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update an existing skill
  ipcMain.handle('skills:update', async (_event, skillPath: string, content: string) => {
    try {
      const result = updateSkill(skillPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Delete a skill
  ipcMain.handle('skills:delete', async (_event, skillPath: string) => {
    try {
      const result = deleteSkill(skillPath)
      if (!result) {
        return { success: false, error: 'Failed to delete skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Copy a skill to space directory
  ipcMain.handle('skills:copy-to-space', async (_event, skillName: string, workDir: string) => {
    try {
      const skill = copySkillToSpace(skillName, workDir)
      if (!skill) {
        return { success: false, error: `Failed to copy skill: ${skillName}` }
      }
      return { success: true, data: skill }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'skills:copy-to-space-by-ref',
    async (_event, ref: ResourceRef, workDir: string, options?: { overwrite?: boolean }) => {
      try {
        return { success: true, data: copySkillToSpaceByRef(ref, workDir, options) }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Clear skills cache (useful after external modifications)
  ipcMain.handle('skills:clear-cache', async () => {
    try {
      clearSkillsCache()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
