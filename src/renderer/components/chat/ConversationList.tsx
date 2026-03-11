/**
 * Conversation List - Apple-style sidebar
 *
 * Design:
 * - Clean glass sidebar with subtle depth
 * - Conversation items with elegant hover states
 * - Skills & Agents panels at bottom
 * - Drag-to-resize support
 * - Inline title editing
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ConversationMeta } from '../../types'
import { Plus } from '../icons/ToolIcons'
import { ExternalLink, Pencil, Trash2, MessageCircle } from 'lucide-react'
import { useCanvasLifecycle } from '../../hooks/useCanvasLifecycle'
import { useTranslation } from '../../i18n'
import { shallow } from 'zustand/shallow'
import { SkillsPanel } from '../skills/SkillsPanel'
import { AgentsPanel } from '../agents/AgentsPanel'
import { CommandsPanel } from '../commands/CommandsPanel'
import { WorkflowsPanel } from '../workflows/WorkflowsPanel'
import type { SkillDefinition } from '../../stores/skills.store'
import type { AgentDefinition } from '../../stores/agents.store'
import { useSkillsStore } from '../../stores/skills.store'
import { useAgentsStore } from '../../stores/agents.store'
import { useCommandsStore } from '../../stores/commands.store'
import { useSpaceStore } from '../../stores/space.store'
import { toResourceKey } from '../../utils/resource-key'
import { commandKey } from '../../../shared/command-utils'

// Width constraints (in pixels)
const MIN_WIDTH = 200
const MAX_WIDTH = 340
const DEFAULT_WIDTH = 240
const CREATE_SKILLS_TRIGGER = '创建技能'
const CREATE_AGENTS_TRIGGER = '创建代理'
const CREATE_COMMANDS_TRIGGER = '创建命令'

function localizedResourceName(item: { name: string; displayName?: string; namespace?: string }): string {
  const base = item.displayName || item.name
  return item.namespace ? `${item.namespace}:${base}` : base
}

interface ConversationListProps {
  conversations: ConversationMeta[]
  currentConversationId?: string
  spaceId?: string
  layoutMode?: 'split' | 'tabs-only'
  onSelect: (id: string) => void
  onNew: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
  workDir?: string
  onSelectSkill?: (skill: SkillDefinition) => void
  onInsertSkill?: (skillName: string) => void
  onCreateSkill?: () => void
  onSelectAgent?: (agent: AgentDefinition) => void
  onInsertAgent?: (agentName: string) => void
  onCreateAgent?: () => void
  onInsertCommand?: (commandName: string) => void
  onCreateCommand?: () => void
}

export function ConversationList({
  conversations,
  currentConversationId,
  spaceId,
  layoutMode = 'split',
  onSelect,
  onNew,
  onDelete,
  onRename,
  workDir,
  onSelectSkill,
  onInsertSkill,
  onCreateSkill,
  onSelectAgent,
  onInsertAgent,
  onCreateAgent,
  onInsertCommand,
  onCreateCommand
}: ConversationListProps) {
  const { t } = useTranslation()
  const { openChat } = useCanvasLifecycle()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const dragWidthRafRef = useRef<number | null>(null)
  const pendingDragWidthRef = useRef<number | null>(null)
  const latestWidthRef = useRef(DEFAULT_WIDTH)
  const containerRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const resolvedWorkDir = useMemo(() => {
    if (workDir && workDir.trim()) return workDir
    return currentSpace?.path
  }, [currentSpace?.path, workDir])
  const { skills, loadedWorkDir: loadedSkillsWorkDir, loadSkills } = useSkillsStore((state) => ({
    skills: state.skills,
    loadedWorkDir: state.loadedWorkDir,
    loadSkills: state.loadSkills
  }), shallow)
  const { agents, loadedWorkDir: loadedAgentsWorkDir, loadAgents } = useAgentsStore((state) => ({
    agents: state.agents,
    loadedWorkDir: state.loadedWorkDir,
    loadAgents: state.loadAgents
  }), shallow)
  const { commands, loadedWorkDir: loadedCommandsWorkDir, loadCommands } = useCommandsStore((state) => ({
    commands: state.commands,
    loadedWorkDir: state.loadedWorkDir,
    loadCommands: state.loadCommands
  }), shallow)

  useEffect(() => {
    if (skills.length === 0 || loadedSkillsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadSkills(resolvedWorkDir)
    }
  }, [loadSkills, loadedSkillsWorkDir, resolvedWorkDir, skills.length])

  useEffect(() => {
    if (agents.length === 0 || loadedAgentsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadAgents(resolvedWorkDir)
    }
  }, [agents.length, loadAgents, loadedAgentsWorkDir, resolvedWorkDir])

  useEffect(() => {
    if (commands.length === 0 || loadedCommandsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadCommands(resolvedWorkDir)
    }
  }, [commands.length, loadCommands, loadedCommandsWorkDir, resolvedWorkDir])

  const skillDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of skills) {
      map.set(toResourceKey(item), localizedResourceName(item))
    }
    return map
  }, [skills])

  const agentDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of agents) {
      map.set(toResourceKey(item), localizedResourceName(item))
    }
    return map
  }, [agents])

  const commandDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of commands) {
      map.set(commandKey(item), localizedResourceName(item))
    }
    return map
  }, [commands])

  const localizeTriggerText = useCallback((text: string): string => {
    const match = text.match(/^([/@])([^\s]+)([\s\S]*)$/)
    if (!match) return text

    const prefix = match[1]
    const key = match[2]
    const tail = match[3] || ''

    if (prefix === '@') {
      const localized = agentDisplayMap.get(key)
      return localized ? `${prefix}${localized}${tail}` : text
    }

    const localizedSkill = skillDisplayMap.get(key)
    const localizedCommand = commandDisplayMap.get(key)

    // Keep original text when both resource types share the same key but map to different localized names.
    if (localizedSkill && localizedCommand && localizedSkill !== localizedCommand) {
      return text
    }

    const localized = localizedSkill || localizedCommand
    return localized ? `${prefix}${localized}${tail}` : text
  }, [agentDisplayMap, commandDisplayMap, skillDisplayMap])

  useEffect(() => {
    latestWidthRef.current = width
  }, [width])

  const applyDragWidth = useCallback((nextWidth: number) => {
    latestWidthRef.current = nextWidth
    setWidth(prevWidth => (prevWidth === nextWidth ? prevWidth : nextWidth))
  }, [])

  const scheduleDragWidthUpdate = useCallback((nextWidth: number) => {
    pendingDragWidthRef.current = nextWidth
    if (dragWidthRafRef.current !== null) return

    dragWidthRafRef.current = window.requestAnimationFrame(() => {
      dragWidthRafRef.current = null
      const pendingWidth = pendingDragWidthRef.current
      pendingDragWidthRef.current = null
      if (pendingWidth == null) return
      applyDragWidth(pendingWidth)
    })
  }, [applyDragWidth])

  const flushDragWidthUpdate = useCallback((): number => {
    if (dragWidthRafRef.current !== null) {
      window.cancelAnimationFrame(dragWidthRafRef.current)
      dragWidthRafRef.current = null
    }

    const pendingWidth = pendingDragWidthRef.current
    pendingDragWidthRef.current = null
    if (pendingWidth == null) return latestWidthRef.current

    applyDragWidth(pendingWidth)
    return pendingWidth
  }, [applyDragWidth])

  // Handle drag resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const clampWidthAtPosition = (clientX: number): number | null => {
      if (!containerRef.current) return null
      const containerRect = containerRef.current.getBoundingClientRect()
      const nextWidth = clientX - containerRect.left
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth))
    }

    const handleMouseMove = (e: MouseEvent) => {
      const clampedWidth = clampWidthAtPosition(e.clientX)
      if (clampedWidth == null) return
      scheduleDragWidthUpdate(clampedWidth)
    }

    const handleMouseUp = (e: MouseEvent) => {
      const clampedWidth = clampWidthAtPosition(e.clientX)
      if (clampedWidth != null) {
        pendingDragWidthRef.current = clampedWidth
      }
      flushDragWidthUpdate()
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [flushDragWidthUpdate, isDragging, scheduleDragWidthUpdate])

  useEffect(() => {
    return () => {
      if (dragWidthRafRef.current !== null) {
        window.cancelAnimationFrame(dragWidthRafRef.current)
      }
      dragWidthRafRef.current = null
      pendingDragWidthRef.current = null
    }
  }, [])

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const isToday = date.toDateString() === now.toDateString()

    if (diffMins < 1) return t('Just now')
    if (diffMins < 60) return `${diffMins}m`
    if (isToday) return `${diffHours}h`
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  // Start editing
  const handleStartEdit = (e: React.MouseEvent, conv: ConversationMeta) => {
    e.stopPropagation()
    setEditingId(conv.id)
    setEditingTitle(conv.title || '')
  }

  // Save edit
  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim() && onRename) {
      onRename(editingId, editingTitle.trim())
    }
    setEditingId(null)
    setEditingTitle('')
  }

  // Cancel edit
  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingTitle('')
  }

  // Key events
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  return (
    <div
      ref={containerRef}
      className="space-studio-sidebar space-studio-reveal flex flex-col relative overflow-hidden"
      style={{ width, transition: isDragging ? 'none' : 'width 0.2s ease' }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-border/20">
        <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-[0.2em]">
          {t('Conversations')}
        </span>
        <button
          onClick={onNew}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border/40 bg-background/50 hover:bg-background hover:border-border/60 transition-all duration-200 group"
          title={t('New conversation')}
        >
          <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-auto px-3 py-4">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-background/60 border border-border/40 flex items-center justify-center mb-4">
              <MessageCircle className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground/50">{t('No conversations yet')}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {conversations.map((conversation) => {
              const displayTitle = localizeTriggerText(conversation.title)
              const displayPreview = conversation.preview ? localizeTriggerText(conversation.preview) : undefined

              return (
                <div
                  key={conversation.id}
                  onClick={() => editingId !== conversation.id && onSelect(conversation.id)}
                  className={`
                    space-studio-sidebar-item w-full px-3.5 py-3.5 pr-14 rounded-2xl text-left transition-all duration-200 cursor-pointer group relative
                    ${conversation.id === currentConversationId
                      ? 'active'
                      : 'hover:bg-secondary/30'
                    }
                  `}
                >
                  {/* Selection indicator */}
                  {conversation.id === currentConversationId && (
                    <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-[hsl(var(--space-accent))] rounded-full" />
                  )}

                  {/* Edit mode */}
                  {editingId === conversation.id ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={handleSaveEdit}
                        className="flex-1 text-sm bg-input border border-border/50 rounded-lg px-3 py-2 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 min-w-0 transition-all"
                        placeholder={t('Conversation title...')}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-sm truncate flex-1 leading-5 ${
                          conversation.id === currentConversationId ? 'font-medium text-foreground' : 'text-foreground/75'
                        }`}>
                          {displayTitle.slice(0, 24)}
                          {displayTitle.length > 24 && '...'}
                        </span>
                        <span className="text-[11px] text-muted-foreground/40 flex-shrink-0 tabular-nums">
                          {formatDate(conversation.updatedAt)}
                        </span>
                      </div>

                      {displayPreview && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <p className="text-xs text-muted-foreground/45 truncate flex-1">
                            {displayPreview.slice(0, 40)}
                          </p>
                        </div>
                      )}

                      {/* Action buttons (on hover) */}
                      <div className="absolute right-2 top-2 flex items-center gap-1 px-1 py-0.5 rounded-lg border border-border/40 bg-background/80 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-150">
                        {spaceId && layoutMode !== 'tabs-only' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openChat(spaceId, conversation.id, conversation.title, resolvedWorkDir)
                            }}
                            className="p-1.5 hover:bg-background/90 rounded-lg transition-colors"
                            title={t('Open in tab')}
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {onRename && (
                          <button
                            onClick={(e) => handleStartEdit(e, conversation)}
                            className="p-1.5 hover:bg-background/90 rounded-lg transition-colors"
                            title={t('Edit title')}
                          >
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDelete(conversation.id)
                            }}
                            className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors"
                            title={t('Delete conversation')}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Skills & Agents panels */}
      <div className="space-studio-sidebar-tools p-3.5 space-y-2">
        <SkillsPanel
          workDir={resolvedWorkDir}
          onSelectSkill={onSelectSkill}
          onInsertSkill={onInsertSkill}
          onCreateSkill={onCreateSkill}
          onInsertCreateSkill={() => onInsertSkill?.(CREATE_SKILLS_TRIGGER)}
          preferInsertOnClick
        />
        <AgentsPanel
          workDir={resolvedWorkDir}
          onSelectAgent={onSelectAgent}
          onInsertAgent={onInsertAgent}
          onCreateAgent={onCreateAgent}
          onInsertCreateAgent={() => onInsertAgent?.(CREATE_AGENTS_TRIGGER)}
          preferInsertOnClick
        />
        <CommandsPanel
          workDir={resolvedWorkDir}
          onInsertCommand={onInsertCommand}
          onCreateCommand={onCreateCommand}
          onInsertCreateCommand={() => onInsertCommand?.(CREATE_COMMANDS_TRIGGER)}
          preferInsertOnClick
        />
        {spaceId && (
          <WorkflowsPanel spaceId={spaceId} />
        )}
      </div>

      {/* Drag handle */}
      <div
        className={`
          absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20
          transition-colors duration-200
          hover:bg-[hsl(var(--space-accent)/0.3)]
          ${isDragging ? 'bg-[hsl(var(--space-accent)/0.4)]' : ''}
        `}
        onMouseDown={handleMouseDown}
        title={t('Drag to resize width')}
      />
    </div>
  )
}
