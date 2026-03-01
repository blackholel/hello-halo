/**
 * API Routes - REST API endpoints for remote access
 * Mirrors the IPC API structure
 */

import { Express, Request, Response } from 'express'
import { BrowserWindow } from 'electron'
import { createReadStream, statSync, existsSync, readdirSync } from 'fs'
import { join, basename, relative } from 'path'
import { createGzip } from 'zlib'

import * as agentController from '../../controllers/agent.controller'
import * as spaceController from '../../controllers/space.controller'
import * as conversationController from '../../controllers/conversation.controller'
import * as configController from '../../controllers/config.controller'
import * as changeSetController from '../../controllers/change-set.controller'
import * as sceneTaxonomyController from '../../controllers/scene-taxonomy.controller'
import { listArtifacts } from '../../services/artifact.service'
import { getTempSpacePath, getSpacesDir } from '../../services/config.service'
import { getSpace, getAllSpacePaths } from '../../services/space.service'
import { isWorkDirAllowed } from '../../utils/path-validation'
import { isResourceListView, type ResourceListView } from '../../../shared/resource-access'
import {
  addToolkitResource,
  clearSpaceToolkit,
  getSpaceToolkit,
  migrateToToolkit,
  removeToolkitResource
} from '../../services/toolkit.service'

// Helper: get working directory for a space
function getWorkingDir(spaceId: string): string {
  if (spaceId === 'kite-temp') {
    return join(getTempSpacePath(), 'artifacts')
  }
  const space = getSpace(spaceId)
  return space ? space.path : getTempSpacePath()
}

/**
 * Validate and extract workDir from request.
 * Returns:
 *   - the validated workDir string (possibly empty) if OK
 *   - null if validation failed (response already sent)
 */
function validateWorkDir(req: Request, res: Response): string | null {
  const workDir = (req.body?.workDir || req.query?.workDir) as string | undefined
  if (!workDir) return ''   // No workDir provided, allowed
  if (!isWorkDirAllowed(workDir, getAllSpacePaths())) {
    res.status(403).json({ success: false, error: 'workDir is not an allowed workspace path' })
    return null
  }
  return workDir
}

function validateResourceListView(req: Request, res: Response): ResourceListView | null {
  const view = (req.body?.view || req.query?.view) as string | undefined
  if (!isResourceListView(view)) {
    res.status(400).json({ success: false, error: 'view is required and must be a valid ResourceListView' })
    return null
  }
  return view
}

/** Wraps an async route handler with standard error response */
function safeRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res)
    } catch (error) {
      res.json({ success: false, error: (error as Error).message })
    }
  }
}

// Helper: collect all files in a directory recursively for tar-like output
function collectFiles(dir: string, baseDir: string, files: { path: string; fullPath: string }[] = []): { path: string; fullPath: string }[] {
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const fullPath = join(dir, entry.name)
    const relativePath = relative(baseDir, fullPath)

    if (entry.isDirectory()) {
      collectFiles(fullPath, baseDir, files)
    } else {
      files.push({ path: relativePath, fullPath })
    }
  }
  return files
}

/**
 * Register all API routes
 */
