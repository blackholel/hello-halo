/**
 * Space Page - Chat interface with artifact rail and content canvas
 * Supports multi-conversation with isolated session states per space
 *
 * Layout modes:
 * - Chat mode: Full-width chat view (when no canvas tabs open)
 * - Canvas mode: Split view with narrower chat + content canvas
 * - Mobile mode: Full-screen panels with overlay canvas
 *
 * Layout preferences:
 * - Artifact Rail expansion state (persisted per space)
 * - Chat width when canvas is open (persisted per space)
 * - Maximized mode overrides (temporary)
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../stores/app.store'
import { useSpaceStore } from '../stores/space.store'
import { useChatStore } from '../stores/chat.store'
import { useCanvasStore, useCanvasIsOpen, useCanvasIsMaximized } from '../stores/canvas.store'
import { canvasLifecycle } from '../services/canvas-lifecycle'
import { useSearchStore } from '../stores/search.store'
import { ChatView } from '../components/chat/ChatView'
import { ArtifactRail } from '../components/artifact/ArtifactRail'
import { ConversationList } from '../components/chat/ConversationList'
import { ChatHistoryPanel } from '../components/chat/ChatHistoryPanel'
import { SpaceIcon } from '../components/icons/ToolIcons'
import { Header } from '../components/layout/Header'
import { ContentCanvas, CanvasToggleButton } from '../components/canvas'
import { GitBashWarningBanner } from '../components/setup/GitBashWarningBanner'
import { api } from '../api'
import { useLayoutPreferences, LAYOUT_DEFAULTS } from '../hooks/useLayoutPreferences'
import { useWindowMaximize } from '../components/canvas/viewers/useWindowMaximize'
import { useCanvasLifecycle } from '../hooks/useCanvasLifecycle'
import { PanelLeftClose, PanelLeft, X, MessageSquare, Columns2, LayoutGrid } from 'lucide-react'
import { SearchIcon } from '../components/search/SearchIcon'
import { useSearchShortcuts } from '../hooks/useSearchShortcuts'
import { useTranslation } from '../i18n'
import { SkillDetailModal } from '../components/skills/SkillDetailModal'
import { SkillEditorModal } from '../components/skills/SkillEditorModal'
import { AgentDetailModal } from '../components/agents/AgentDetailModal'
import { AgentEditorModal } from '../components/agents/AgentEditorModal'
import { CommandEditorModal } from '../components/commands/CommandEditorModal'
import { useSkillsStore, type SkillDefinition } from '../stores/skills.store'
import { useAgentsStore, type AgentDefinition } from '../stores/agents.store'
import { useCommandsStore, type CommandDefinition } from '../stores/commands.store'
import { useToolkitStore } from '../stores/toolkit.store'
import { useComposerStore } from '../stores/composer.store'

const CREATE_SKILLS_TRIGGER_EN = 'create-skills'
const CREATE_AGENTS_TRIGGER_EN = 'create-agents'
const CREATE_COMMANDS_TRIGGER_EN = 'create-commands'
const CREATE_SKILLS_TRIGGER_ZH = '创建技能'
const CREATE_AGENTS_TRIGGER_ZH = '创建代理'
const CREATE_COMMANDS_TRIGGER_ZH = '创建命令'

const CREATE_SKILLS_ALIASES = [CREATE_SKILLS_TRIGGER_EN, CREATE_SKILLS_TRIGGER_ZH] as const
const CREATE_AGENTS_ALIASES = [CREATE_AGENTS_TRIGGER_EN, CREATE_AGENTS_TRIGGER_ZH] as const
const CREATE_COMMANDS_ALIASES = [CREATE_COMMANDS_TRIGGER_EN, CREATE_COMMANDS_TRIGGER_ZH] as const

const CREATE_SKILLS_CONTENT_EN = `---
name: Create Skills
description: Help create or update skills for the current space.
---

# Create Skills

Use this skill to create or update space-level skills under \`.claude/skills\`.

When invoked:
1. Ask the user what capability they want.
2. Draft or update the target \`SKILL.md\`.
3. Save it in the current space and explain how to trigger it.
`

const CREATE_SKILLS_CONTENT_ZH = `---
name: 创建技能
description: 帮助在当前空间创建或更新技能。
---

# 创建技能

用于在当前空间的 \`.claude/skills\` 下创建或更新技能。

执行时：
1. 先确认用户想要的能力边界；
2. 生成或更新对应 \`SKILL.md\`；
3. 保存到当前空间并说明触发方式。
`

const CREATE_AGENTS_CONTENT_EN = `---
name: Create Agents
description: Help create or update agents for the current space.
---

# Create Agents

Use this agent to create or update space-level agents under \`.claude/agents\`.

When invoked:
1. Clarify the agent role and boundaries.
2. Draft or update the agent markdown file.
3. Save it in the current space and explain how to use it.
`

const CREATE_AGENTS_CONTENT_ZH = `---
name: 创建代理
description: 帮助在当前空间创建或更新代理。
---

# 创建代理

用于在当前空间的 \`.claude/agents\` 下创建或更新代理文件。

执行时：
1. 明确代理职责和禁区；
2. 生成或更新代理 markdown；
3. 保存到当前空间并给出调用方式。
`

const CREATE_COMMANDS_CONTENT_EN = `---
name: Create Commands
description: Help create or update commands for the current space.
---

# /create-commands

Use this command to create or update space-level commands under \`.claude/commands\`.

When invoked:
1. Ask for the command intent and expected inputs.
2. Draft or update the command markdown file.
3. Save it in the current space and provide usage examples.
`

const CREATE_COMMANDS_CONTENT_ZH = `---
name: 创建命令
description: 帮助在当前空间创建或更新命令。
---

# /创建命令

用于在当前空间的 \`.claude/commands\` 下创建或更新命令文件。

执行时：
1. 明确命令目标和参数；
2. 生成或更新命令 markdown；
3. 保存到当前空间并给出使用示例。
`

function isSpaceResource(source: string): boolean {
  return source === 'space'
}

function pickTemplateResource<T extends { name: string; source: string }>(
  items: T[],
  name: string
): T | null {
  // Prefer app-level templates from ~/.kite, then fall back to other non-space sources.
  const appLevel = items.find(item => item.name === name && item.source === 'app')
  if (appLevel) return appLevel
  const nonSpace = items.find(item => item.name === name && !isSpaceResource(item.source))
  return nonSpace ?? null
}

function matchesAlias(value: string, aliases: readonly string[]): boolean {
  return aliases.includes(value)
}

// Mobile breakpoint (matches Tailwind sm: 640px)
const MOBILE_BREAKPOINT = 640

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < MOBILE_BREAKPOINT
  })

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}

export function SpacePage() {
  const { t } = useTranslation()
  const { setView, mockBashMode, gitBashInstallProgress, startGitBashInstall } = useAppStore()
  const { currentSpace } = useSpaceStore()
  const {
    currentSpaceId,
    setCurrentSpace,
    getConversations,
    getCurrentConversation,
    getCurrentConversationId,
    isLoading,
    loadConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation
  } = useChatStore()

  // Get current data from store
  const conversations = getConversations()
  const currentConversation = getCurrentConversation()
  const currentConversationId = getCurrentConversationId()

  // Show conversation list sidebar - default to true for better UX
  const [showConversationList, setShowConversationList] = useState(true)

  // Skills panel state
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [isSkillEditorOpen, setIsSkillEditorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null)
  const [isAgentEditorOpen, setIsAgentEditorOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<CommandDefinition | null>(null)
  const [isCommandEditorOpen, setIsCommandEditorOpen] = useState(false)
  const requestInsert = useComposerStore(state => state.requestInsert)

  const ensureCreateSkillResource = useCallback(async (triggerName: string) => {
    const workDir = currentSpace?.path
    if (!workDir) return
    const store = useSkillsStore.getState()
    await store.loadSkills(workDir)
    const skills = useSkillsStore.getState().skills
    const exists = skills.some(
      skill => skill.source === 'space' && skill.name === triggerName
    )
    if (exists) return

    const template = pickTemplateResource(skills, triggerName)
      ?? pickTemplateResource(skills, CREATE_SKILLS_TRIGGER_EN)
    if (template) {
      if (template.name === triggerName) {
        await useSkillsStore.getState().copyToSpace(template, workDir, { overwrite: false })
      } else {
        const templateContent = await useSkillsStore.getState().loadSkillContent(template.name, workDir)
        const fallbackContent = triggerName === CREATE_SKILLS_TRIGGER_ZH
          ? CREATE_SKILLS_CONTENT_ZH
          : CREATE_SKILLS_CONTENT_EN
        await useSkillsStore.getState().createSkill(
          workDir,
          triggerName,
          templateContent?.content ?? fallbackContent
        )
      }
      await useSkillsStore.getState().loadSkills(workDir)
      return
    }

    const fallbackContent = triggerName === CREATE_SKILLS_TRIGGER_ZH
      ? CREATE_SKILLS_CONTENT_ZH
      : CREATE_SKILLS_CONTENT_EN
    await useSkillsStore.getState().createSkill(workDir, triggerName, fallbackContent)
    await useSkillsStore.getState().loadSkills(workDir)
  }, [currentSpace?.path])

  const ensureCreateAgentResource = useCallback(async (triggerName: string) => {
    const workDir = currentSpace?.path
    if (!workDir) return
    const store = useAgentsStore.getState()
    await store.loadAgents(workDir)
    const agents = useAgentsStore.getState().agents
    const exists = agents.some(
      agent => agent.source === 'space' && agent.name === triggerName
    )
    if (exists) return

    const template = pickTemplateResource(agents, triggerName)
      ?? pickTemplateResource(agents, CREATE_AGENTS_TRIGGER_EN)
    if (template) {
      if (template.name === triggerName) {
        await useAgentsStore.getState().copyToSpace(template, workDir, { overwrite: false })
      } else {
        const templateContent = await useAgentsStore.getState().loadAgentContent(template.name, workDir)
        const fallbackContent = triggerName === CREATE_AGENTS_TRIGGER_ZH
          ? CREATE_AGENTS_CONTENT_ZH
          : CREATE_AGENTS_CONTENT_EN
        await useAgentsStore.getState().createAgent(
          workDir,
          triggerName,
          templateContent?.content ?? fallbackContent
        )
      }
      await useAgentsStore.getState().loadAgents(workDir)
      return
    }

    const fallbackContent = triggerName === CREATE_AGENTS_TRIGGER_ZH
      ? CREATE_AGENTS_CONTENT_ZH
      : CREATE_AGENTS_CONTENT_EN
    await useAgentsStore.getState().createAgent(workDir, triggerName, fallbackContent)
    await useAgentsStore.getState().loadAgents(workDir)
  }, [currentSpace?.path])

  const ensureCreateCommandResource = useCallback(async (triggerName: string) => {
    const workDir = currentSpace?.path
    if (!workDir) return
    const store = useCommandsStore.getState()
    await store.loadCommands(workDir)
    const commands = useCommandsStore.getState().commands
    const exists = commands.some(
      command => command.source === 'space' && command.name === triggerName
    )
    if (exists) return

    const template = pickTemplateResource(commands, triggerName)
      ?? pickTemplateResource(commands, CREATE_COMMANDS_TRIGGER_EN)
    if (template) {
      if (template.name === triggerName) {
        await useCommandsStore.getState().copyToSpace(template, workDir, { overwrite: false })
      } else {
        const templateContent = await useCommandsStore.getState().getCommandContent(template.name, workDir)
        const fallbackContent = triggerName === CREATE_COMMANDS_TRIGGER_ZH
          ? CREATE_COMMANDS_CONTENT_ZH
          : CREATE_COMMANDS_CONTENT_EN
        await useCommandsStore.getState().createCommand(
          workDir,
          triggerName,
          templateContent ?? fallbackContent
        )
      }
      await useCommandsStore.getState().loadCommands(workDir)
      return
    }

    const fallbackContent = triggerName === CREATE_COMMANDS_TRIGGER_ZH
      ? CREATE_COMMANDS_CONTENT_ZH
      : CREATE_COMMANDS_CONTENT_EN
    await useCommandsStore.getState().createCommand(workDir, triggerName, fallbackContent)
    await useCommandsStore.getState().loadCommands(workDir)
  }, [currentSpace?.path])

  const handleInsertSkill = useCallback((skillName: string) => {
    const normalized = skillName.trim()
    if (!normalized) return
    if (matchesAlias(normalized, CREATE_SKILLS_ALIASES)) {
      void (async () => {
        await ensureCreateSkillResource(normalized)
        requestInsert(`/${normalized} `, 'skill')
      })()
      return
    }
    requestInsert(`/${normalized} `, 'skill')
  }, [ensureCreateSkillResource, requestInsert])

  const handleInsertAgent = useCallback((agentName: string) => {
    const normalized = agentName.trim()
    if (!normalized) return
    if (matchesAlias(normalized, CREATE_AGENTS_ALIASES)) {
      void (async () => {
        await ensureCreateAgentResource(normalized)
        requestInsert(`@${normalized} `, 'agent')
      })()
      return
    }
    requestInsert(`@${normalized} `, 'agent')
  }, [ensureCreateAgentResource, requestInsert])

  const handleInsertCommand = useCallback((commandName: string) => {
    const normalized = commandName.trim()
    if (!normalized) return
    if (matchesAlias(normalized, CREATE_COMMANDS_ALIASES)) {
      void (async () => {
        await ensureCreateCommandResource(normalized)
        requestInsert(`/${normalized} `, 'command')
      })()
      return
    }
    requestInsert(`/${normalized} `, 'command')
  }, [ensureCreateCommandResource, requestInsert])

  const handleCreateSkill = useCallback(() => {
    setEditingSkill(null)
    setIsSkillEditorOpen(true)
  }, [])

  const handleEditSkill = useCallback((skill: SkillDefinition) => {
    setEditingSkill(skill)
    setIsSkillEditorOpen(true)
  }, [])

  const handleCreateAgent = useCallback(() => {
    setEditingAgent(null)
    setIsAgentEditorOpen(true)
  }, [])

  const handleCreateCommand = useCallback(() => {
    setEditingCommand(null)
    setIsCommandEditorOpen(true)
  }, [])

  const handleEditAgent = useCallback((agent: AgentDefinition) => {
    setEditingAgent(agent)
    setIsAgentEditorOpen(true)
  }, [])

  const { loadSkills } = useSkillsStore()
  const { loadAgents } = useAgentsStore()
  const { loadCommands } = useCommandsStore()
  const { loadToolkit, isToolkitLoaded } = useToolkitStore()

  // Preload skills/agents/commands when space changes
  useEffect(() => {
    if (currentSpace?.path) {
      loadSkills(currentSpace.path)
      loadAgents(currentSpace.path)
      loadCommands(currentSpace.path)
    }
  }, [currentSpace?.path, loadSkills, loadAgents, loadCommands])

  useEffect(() => {
    if (!currentSpace || currentSpace.isTemp) return
    const toolkitLoaded = isToolkitLoaded(currentSpace.id)
    if (toolkitLoaded) return
    void loadToolkit(currentSpace.id)
  }, [currentSpace?.id, currentSpace?.isTemp, isToolkitLoaded, loadToolkit])

  // Layout mode: 'split' = 分栏布局 (左侧固定 ChatView), 'tabs-only' = 纯标签页模式
  const [layoutMode, setLayoutMode] = useState<'split' | 'tabs-only'>(() => {
    // Restore from localStorage, default to 'tabs-only'
    const saved = localStorage.getItem('kite-layout-mode')
    return (saved === 'split') ? 'split' : 'tabs-only'
  })

  // Persist layout mode
  useEffect(() => {
    localStorage.setItem('kite-layout-mode', layoutMode)
  }, [layoutMode])

  // Canvas state - use precise selectors to minimize re-renders
  const isCanvasOpen = useCanvasIsOpen()
  const isCanvasMaximized = useCanvasIsMaximized()
  // Only subscribe to tab count, not entire tabs array (avoid re-render on tab content changes)
  const canvasTabCount = useCanvasStore(state => state.tabs.length)
  const isCanvasTransitioning = useCanvasStore(state => state.isTransitioning)
  const setCanvasOpen = useCanvasStore(state => state.setOpen)
  const setCanvasMaximized = useCanvasStore(state => state.setMaximized)
  // Detect if any browser tab is open (native BrowserView)
  // When browser tabs exist, disable CSS transitions to sync with native view resize
  // Use selector to compute this inside store subscription (avoids subscribing to full tabs array)
  const hasBrowserTab = useCanvasStore(state => state.tabs.some(tab => tab.type === 'browser'))

  // Canvas lifecycle for opening chat tabs
  const { openChat } = useCanvasLifecycle()

  // Mobile detection
  const isMobile = useIsMobile()

  // Window maximize state
  const { isMaximized } = useWindowMaximize()

  // Layout preferences (persisted per space)
  const {
    effectiveRailExpanded,
    effectiveChatWidth,
    setRailExpanded,
    setChatWidth,
    chatWidthMin,
    chatWidthMax,
  } = useLayoutPreferences(currentSpace?.id, isMaximized)

  // Chat width drag state
  const [isDraggingChat, setIsDraggingChat] = useState(false)
  const [dragChatWidth, setDragChatWidth] = useState(effectiveChatWidth)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Search UI state
  const { openSearch } = useSearchStore()

  // Sync drag width with effective width when not dragging
  useEffect(() => {
    if (!isDraggingChat) {
      setDragChatWidth(effectiveChatWidth)
    }
  }, [effectiveChatWidth, isDraggingChat])

  // Handle chat width drag
  const handleChatDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingChat(true)
  }, [])

  // Chat drag move/end handlers
  useEffect(() => {
    if (!isDraggingChat) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!chatContainerRef.current) return

      // Calculate width from left edge of chat container to mouse position
      const containerRect = chatContainerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - containerRect.left

      // Clamp to constraints
      const clampedWidth = Math.max(chatWidthMin, Math.min(chatWidthMax, newWidth))
      setDragChatWidth(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsDraggingChat(false)
      // Persist the final width
      setChatWidth(dragChatWidth)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingChat, dragChatWidth, chatWidthMin, chatWidthMax, setChatWidth])

  // Close canvas when switching to mobile with canvas open
  useEffect(() => {
    if (isMobile && isCanvasOpen) {
      // Keep canvas open on mobile but we'll show it as overlay
    }
  }, [isMobile, isCanvasOpen])

  // Space isolation: clear canvas tabs when switching to a different space
  useEffect(() => {
    if (!currentSpace) return

    let cancelled = false
    void (async () => {
      await canvasLifecycle.enterSpace(currentSpace.id)
      if (cancelled) return
    })()

    return () => {
      cancelled = true
    }
  }, [currentSpace?.id])

  // BrowserView visibility: hide when leaving SpacePage, show when returning
  useEffect(() => {
    if (!currentSpace) return

    if (isCanvasOpen) {
      canvasLifecycle.showActiveBrowserView()
    }

    return () => {
      canvasLifecycle.hideAllBrowserViews()
    }
  }, [currentSpace?.id, isCanvasOpen])

  // Initialize space when entering
  // On first entry: load conversations but don't auto-select (show welcome state)
  // Only auto-select if user previously had a conversation selected
  useEffect(() => {
    if (!currentSpace) return

    // Set current space in chat store
    setCurrentSpace(currentSpace.id)

    // Load conversations if not already loaded for this space
    const initSpace = async () => {
      await loadConversations(currentSpace.id)

      // After loading, check state
      const store = useChatStore.getState()
      const spaceState = store.getSpaceState(currentSpace.id)

      if (spaceState.conversations.length > 0) {
        // If a conversation was previously selected (returning to space), keep it
        // Otherwise, don't auto-select - show the welcome state instead
        // This gives a clean entry experience
      } else {
        // No conversations exist - create a new one (will show empty/welcome state)
        await createConversation(currentSpace.id)
      }
    }

    initSpace()
  }, [currentSpace?.id]) // Only re-run when space ID changes

  // In tabs-only mode, auto-open conversation in tab when entering space
  useEffect(() => {
    if (layoutMode !== 'tabs-only' || !currentSpace || isLoading) return

    // Wait for conversations to be loaded
    if (conversations.length === 0) return

    // Check if any chat tab is already open for this space
    const tabs = canvasLifecycle.getTabs()
    const hasOpenChatTab = tabs.some(
      tab => tab.type === 'chat' && tab.spaceId === currentSpace.id
    )

    // If no chat tab is open, open the current or first conversation
    if (!hasOpenChatTab) {
      const convToOpen = currentConversationId
        ? conversations.find(c => c.id === currentConversationId)
        : conversations[0]

      if (convToOpen) {
        openChat(currentSpace.id, convToOpen.id, convToOpen.title, currentSpace.path)
      }
    }
  }, [layoutMode, currentSpace?.id, conversations.length, isLoading])

  // Handle back
  const handleBack = () => {
    setView('home')
  }

  // Handle new conversation
  const handleNewConversation = useCallback(async () => {
    if (!currentSpace) return

    const newConv = await createConversation(currentSpace.id)

    // In tabs-only mode, open the new conversation in a tab
    if (layoutMode === 'tabs-only' && newConv) {
      openChat(currentSpace.id, newConv.id, newConv.title, currentSpace.path)
    }
  }, [currentSpace, createConversation, layoutMode, openChat])

  // Handle select conversation - smart behavior based on layout mode
  const handleSelectConversation = useCallback((id: string) => {
    if (layoutMode === 'tabs-only' && currentSpace) {
      // In tabs-only mode, open conversation in a tab
      const conv = conversations.find(c => c.id === id)
      if (conv) {
        openChat(currentSpace.id, id, conv.title, currentSpace.path)
      }
    } else {
      // In split mode, update the main ChatView
      selectConversation(id)
    }
  }, [layoutMode, currentSpace, conversations, openChat, selectConversation])

  if (!currentSpace) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-muted-foreground">No space selected</p>
      </div>
    )
  }

  // Handle delete conversation
  const handleDeleteConversation = async (conversationId: string) => {
    if (currentSpace) {
      await deleteConversation(currentSpace.id, conversationId)
    }
  }

  // Handle rename conversation
  const handleRenameConversation = async (conversationId: string, newTitle: string) => {
    if (currentSpace) {
      await renameConversation(currentSpace.id, conversationId, newTitle)
    }
  }

  // Exit maximized mode when canvas closes
  useEffect(() => {
    if (!isCanvasOpen && isCanvasMaximized) {
      setCanvasMaximized(false)
    }
  }, [isCanvasOpen, isCanvasMaximized, setCanvasMaximized])

  // Auto-collapse rail when entering maximized mode, restore when exiting
  const prevMaximizedRef = useRef(isCanvasMaximized)
  const railExpandedBeforeMaximize = useRef(effectiveRailExpanded)

  useEffect(() => {
    if (isCanvasMaximized && !prevMaximizedRef.current) {
      // Entering maximized mode - save current state and collapse
      railExpandedBeforeMaximize.current = effectiveRailExpanded
      if (effectiveRailExpanded) {
        setRailExpanded(false)
      }
      // Show overlay chat capsule (renders above BrowserView)
      if (!isMobile) {
        api.showChatCapsuleOverlay()
      }
    } else if (!isCanvasMaximized && prevMaximizedRef.current) {
      // Exiting maximized mode - restore previous state
      if (railExpandedBeforeMaximize.current) {
        setRailExpanded(true)
      }
      // Hide overlay chat capsule
      if (!isMobile) {
        api.hideChatCapsuleOverlay()
      }
    }
    prevMaximizedRef.current = isCanvasMaximized
  }, [isCanvasMaximized, effectiveRailExpanded, setRailExpanded, isMobile])

  // Listen for exit-maximized event from overlay
  useEffect(() => {
    const cleanup = api.onCanvasExitMaximized(() => {
      setCanvasMaximized(false)
    })
    return cleanup
  }, [setCanvasMaximized])

  // Setup search shortcuts
  useSearchShortcuts({
    enabled: true,
    onSearch: (scope) => openSearch(scope)
  })

  return (
    <div className="h-full w-full flex flex-col">
      {/*
        ChatCapsule overlay is now managed via IPC to render above BrowserView.
        The overlay SPA is a separate WebContentsView that appears above all views.
        Show/hide is controlled by api.showChatCapsuleOverlay() / api.hideChatCapsuleOverlay()
      */}

      {/* Header - replaced with drag region spacer when maximized (for macOS traffic lights) */}
      {isCanvasMaximized ? (
        <div
          className="h-11 flex-shrink-0 bg-background"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      ) : (
      <Header
        left={
          <>
            <button
              onClick={handleBack}
              className="p-1.5 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
            >
              <svg className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center gap-2">
              <SpaceIcon iconId={currentSpace.icon} size={20} />
              <span className="font-semibold text-sm tracking-tight">
                {currentSpace.isTemp ? 'Kite' : currentSpace.name}
              </span>
            </div>

            {/* Chat History Panel - integrated in header */}
            {conversations.length > 0 && (
              <div className="ml-0.5">
                <ChatHistoryPanel
                  conversations={conversations}
                  currentConversationId={currentConversationId}
                  spaceId={currentSpace.id}
                  workDir={currentSpace.path}
                  layoutMode={layoutMode}
                  onSelect={handleSelectConversation}
                  onNew={handleNewConversation}
                  onDelete={handleDeleteConversation}
                  onRename={handleRenameConversation}
                  spaceName={currentSpace.isTemp ? t('Kite Space') : currentSpace.name}
                />
              </div>
            )}
          </>
        }
        right={
          <>
            {/* New conversation */}
            <button
              onClick={handleNewConversation}
              className="p-2 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
              title={t('New conversation')}
            >
              <svg className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Sidebar toggle */}
            <button
              onClick={() => setShowConversationList(!showConversationList)}
              className={`p-2 rounded-xl transition-all duration-200 ${
                showConversationList
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-secondary/80 text-muted-foreground hover:text-foreground'
              }`}
              title={t('Sidebar')}
            >
              {showConversationList ? (
                <PanelLeftClose className="w-[18px] h-[18px]" />
              ) : (
                <PanelLeft className="w-[18px] h-[18px]" />
              )}
            </button>

            {/* Search */}
            <SearchIcon onClick={openSearch} isInSpace={true} />

            {/* Layout mode toggle */}
            <button
              onClick={() => setLayoutMode(layoutMode === 'split' ? 'tabs-only' : 'split')}
              className={`p-2 rounded-xl transition-all duration-200 ${
                layoutMode === 'tabs-only'
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-secondary/80 text-muted-foreground hover:text-foreground'
              }`}
              title={layoutMode === 'split' ? t('Switch to tabs-only mode') : t('Switch to split mode')}
            >
              {layoutMode === 'split' ? (
                <LayoutGrid className="w-[18px] h-[18px]" />
              ) : (
                <Columns2 className="w-[18px] h-[18px]" />
              )}
            </button>

            {/* Settings */}
            <button
              onClick={() => setView('settings')}
              className="p-2 rounded-xl hover:bg-secondary/80 transition-all duration-200 group"
              title={t('Settings')}
            >
              <svg className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </>
        }
      />
      )}

      {/* Git Bash Warning Banner - Windows only, when in mock mode */}
      {mockBashMode && !isCanvasMaximized && (
        <GitBashWarningBanner
          installProgress={gitBashInstallProgress}
          onInstall={startGitBashInstall}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation list sidebar - hidden when maximized */}
        {showConversationList && !isCanvasMaximized && (
          <ConversationList
            conversations={conversations}
            currentConversationId={currentConversationId}
            spaceId={currentSpace.id}
            layoutMode={layoutMode}
            onSelect={handleSelectConversation}
            onNew={handleNewConversation}
            onDelete={handleDeleteConversation}
            onRename={handleRenameConversation}
            workDir={currentSpace.path}
            onSelectSkill={setSelectedSkill}
            onInsertSkill={handleInsertSkill}
            onCreateSkill={handleCreateSkill}
            onSelectAgent={setSelectedAgent}
            onInsertAgent={handleInsertAgent}
            onCreateAgent={handleCreateAgent}
            onInsertCommand={handleInsertCommand}
            onCreateCommand={handleCreateCommand}
          />
        )}

        {/* Desktop Layout */}
        {!isMobile && (
          <>
            {/* Chat view - hidden when maximized or in tabs-only mode, adjusts width based on canvas state */}
            {!isCanvasMaximized && layoutMode === 'split' && (
              <div
                ref={chatContainerRef}
                className={`
                  flex flex-col min-w-0 relative
                  ${hasBrowserTab ? '' : 'transition-[border-color] duration-300 ease-out'}
                  ${isCanvasOpen ? 'border-r border-border/60' : 'flex-1 border-r border-transparent'}
                  ${isCanvasTransitioning ? 'pointer-events-none' : ''}
                `}
                style={{
                  width: isCanvasOpen ? dragChatWidth : undefined,
                  flex: isCanvasOpen ? 'none' : '1',
                  minWidth: isCanvasOpen ? chatWidthMin : undefined,
                  maxWidth: isCanvasOpen ? chatWidthMax : undefined,
                  // Disable transition when browser tab exists (sync with native BrowserView)
                  transition: (isDraggingChat || hasBrowserTab)
                    ? 'none'
                    : 'width 0.3s, flex 0.3s, border-color 0.3s',
                  willChange: isCanvasTransitioning ? 'width, flex' : 'auto',
                }}
              >
                <ChatView isCompact={isCanvasOpen} />

                {/* Drag handle for chat width - only when canvas is open */}
                {isCanvasOpen && (
                  <div
                    className={`
                      absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20
                      hover:bg-primary/50 transition-colors
                      ${isDraggingChat ? 'bg-primary/50' : ''}
                    `}
                    onMouseDown={handleChatDragStart}
                    title={t('Drag to resize')}
                  />
                )}
              </div>
            )}

            {/* Content Canvas - main viewing area, full width in tabs-only mode */}
            <div
              className={`
                min-w-0 overflow-hidden
                ${hasBrowserTab ? '' : 'transition-all duration-300 ease-out'}
                ${layoutMode === 'tabs-only' || isCanvasOpen || isCanvasMaximized
                  ? 'flex-1 opacity-100'
                  : 'w-0 flex-none opacity-0'}
                ${isCanvasTransitioning ? 'pointer-events-none' : ''}
              `}
              style={{
                willChange: isCanvasTransitioning ? 'width, opacity, transform' : 'auto',
                transform: layoutMode === 'tabs-only' || isCanvasOpen || isCanvasMaximized ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.98)',
                // Disable transition when browser tab exists (sync with native BrowserView)
                transition: hasBrowserTab ? 'none' : undefined,
              }}
            >
              {(layoutMode === 'tabs-only' || isCanvasOpen || isCanvasMaximized || isCanvasTransitioning) && <ContentCanvas />}
            </div>
          </>
        )}

        {/* Mobile Layout */}
        {isMobile && (
          <div className="flex-1 flex flex-col min-w-0">
            <ChatView isCompact={false} />
          </div>
        )}

        {/* Artifact rail - auto-collapses when maximized via useEffect above */}
        {/* Smart collapse: collapses when canvas is open, respects user preference */}
        {!isMobile && (
          <ArtifactRail
            spaceId={currentSpace.id}
            isTemp={currentSpace.isTemp}
            externalExpanded={effectiveRailExpanded}
            onExpandedChange={setRailExpanded}
          />
        )}
      </div>

      {/* Mobile Canvas Overlay */}
      {isMobile && isCanvasOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-slide-in-right-full">
          {/* Mobile Canvas Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80 backdrop-blur-sm">
            <button
              onClick={() => setCanvasOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span>{t('Return to conversation')}</span>
            </button>
            <button
              onClick={() => setCanvasOpen(false)}
              className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Canvas Content */}
          <div className="flex-1 overflow-hidden">
            <ContentCanvas />
          </div>
        </div>
      )}

      {/* Mobile Artifact Rail (shown as bottom sheet / overlay) */}
      {isMobile && (
        <ArtifactRail
          spaceId={currentSpace.id}
          isTemp={currentSpace.isTemp}
        />
      )}

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          workDir={currentSpace.path}
          onClose={() => setSelectedSkill(null)}
          onEdit={(skill) => {
            setSelectedSkill(null)
            handleEditSkill(skill)
          }}
        />
      )}

      {isSkillEditorOpen && currentSpace && (
        <SkillEditorModal
          skill={editingSkill || undefined}
          workDir={currentSpace.path}
          onClose={() => setIsSkillEditorOpen(false)}
          onSaved={(skill) => setSelectedSkill(skill)}
        />
      )}

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          workDir={currentSpace.path}
          onClose={() => setSelectedAgent(null)}
          onEdit={(agent) => {
            setSelectedAgent(null)
            handleEditAgent(agent)
          }}
        />
      )}

      {isAgentEditorOpen && currentSpace && (
        <AgentEditorModal
          agent={editingAgent || undefined}
          workDir={currentSpace.path}
          onClose={() => setIsAgentEditorOpen(false)}
          onSaved={(agent) => setSelectedAgent(agent)}
        />
      )}

      {isCommandEditorOpen && currentSpace && (
        <CommandEditorModal
          command={editingCommand || undefined}
          workDir={currentSpace.path}
          onClose={() => setIsCommandEditorOpen(false)}
        />
      )}
    </div>
  )
}