export function registerApiRoutes(app: Express, mainWindow: BrowserWindow | null): void {
  // ===== Config Routes =====
  app.get('/api/config', async (req: Request, res: Response) => {
    const result = configController.getConfig()
    res.json(result)
  })

  app.post('/api/config', async (req: Request, res: Response) => {
    const result = configController.setConfig(req.body)
    res.json(result)
  })

  app.post('/api/config/validate', async (req: Request, res: Response) => {
    const { apiKey, apiUrl, provider, protocol } = req.body
    const result = await configController.validateApi(apiKey, apiUrl, provider, protocol)
    res.json(result)
  })

  // ===== Space Routes =====
  app.get('/api/spaces/kite', async (req: Request, res: Response) => {
    const result = spaceController.getKiteTempSpace()
    res.json(result)
  })

  // Get default space path (must be before :spaceId route)
  app.get('/api/spaces/default-path', safeRoute(async (_req, res) => {
    res.json({ success: true, data: getSpacesDir() })
  }))

  app.get('/api/spaces', async (req: Request, res: Response) => {
    const result = spaceController.listSpaces()
    res.json(result)
  })

  app.post('/api/spaces', async (req: Request, res: Response) => {
    const { name, icon, customPath } = req.body
    const result = spaceController.createSpace({ name, icon, customPath })
    res.json(result)
  })

  app.get('/api/spaces/:spaceId', async (req: Request, res: Response) => {
    const result = spaceController.getSpace(req.params.spaceId)
    res.json(result)
  })

  app.put('/api/spaces/:spaceId', async (req: Request, res: Response) => {
    const result = spaceController.updateSpace(req.params.spaceId, req.body)
    res.json(result)
  })

  app.delete('/api/spaces/:spaceId', async (req: Request, res: Response) => {
    const result = spaceController.deleteSpace(req.params.spaceId)
    res.json(result)
  })

  // Note: openSpaceFolder doesn't make sense for remote access
  // We could return the path instead
  app.post('/api/spaces/:spaceId/open', async (req: Request, res: Response) => {
    // For remote access, just return the path
    const space = spaceController.getSpace(req.params.spaceId)
    if (space.success && space.data) {
      res.json({ success: true, data: { path: (space.data as any).path } })
    } else {
      res.json(space)
    }
  })

  // ===== Conversation Routes =====
  app.get('/api/spaces/:spaceId/conversations', async (req: Request, res: Response) => {
    const result = conversationController.listConversations(req.params.spaceId)
    res.json(result)
  })

  app.post('/api/spaces/:spaceId/conversations', async (req: Request, res: Response) => {
    const { title } = req.body
    const result = conversationController.createConversation(req.params.spaceId, title)
    res.json(result)
  })

  app.get('/api/spaces/:spaceId/conversations/:conversationId', async (req: Request, res: Response) => {
    const result = conversationController.getConversation(
      req.params.spaceId,
      req.params.conversationId
    )
    res.json(result)
  })

  app.put('/api/spaces/:spaceId/conversations/:conversationId', async (req: Request, res: Response) => {
    const result = conversationController.updateConversation(
      req.params.spaceId,
      req.params.conversationId,
      req.body
    )
    res.json(result)
  })

  app.delete('/api/spaces/:spaceId/conversations/:conversationId', async (req: Request, res: Response) => {
    const result = await conversationController.deleteConversation(
      req.params.spaceId,
      req.params.conversationId
    )
    res.json(result)
  })

  app.post('/api/spaces/:spaceId/conversations/:conversationId/messages', async (req: Request, res: Response) => {
    const result = conversationController.addMessage(
      req.params.spaceId,
      req.params.conversationId,
      req.body
    )
    res.json(result)
  })

  app.put('/api/spaces/:spaceId/conversations/:conversationId/messages/last', async (req: Request, res: Response) => {
    const result = conversationController.updateLastMessage(
      req.params.spaceId,
      req.params.conversationId,
      req.body
    )
    res.json(result)
  })

  // ===== Change Set Routes =====
  app.get('/api/spaces/:spaceId/conversations/:conversationId/change-sets', async (req: Request, res: Response) => {
    const { spaceId, conversationId } = req.params
    const result = changeSetController.listChangeSetsForConversation(
      spaceId,
      conversationId
    )
    res.json(result)
  })

  app.post('/api/spaces/:spaceId/conversations/:conversationId/change-sets/accept', async (req: Request, res: Response) => {
    const { spaceId, conversationId } = req.params
    const { changeSetId, filePath } = req.body
    const result = changeSetController.acceptChangeSetForConversation({
      spaceId,
      conversationId,
      changeSetId,
      filePath
    })
    res.json(result)
  })

  app.post('/api/spaces/:spaceId/conversations/:conversationId/change-sets/rollback', async (req: Request, res: Response) => {
    const { spaceId, conversationId } = req.params
    const { changeSetId, filePath, force } = req.body
    const result = changeSetController.rollbackChangeSetForConversation({
      spaceId,
      conversationId,
      changeSetId,
      filePath,
      force
    })
    res.json(result)
  })

  // ===== Agent Routes =====
  app.post('/api/agent/message', async (req: Request, res: Response) => {
    const {
      spaceId,
      conversationId,
      message,
      resumeSessionId,
      modelOverride,
      model,
      images,
      thinkingEnabled,
      aiBrowserEnabled,
      planEnabled,
      mode,
      canvasContext,
      fileContexts
    } = req.body
    const result = await agentController.sendMessage(mainWindow, {
      spaceId,
      conversationId,
      message,
      resumeSessionId,
      modelOverride,
      model,
      images,  // Pass images for multi-modal messages (remote access)
      thinkingEnabled,  // Pass thinking mode for extended thinking (remote access)
      aiBrowserEnabled,  // Pass AI Browser toggle for remote access
      planEnabled,
      mode,
      canvasContext,
      fileContexts
    })
    res.json(result)
  })

  app.post('/api/agent/mode', async (req: Request, res: Response) => {
    const { conversationId, mode, runId } = req.body
    const result = await agentController.setMode({ conversationId, mode, runId })
    res.json(result)
  })

  app.post('/api/workflow/step-message', async (_req: Request, res: Response) => {
    res.status(403).json({
      success: false,
      error: 'workflow-step endpoint is restricted to trusted internal channels'
    })
  })

  app.post('/api/agent/stop', async (req: Request, res: Response) => {
    const { conversationId } = req.body
    const result = await agentController.stopGeneration(conversationId)
    res.json(result)
  })

  app.post('/api/agent/warm', safeRoute(async (req, res) => {
    const { ensureSessionWarm } = await import('../../services/agent')
    const { spaceId, conversationId } = req.body ?? {}
    if (typeof spaceId !== 'string' || typeof conversationId !== 'string') {
      res.json({ success: false, error: 'spaceId and conversationId are required' })
      return
    }
    await ensureSessionWarm(spaceId, conversationId)
    res.json({ success: true })
  }))

  app.get('/api/agent/resource-hash', safeRoute(async (req, res) => {
    const spaceId = typeof req.query.spaceId === 'string' ? req.query.spaceId : undefined
    const workDirQuery = typeof req.query.workDir === 'string' ? req.query.workDir : undefined
    const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined

    let resolvedWorkDir = workDirQuery
    if (!resolvedWorkDir && spaceId) {
      resolvedWorkDir = getWorkingDir(spaceId)
    }

    if (resolvedWorkDir && !isWorkDirAllowed(resolvedWorkDir, getAllSpacePaths())) {
      res.status(403).json({ success: false, error: 'workDir is not an allowed workspace path' })
      return
    }

    const { getResourceIndexHash } = await import('../../services/resource-index.service')
    const { getV2SessionInfo } = await import('../../services/agent')
    const sessionInfo = conversationId ? getV2SessionInfo(conversationId) : undefined
    res.json({
      success: true,
      data: {
        hash: getResourceIndexHash(resolvedWorkDir),
        workDir: resolvedWorkDir || null,
        sessionResourceHash: sessionInfo?.config.resourceIndexHash || null
      }
    })
  }))

  app.post('/api/agent/approve', async (req: Request, res: Response) => {
    const { conversationId } = req.body
    const result = agentController.approveTool(conversationId)
    res.json(result)
  })

  app.post('/api/agent/reject', async (req: Request, res: Response) => {
    const { conversationId } = req.body
    const result = agentController.rejectTool(conversationId)
    res.json(result)
  })

  app.post('/api/agent/answer-question', async (req: Request, res: Response) => {
    const { conversationId, answer, payload } = req.body
    const result = await agentController.answerQuestion(conversationId, payload ?? answer)
    res.json(result)
  })

  app.get('/api/agent/sessions', async (req: Request, res: Response) => {
    const result = agentController.listActiveSessions()
    res.json(result)
  })

  app.get('/api/agent/generating/:conversationId', async (req: Request, res: Response) => {
    const result = agentController.checkGenerating(req.params.conversationId)
    res.json(result)
  })

  // Get session state for recovery after refresh
  app.get('/api/agent/session/:conversationId', async (req: Request, res: Response) => {
    const result = agentController.getSessionState(req.params.conversationId)
    res.json(result)
  })

  // Test MCP server connections
  app.post('/api/agent/test-mcp', async (req: Request, res: Response) => {
    const result = await agentController.testMcpConnections(mainWindow)
    res.json(result)
  })

  // ===== Toolkit Routes =====
  app.get('/api/toolkit/:spaceId', safeRoute(async (req, res) => {
    const workDir = getWorkingDir(req.params.spaceId)
    res.json({ success: true, data: getSpaceToolkit(workDir) })
  }))

  app.post('/api/toolkit/:spaceId/add', safeRoute(async (req, res) => {
    const workDir = getWorkingDir(req.params.spaceId)
    res.json({ success: true, data: addToolkitResource(workDir, req.body) })
  }))

  app.post('/api/toolkit/:spaceId/remove', safeRoute(async (req, res) => {
    const workDir = getWorkingDir(req.params.spaceId)
    res.json({ success: true, data: removeToolkitResource(workDir, req.body) })
  }))

  app.delete('/api/toolkit/:spaceId', safeRoute(async (req, res) => {
    const workDir = getWorkingDir(req.params.spaceId)
    clearSpaceToolkit(workDir)
    res.json({ success: true, data: null })
  }))

  app.post('/api/toolkit/:spaceId/migrate', safeRoute(async (req, res) => {
    const workDir = getWorkingDir(req.params.spaceId)
    const skills = Array.isArray(req.body?.skills) ? req.body.skills : []
    const agents = Array.isArray(req.body?.agents) ? req.body.agents : []
    res.json({ success: true, data: migrateToToolkit(workDir, skills, agents) })
  }))

  // ===== Preset Routes =====
  app.get('/api/presets', safeRoute(async (_req, res) => {
    const { listPresets } = await import('../../services/preset.service')
    res.json({ success: true, data: listPresets() })
  }))

  app.get('/api/presets/:presetId', safeRoute(async (req, res) => {
    const { getPreset } = await import('../../services/preset.service')
    const preset = getPreset(req.params.presetId)
    if (!preset) {
      res.json({ success: false, error: `Preset not found: ${req.params.presetId}` })
      return
    }
    res.json({ success: true, data: preset })
  }))

  // ===== Scene Taxonomy Routes =====
  app.get('/api/scene-taxonomy', safeRoute(async (_req, res) => {
    res.json(sceneTaxonomyController.getSceneTaxonomy())
  }))

  app.put('/api/scene-taxonomy/definitions', safeRoute(async (req, res) => {
    res.json(sceneTaxonomyController.upsertSceneDefinition(req.body))
  }))

  app.delete('/api/scene-taxonomy/definitions/:key', safeRoute(async (req, res) => {
    res.json(sceneTaxonomyController.removeSceneDefinition(req.params.key))
  }))

  app.put('/api/scene-taxonomy/overrides', safeRoute(async (req, res) => {
    const { resourceKey, tags } = req.body
    res.json(sceneTaxonomyController.setResourceSceneOverride(resourceKey, tags))
  }))

  app.delete('/api/scene-taxonomy/overrides', safeRoute(async (req, res) => {
    const resourceKey = typeof req.query.resourceKey === 'string'
      ? req.query.resourceKey
      : ''
    res.json(sceneTaxonomyController.removeResourceSceneOverride(resourceKey))
  }))

  app.get('/api/scene-taxonomy/export', safeRoute(async (_req, res) => {
    res.json(sceneTaxonomyController.exportSceneTaxonomy())
  }))

  app.post('/api/scene-taxonomy/import', safeRoute(async (req, res) => {
    const mode = req.body?.mode === 'replace' ? 'replace' : 'merge'
    res.json(sceneTaxonomyController.importSceneTaxonomy(req.body?.payload, mode))
  }))

  // ===== Skills Routes =====
  app.get('/api/skills', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const view = validateResourceListView(req, res)
    if (!view) return
    const { listSkills } = await import('../../services/skills.service')
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined
    res.json({ success: true, data: listSkills(workDir || undefined, view, locale) })
  }))

  app.get('/api/skills/content', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { getSkillContent } = await import('../../services/skills.service')
    const name = (req.query.name as string) || ''
    const content = getSkillContent(name, workDir || undefined)
    if (!content) {
      res.json({ success: false, error: `Skill not found: ${name}` })
      return
    }
    res.json({ success: true, data: content })
  }))

  app.post('/api/skills', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { createSkill } = await import('../../services/skills.service')
    const { name, content } = req.body
    res.json({ success: true, data: createSkill(workDir, name, content) })
  }))

  app.put('/api/skills', safeRoute(async (req, res) => {
    const { updateSkill } = await import('../../services/skills.service')
    const { skillPath, content } = req.body
    if (!updateSkill(skillPath, content)) {
      res.json({ success: false, error: 'Failed to update skill' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.delete('/api/skills', safeRoute(async (req, res) => {
    const { deleteSkill } = await import('../../services/skills.service')
    if (!deleteSkill(req.query.path as string)) {
      res.json({ success: false, error: 'Failed to delete skill' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.post('/api/skills/copy', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copySkillToSpace } = await import('../../services/skills.service')
    const { skillName } = req.body
    const skill = copySkillToSpace(skillName, workDir)
    if (!skill) {
      res.json({ success: false, error: `Failed to copy skill: ${skillName}` })
      return
    }
    res.json({ success: true, data: skill })
  }))

  app.post('/api/skills/copy-by-ref', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copySkillToSpaceByRef } = await import('../../services/skills.service')
    const { ref, options } = req.body
    res.json({ success: true, data: copySkillToSpaceByRef(ref, workDir, options) })
  }))

  app.post('/api/skills/clear-cache', safeRoute(async (_req, res) => {
    const { clearSkillsCache } = await import('../../services/skills.service')
    clearSkillsCache()
    res.json({ success: true })
  }))

  app.post('/api/skills/refresh', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const normalizedWorkDir = workDir || undefined

    const [{ clearPluginsCache }, { invalidateSkillsCache, clearSkillsCache }, { invalidateAgentsCache }, { invalidateCommandsCache }, { rebuildResourceIndex, rebuildAllResourceIndexes }] = await Promise.all([
      import('../../services/plugins.service'),
      import('../../services/skills.service'),
      import('../../services/agents.service'),
      import('../../services/commands.service'),
      import('../../services/resource-index.service')
    ])

    if (normalizedWorkDir) {
      invalidateSkillsCache(normalizedWorkDir)
      invalidateAgentsCache(normalizedWorkDir)
      invalidateCommandsCache(normalizedWorkDir)
      res.json({ success: true, data: rebuildResourceIndex(normalizedWorkDir, 'manual-refresh') })
      return
    }

    clearPluginsCache()
    clearSkillsCache()
    invalidateAgentsCache(null)
    invalidateCommandsCache(null)
    rebuildAllResourceIndexes('manual-refresh')
    res.json({ success: true, data: rebuildResourceIndex(undefined, 'manual-refresh') })
  }))

  // ===== Agents Routes =====
  app.get('/api/agents', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const view = validateResourceListView(req, res)
    if (!view) return
    const { listAgents } = await import('../../services/agents.service')
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined
    res.json({ success: true, data: listAgents(workDir || undefined, view, locale) })
  }))

  app.get('/api/agents/content', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { getAgentContent } = await import('../../services/agents.service')
    const name = (req.query.name as string) || ''
    const content = getAgentContent(name, workDir || undefined)
    if (!content) {
      res.json({ success: false, error: `Agent not found: ${name}` })
      return
    }
    res.json({ success: true, data: content })
  }))

  app.post('/api/agents', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { createAgent } = await import('../../services/agents.service')
    const { name, content } = req.body
    res.json({ success: true, data: createAgent(workDir, name, content) })
  }))

  app.put('/api/agents', safeRoute(async (req, res) => {
    const { updateAgent } = await import('../../services/agents.service')
    const { agentPath, content } = req.body
    if (!updateAgent(agentPath, content)) {
      res.json({ success: false, error: 'Failed to update agent' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.delete('/api/agents', safeRoute(async (req, res) => {
    const { deleteAgent } = await import('../../services/agents.service')
    if (!deleteAgent(req.query.path as string)) {
      res.json({ success: false, error: 'Failed to delete agent' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.post('/api/agents/copy', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copyAgentToSpace } = await import('../../services/agents.service')
    const { agentName } = req.body
    const agent = copyAgentToSpace(agentName, workDir)
    if (!agent) {
      res.json({ success: false, error: `Failed to copy agent: ${agentName}` })
      return
    }
    res.json({ success: true, data: agent })
  }))

  app.post('/api/agents/copy-by-ref', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copyAgentToSpaceByRef } = await import('../../services/agents.service')
    const { ref, options } = req.body
    res.json({ success: true, data: copyAgentToSpaceByRef(ref, workDir, options) })
  }))

  app.post('/api/agents/clear-cache', safeRoute(async (_req, res) => {
    const { clearAgentsCache } = await import('../../services/agents.service')
    clearAgentsCache()
    res.json({ success: true })
  }))

  // ===== Commands Routes =====
  app.get('/api/commands', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const view = validateResourceListView(req, res)
    if (!view) return
    const { listCommands } = await import('../../services/commands.service')
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined
    res.json({ success: true, data: listCommands(workDir || undefined, view, locale) })
  }))

  app.get('/api/commands/content', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { getCommandContent } = await import('../../services/commands.service')
    const name = (req.query.name as string) || ''
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined
    const executionMode = req.query.executionMode === 'execute' ? 'execute' : 'display'
    const content = getCommandContent(name, workDir || undefined, { locale, executionMode })
    if (!content) {
      res.json({ success: false, error: `Command not found: ${name}` })
      return
    }
    res.json({ success: true, data: content })
  }))

  app.post('/api/commands', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { createCommand } = await import('../../services/commands.service')
    const { name, content } = req.body
    res.json({ success: true, data: createCommand(workDir, name, content) })
  }))

  app.put('/api/commands', safeRoute(async (req, res) => {
    const { updateCommand } = await import('../../services/commands.service')
    const { commandPath, content } = req.body
    if (!updateCommand(commandPath, content)) {
      res.json({ success: false, error: 'Failed to update command' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.delete('/api/commands', safeRoute(async (req, res) => {
    const { deleteCommand } = await import('../../services/commands.service')
    if (!deleteCommand(req.query.path as string)) {
      res.json({ success: false, error: 'Failed to delete command' })
      return
    }
    res.json({ success: true, data: true })
  }))

  app.post('/api/commands/copy', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copyCommandToSpace } = await import('../../services/commands.service')
    const { commandName } = req.body
    const command = copyCommandToSpace(commandName, workDir)
    if (!command) {
      res.json({ success: false, error: `Failed to copy command: ${commandName}` })
      return
    }
    res.json({ success: true, data: command })
  }))

  app.post('/api/commands/copy-by-ref', safeRoute(async (req, res) => {
    const workDir = validateWorkDir(req, res)
    if (workDir === null) return
    const { copyCommandToSpaceByRef } = await import('../../services/commands.service')
    const { ref, options } = req.body
    res.json({ success: true, data: copyCommandToSpaceByRef(ref, workDir, options) })
  }))

  app.post('/api/commands/clear-cache', safeRoute(async (_req, res) => {
    const { clearCommandsCache } = await import('../../services/commands.service')
    clearCommandsCache()
    res.json({ success: true })
  }))

  // ===== Workflows Routes =====
  app.get('/api/workflows', safeRoute(async (req, res) => {
    const { listWorkflows } = await import('../../services/workflow.service')
    res.json({ success: true, data: listWorkflows(req.query.spaceId as string) })
  }))

  app.get('/api/workflows/:workflowId', safeRoute(async (req, res) => {
    const { getWorkflow } = await import('../../services/workflow.service')
    const workflow = getWorkflow(req.query.spaceId as string, req.params.workflowId)
    if (!workflow) {
      res.json({ success: false, error: `Workflow not found: ${req.params.workflowId}` })
      return
    }
    res.json({ success: true, data: workflow })
  }))

  app.post('/api/workflows', safeRoute(async (req, res) => {
    const { createWorkflow } = await import('../../services/workflow.service')
    const { spaceId, input } = req.body
    res.json({ success: true, data: createWorkflow(spaceId, input) })
  }))

  app.put('/api/workflows/:workflowId', safeRoute(async (req, res) => {
    const { updateWorkflow } = await import('../../services/workflow.service')
    const { spaceId, updates } = req.body
    const workflow = updateWorkflow(spaceId, req.params.workflowId, updates)
    if (!workflow) {
      res.json({ success: false, error: 'Failed to update workflow' })
      return
    }
    res.json({ success: true, data: workflow })
  }))

  app.delete('/api/workflows/:workflowId', safeRoute(async (req, res) => {
    const { deleteWorkflow } = await import('../../services/workflow.service')
    if (!deleteWorkflow(req.query.spaceId as string, req.params.workflowId)) {
      res.json({ success: false, error: 'Failed to delete workflow' })
      return
    }
    res.json({ success: true, data: true })
  }))

  // ===== Artifact Routes =====
  app.get('/api/spaces/:spaceId/artifacts', safeRoute(async (req, res) => {
    res.json({ success: true, data: listArtifacts(req.params.spaceId) })
  }))

  // Tree view of artifacts
  app.get('/api/spaces/:spaceId/artifacts/tree', safeRoute(async (req, res) => {
    const { listArtifactsTree } = await import('../../services/artifact.service')
    res.json({ success: true, data: listArtifactsTree(req.params.spaceId) })
  }))

  // Download single file
  app.get('/api/artifacts/download', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        res.status(400).json({ success: false, error: 'Missing file path' })
        return
      }

      // Security: ensure path is within allowed space directories
      const allowedPaths = getAllSpacePaths()
      const isAllowed = allowedPaths.some(spacePath => filePath.startsWith(spacePath))
      if (!isAllowed) {
        res.status(403).json({ success: false, error: 'Access denied' })
        return
      }

      if (!existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'File not found' })
        return
      }

      const stats = statSync(filePath)
      const fileName = basename(filePath)

      if (stats.isDirectory()) {
        // For directories, create a simple tar.gz stream
        // Note: This is a simplified implementation. For production, use archiver package.
        const files = collectFiles(filePath, filePath)
        if (files.length === 0) {
          res.status(404).json({ success: false, error: 'Directory is empty' })
          return
        }

        // Set headers for tar.gz download
        res.setHeader('Content-Type', 'application/gzip')
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.tar.gz"`)

        // Create a simple concatenated file stream with headers
        // For a proper implementation, use archiver or tar package
        // This is a fallback that just zips the first file for now
        const gzip = createGzip()
        const firstFile = files[0]
        const readStream = createReadStream(firstFile.fullPath)

        readStream.pipe(gzip).pipe(res)
      } else {
        // Single file download
        const mimeTypes: Record<string, string> = {
          html: 'text/html',
          htm: 'text/html',
          css: 'text/css',
          js: 'application/javascript',
          json: 'application/json',
          txt: 'text/plain',
          md: 'text/markdown',
          py: 'text/x-python',
          ts: 'text/typescript',
          tsx: 'text/typescript',
          jsx: 'text/javascript',
          svg: 'image/svg+xml',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          pdf: 'application/pdf',
        }

        const ext = fileName.split('.').pop()?.toLowerCase() || ''
        const contentType = mimeTypes[ext] || 'application/octet-stream'

        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
        res.setHeader('Content-Length', stats.size)

        const readStream = createReadStream(filePath)
        readStream.pipe(res)
      }
    } catch (error) {
      console.error('[Download] Error:', error)
      res.status(500).json({ success: false, error: (error as Error).message })
    }
  })

  // Download all artifacts in a space as zip
  app.get('/api/spaces/:spaceId/artifacts/download-all', async (req: Request, res: Response) => {
    try {
      const { spaceId } = req.params
      const workDir = getWorkingDir(spaceId)

      if (!existsSync(workDir)) {
        res.status(404).json({ success: false, error: 'Space not found' })
        return
      }

      const files = collectFiles(workDir, workDir)
      if (files.length === 0) {
        res.status(404).json({ success: false, error: 'No files to download' })
        return
      }

      // For simplicity, just download the first file if archiver is not available
      // A proper implementation would use archiver to create a zip
      const fileName = spaceId === 'kite-temp' ? 'kite-artifacts' : basename(workDir)
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.tar.gz"`)

      // Stream the first file with gzip as a demo
      // TODO: Use archiver for proper zip support
      const gzip = createGzip()
      const firstFile = files[0]
      const readStream = createReadStream(firstFile.fullPath)
      readStream.pipe(gzip).pipe(res)
    } catch (error) {
      console.error('[Download All] Error:', error)
      res.status(500).json({ success: false, error: (error as Error).message })
    }
  })

  console.log('[HTTP] API routes registered')
}
