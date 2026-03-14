/**
 * Input Area - Enhanced message input with bottom toolbar
 *
 * Layout (following industry standard - Qwen, ChatGPT, Baidu):
 * ┌──────────────────────────────────────────────────────┐
 * │ [Image previews]                                     │
 * │ ┌──────────────────────────────────────────────────┐ │
 * │ │ Textarea                                         │ │
 * │ └──────────────────────────────────────────────────┘ │
 * │ [+]──────────────────────────────────────── [Send] │
 * │      Bottom toolbar: always visible, expandable     │
 * └──────────────────────────────────────────────────────┘
 *
 * Features:
 * - Auto-resize textarea
 * - Keyboard shortcuts (Enter to send, Shift+Enter newline)
 * - Image paste/drop support with compression
 * - Bottom toolbar for future extensibility
 */

import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent, ClipboardEvent, DragEvent } from 'react'
import { Plus, ImagePlus, Loader2, AlertCircle, Atom, Globe, ClipboardList, X, Bot, Zap, Terminal, Trash2, Pencil, FileText } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useAIBrowserStore } from '../../stores/ai-browser.store'
import { api } from '../../api'
import { getComposerMruMap, touchComposerMru } from '../../stores/composer-mru.store'
import { useSpaceStore } from '../../stores/space.store'
import { useSkillsStore } from '../../stores/skills.store'
import { useAgentsStore } from '../../stores/agents.store'
import { useCommandsStore } from '../../stores/commands.store'
import { getOnboardingPrompt } from '../onboarding/onboardingData'
import { ImageAttachmentPreview } from './ImageAttachmentPreview'
import { FileContextPreview } from './FileContextPreview'
import { ModelSwitcher } from './ModelSwitcher'
import { ComposerTriggerPanel } from './ComposerTriggerPanel'
import { SkillsDropdown } from '../skills'
import { processImage, isValidImageType, formatFileSize } from '../../utils/imageProcessor'
import type { ChatMode, ConversationAiConfig, FileContextAttachment, ImageAttachment, KiteConfig } from '../../types'
import { useTranslation } from '../../i18n'
import { useComposerStore } from '../../stores/composer.store'
import { getTriggerContext, type TriggerContext } from '../../utils/composer-trigger'
import { isResourceEnabled } from '../../utils/resource-key'
import { getAiSetupState } from '../../../shared/types/ai-profile'
import {
  composeInputMessage,
  normalizeChipDisplayName,
  removeTriggerTokenText,
  type SelectedComposerResourceChip
} from '../../utils/composer-resource-chip'
import {
  buildGlobalExpandStateKey,
  buildVisibleSuggestions,
  rankSuggestions,
  shouldResetGlobalExpandState,
  splitSuggestionsByScope
} from '../../utils/composer-suggestion-ranking'
import { buildComposerResourceSuggestion } from '../../utils/composer-resource-suggestion'
import type {
  ComposerResourceSuggestionItem,
  ComposerSuggestionItem,
  ComposerSuggestionTab,
  ComposerSuggestionType
} from '../../utils/composer-suggestion-types'

interface InputAreaProps {
  onSend: (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], mode?: ChatMode) => void
  onStop: () => void
  isGenerating: boolean
  queueItems?: Array<{
    id: string
    content: string
    images?: ImageAttachment[]
    fileContexts?: FileContextAttachment[]
    hasImages?: boolean
    hasFileContexts?: boolean
  }>
  queueError?: string | null
  onSendQueueItem?: (id: string) => Promise<{
    accepted: boolean
    guided: boolean
    fallbackToNewRun: boolean
    delivery?: 'session_send' | 'ask_user_question_answer'
    error?: string
  }>
  onEditQueueItem?: (id: string) => void
  onRemoveQueueItem?: (id: string) => void
  onClearQueue?: () => void
  onClearQueueError?: () => void
  modeSwitching?: boolean
  spaceId: string | null
  placeholder?: string
  isCompact?: boolean
  workDir?: string  // For skills dropdown
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  conversation: { id: string; ai?: ConversationAiConfig } | null
  config: KiteConfig | null
  hasConversationStarted?: boolean
}

// Image constraints
const MAX_IMAGE_SIZE = 20 * 1024 * 1024  // 20MB max per image (before compression)
const MAX_IMAGES = 10  // Max images per message

// Error message type
interface ImageError {
  id: string
  message: string
}

function toSuggestionTypeFromTab(tab: ComposerSuggestionTab): ComposerSuggestionType {
  if (tab === 'commands') return 'command'
  if (tab === 'agents') return 'agent'
  return 'skill'
}

const STARTER_ACTIONS = [
  {
    id: 'starter-build-web',
    labelKey: 'Build a web page',
    promptKey: 'Create a clean one-page company website with hero, features, and contact section.'
  },
  {
    id: 'starter-analyze-table',
    labelKey: 'Analyze a table',
    promptKey: 'Analyze the uploaded CSV and summarize key trends with a short chart report.'
  },
  {
    id: 'starter-polish-copy',
    labelKey: 'Polish copy',
    promptKey: 'Rewrite this draft into concise, clear copy with a professional but friendly tone.'
  },
  {
    id: 'starter-build-prototype',
    labelKey: 'Build a prototype',
    promptKey: 'Create a clickable product prototype page with key user flow and realistic dummy content.'
  },
  {
    id: 'starter-process-files',
    labelKey: 'Process files',
    promptKey: 'Batch process files in this folder: rename consistently and generate a summary index.'
  },
  {
    id: 'starter-automate-task',
    labelKey: 'Automate a task',
    promptKey: 'Design an automation workflow for this repeated task and output executable steps.'
  }
] as const

export function shouldShowStarterActions({
  isGenerating,
  isOnboardingSendStep,
  hasConversationStarted,
  content,
  selectedResourceChipCount,
  imageCount,
  fileContextCount
}: {
  isGenerating: boolean
  isOnboardingSendStep: boolean
  hasConversationStarted: boolean
  content: string
  selectedResourceChipCount: number
  imageCount: number
  fileContextCount: number
}): boolean {
  if (isGenerating || isOnboardingSendStep) return false
  if (hasConversationStarted) return false
  if (content.trim().length > 0) return false
  if (selectedResourceChipCount > 0) return false
  if (imageCount > 0) return false
  if (fileContextCount > 0) return false
  return true
}

export function InputArea({
  onSend,
  onStop,
  isGenerating,
  queueItems = [],
  queueError = null,
  onSendQueueItem,
  onEditQueueItem,
  onRemoveQueueItem,
  onClearQueue,
  onClearQueueError,
  modeSwitching = false,
  spaceId,
  placeholder,
  isCompact = false,
  workDir,
  mode,
  onModeChange,
  conversation,
  config,
  hasConversationStarted = false,
}: InputAreaProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [fileContexts, setFileContexts] = useState<FileContextAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragOverlayKind, setDragOverlayKind] = useState<'images' | 'file-context'>('images')
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [imageError, setImageError] = useState<ImageError | null>(null)
  const [triggerContext, setTriggerContext] = useState<TriggerContext | null>(null)
  const [activeSuggestionTab, setActiveSuggestionTab] = useState<ComposerSuggestionTab>('skills')
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [globalExpandState, setGlobalExpandState] = useState<Record<string, boolean>>({})
  const [mruVersion, setMruVersion] = useState(0)
  const [selectedResourceChips, setSelectedResourceChips] = useState<SelectedComposerResourceChip[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [queueHint, setQueueHint] = useState<string | null>(null)
  const [guidingQueueItemIds, setGuidingQueueItemIds] = useState<Set<string>>(new Set())
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const lastTriggerTypeRef = useRef<TriggerContext['type'] | null>(null)
  const lastExpandContextRef = useRef<{ stateKey: string | null; query: string } | null>(null)
  const insertQueue = useComposerStore(state => state.insertQueue)
  const dequeueInsert = useComposerStore(state => state.dequeueInsert)

  // AI Browser state
  const { enabled: aiBrowserEnabled, setEnabled: setAIBrowserEnabled } = useAIBrowserStore(
    useShallow((state) => ({
      enabled: state.enabled,
      setEnabled: state.setEnabled
    }))
  )
  const { currentSpace, spaces, haloSpace, getSpacePreferences } = useSpaceStore(
    useShallow((state) => ({
      currentSpace: state.currentSpace,
      spaces: state.spaces,
      haloSpace: state.haloSpace,
      getSpacePreferences: state.getSpacePreferences
    }))
  )
  const {
    skills,
    loadedWorkDir: loadedSkillsWorkDir,
    loadSkills
  } = useSkillsStore(
    useShallow((state) => ({
      skills: state.skills,
      loadedWorkDir: state.loadedWorkDir,
      loadSkills: state.loadSkills
    }))
  )
  const {
    commands,
    loadedWorkDir: loadedCommandsWorkDir,
    loadCommands
  } = useCommandsStore(
    useShallow((state) => ({
      commands: state.commands,
      loadedWorkDir: state.loadedWorkDir,
      loadCommands: state.loadCommands
    }))
  )
  const {
    agents,
    loadedWorkDir: loadedAgentsWorkDir,
    loadAgents
  } = useAgentsStore(
    useShallow((state) => ({
      agents: state.agents,
      loadedWorkDir: state.loadedWorkDir,
      loadAgents: state.loadAgents
    }))
  )
  const skillsLoadInFlightWorkDirRef = useRef<string | null>(null)
  const commandsLoadInFlightWorkDirRef = useRef<string | null>(null)
  const agentsLoadInFlightWorkDirRef = useRef<string | null>(null)
  const lastRequestedSkillsWorkDirRef = useRef<string | null>(null)
  const lastRequestedCommandsWorkDirRef = useRef<string | null>(null)
  const lastRequestedAgentsWorkDirRef = useRef<string | null>(null)
  const resolvedSpace = useMemo(() => {
    if (!spaceId) return null
    if (currentSpace?.id === spaceId) return currentSpace
    if (haloSpace?.id === spaceId) return haloSpace
    return spaces.find(space => space.id === spaceId) || null
  }, [spaceId, currentSpace, haloSpace, spaces])
  const resolvedWorkDir = useMemo(() => {
    if (workDir && workDir.trim()) return workDir
    return resolvedSpace?.path || currentSpace?.path
  }, [currentSpace?.path, resolvedSpace?.path, workDir])

  const spacePreferences = useMemo(() => {
    if (!spaceId) return undefined
    if (resolvedSpace?.preferences) return resolvedSpace.preferences
    return getSpacePreferences(spaceId)
  }, [getSpacePreferences, resolvedSpace?.preferences, spaceId])

  const enabledSkills = spacePreferences?.skills?.enabled || []
  const enabledAgents = spacePreferences?.agents?.enabled || []

  const triggerQuery = triggerContext?.query.trim().toLowerCase() || ''

  useEffect(() => {
    const targetWorkDir = resolvedWorkDir ?? null
    const shouldLoad = loadedSkillsWorkDir !== targetWorkDir || skills.length === 0
    if (!shouldLoad) return
    if (skillsLoadInFlightWorkDirRef.current === targetWorkDir) return
    if (lastRequestedSkillsWorkDirRef.current === targetWorkDir) return

    lastRequestedSkillsWorkDirRef.current = targetWorkDir
    skillsLoadInFlightWorkDirRef.current = targetWorkDir
    void loadSkills(resolvedWorkDir).finally(() => {
      const loadedWorkDir = useSkillsStore.getState().loadedWorkDir
      if (skillsLoadInFlightWorkDirRef.current === targetWorkDir) {
        skillsLoadInFlightWorkDirRef.current = null
      }
      if (loadedWorkDir !== targetWorkDir && lastRequestedSkillsWorkDirRef.current === targetWorkDir) {
        lastRequestedSkillsWorkDirRef.current = null
      }
    })
  }, [loadedSkillsWorkDir, loadSkills, resolvedWorkDir, skills.length])

  useEffect(() => {
    const targetWorkDir = resolvedWorkDir ?? null
    const shouldLoad = loadedCommandsWorkDir !== targetWorkDir || commands.length === 0
    if (!shouldLoad) return
    if (commandsLoadInFlightWorkDirRef.current === targetWorkDir) return
    if (lastRequestedCommandsWorkDirRef.current === targetWorkDir) return

    lastRequestedCommandsWorkDirRef.current = targetWorkDir
    commandsLoadInFlightWorkDirRef.current = targetWorkDir
    void loadCommands(resolvedWorkDir).finally(() => {
      const loadedWorkDir = useCommandsStore.getState().loadedWorkDir
      if (commandsLoadInFlightWorkDirRef.current === targetWorkDir) {
        commandsLoadInFlightWorkDirRef.current = null
      }
      if (loadedWorkDir !== targetWorkDir && lastRequestedCommandsWorkDirRef.current === targetWorkDir) {
        lastRequestedCommandsWorkDirRef.current = null
      }
    })
  }, [commands.length, loadCommands, loadedCommandsWorkDir, resolvedWorkDir])

  useEffect(() => {
    const targetWorkDir = resolvedWorkDir ?? null
    const shouldLoad = loadedAgentsWorkDir !== targetWorkDir || agents.length === 0
    if (!shouldLoad) return
    if (agentsLoadInFlightWorkDirRef.current === targetWorkDir) return
    if (lastRequestedAgentsWorkDirRef.current === targetWorkDir) return

    lastRequestedAgentsWorkDirRef.current = targetWorkDir
    agentsLoadInFlightWorkDirRef.current = targetWorkDir
    void loadAgents(resolvedWorkDir).finally(() => {
      const loadedWorkDir = useAgentsStore.getState().loadedWorkDir
      if (agentsLoadInFlightWorkDirRef.current === targetWorkDir) {
        agentsLoadInFlightWorkDirRef.current = null
      }
      if (loadedWorkDir !== targetWorkDir && lastRequestedAgentsWorkDirRef.current === targetWorkDir) {
        lastRequestedAgentsWorkDirRef.current = null
      }
    })
  }, [agents.length, loadAgents, loadedAgentsWorkDir, resolvedWorkDir])

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (imageError) {
      const timer = setTimeout(() => setImageError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [imageError])

  // Show error to user
  const showError = (message: string) => {
    setImageError({ id: `err-${Date.now()}`, message })
  }

  // Onboarding state
  const { isActive: isOnboarding, currentStep } = useOnboardingStore(
    useShallow((state) => ({
      isActive: state.isActive,
      currentStep: state.currentStep
    }))
  )
  const isOnboardingSendStep = isOnboarding && currentStep === 'send-message'

  // In onboarding send step, show prefilled prompt
  const onboardingPrompt = getOnboardingPrompt(t)
  const displayContent = isOnboardingSendStep ? onboardingPrompt : content
  const isTriggerPanelOpen = Boolean(triggerContext) && !isOnboardingSendStep

  const mruSpaceId = spaceId || 'no-space'
  const conversationProfileId = conversation?.ai?.profileId
  const aiSetupState = useMemo(
    () => getAiSetupState(config, conversationProfileId),
    [config, conversationProfileId]
  )
  const isAiConfigured = aiSetupState.configured
  const effectiveMode = mode
  const effectiveSuggestionTab: ComposerSuggestionTab = triggerContext?.type === 'mention'
    ? 'agents'
    : activeSuggestionTab
  const expandStateKey = triggerContext
    ? buildGlobalExpandStateKey({
      spaceId: mruSpaceId,
      triggerMode: triggerContext.type,
      tab: effectiveSuggestionTab
    })
    : null
  const isGlobalExpanded = expandStateKey ? globalExpandState[expandStateKey] === true : false

  const skillCandidates = useMemo<ComposerResourceSuggestionItem[]>(() => {
    const suggestions: ComposerResourceSuggestionItem[] = []
    for (const skill of skills) {
      const suggestion = buildComposerResourceSuggestion('skill', skill)
      if (suggestion.scope === 'space' && enabledSkills.length > 0 && !isResourceEnabled(enabledSkills, skill)) {
        continue
      }
      suggestions.push(suggestion)
    }
    return suggestions
  }, [enabledSkills, skills])

  const commandCandidates = useMemo<ComposerResourceSuggestionItem[]>(() => {
    const suggestions: ComposerResourceSuggestionItem[] = []
    for (const command of commands) {
      suggestions.push(buildComposerResourceSuggestion('command', command))
    }
    return suggestions
  }, [commands])

  const agentCandidates = useMemo<ComposerResourceSuggestionItem[]>(() => {
    const suggestions: ComposerResourceSuggestionItem[] = []
    for (const agent of agents) {
      const suggestion = buildComposerResourceSuggestion('agent', agent)
      if (suggestion.scope === 'space' && enabledAgents.length > 0 && !isResourceEnabled(enabledAgents, agent)) {
        continue
      }
      suggestions.push(suggestion)
    }
    return suggestions
  }, [agents, enabledAgents])

  const rankedSkillSuggestions = useMemo(
    () => rankSuggestions(skillCandidates, {
      query: triggerQuery,
      mruMap: getComposerMruMap(mruSpaceId, 'skill')
    }),
    [mruSpaceId, mruVersion, skillCandidates, triggerQuery]
  )
  const rankedCommandSuggestions = useMemo(
    () => rankSuggestions(commandCandidates, {
      query: triggerQuery,
      mruMap: getComposerMruMap(mruSpaceId, 'command')
    }),
    [commandCandidates, mruSpaceId, mruVersion, triggerQuery]
  )
  const rankedAgentSuggestions = useMemo(
    () => rankSuggestions(agentCandidates, {
      query: triggerQuery,
      mruMap: getComposerMruMap(mruSpaceId, 'agent')
    }),
    [agentCandidates, mruSpaceId, mruVersion, triggerQuery]
  )

  const skillSuggestionGroups = useMemo(
    () => splitSuggestionsByScope(rankedSkillSuggestions),
    [rankedSkillSuggestions]
  )
  const commandSuggestionGroups = useMemo(
    () => splitSuggestionsByScope(rankedCommandSuggestions),
    [rankedCommandSuggestions]
  )
  const agentSuggestionGroups = useMemo(
    () => splitSuggestionsByScope(rankedAgentSuggestions),
    [rankedAgentSuggestions]
  )

  const suggestionCounts = useMemo<Record<ComposerSuggestionTab, number>>(() => ({
    skills: skillSuggestionGroups.space.length,
    commands: commandSuggestionGroups.space.length,
    agents: agentSuggestionGroups.space.length
  }), [agentSuggestionGroups.space.length, commandSuggestionGroups.space.length, skillSuggestionGroups.space.length])

  const activeSuggestionGroups = useMemo(() => {
    if (effectiveSuggestionTab === 'commands') return commandSuggestionGroups
    if (effectiveSuggestionTab === 'agents') return agentSuggestionGroups
    return skillSuggestionGroups
  }, [agentSuggestionGroups, commandSuggestionGroups, effectiveSuggestionTab, skillSuggestionGroups])

  const activeSuggestionType = toSuggestionTypeFromTab(effectiveSuggestionTab)
  const activeGlobalCount = activeSuggestionGroups.global.length

  const activeSuggestions = useMemo(() => {
    if (!triggerContext) return [] as ComposerSuggestionItem[]
    return buildVisibleSuggestions({
      spaceSuggestions: activeSuggestionGroups.space,
      globalSuggestions: activeSuggestionGroups.global,
      expanded: isGlobalExpanded,
      type: activeSuggestionType,
      expandLabel: t('Show global resources ({{count}})', { count: activeGlobalCount }),
      collapseLabel: t('Hide global resources'),
      expandDescription: t('Includes app, plugin, and shared resources')
    })
  }, [
    activeGlobalCount,
    activeSuggestionGroups.global,
    activeSuggestionGroups.space,
    activeSuggestionType,
    isGlobalExpanded,
    t,
    triggerContext
  ])

  // Process file to ImageAttachment with professional compression
  const processFileWithCompression = async (file: File): Promise<ImageAttachment | null> => {
    // Validate type
    if (!isValidImageType(file)) {
      showError(t('Unsupported image format: {{type}}', { type: file.type || t('Unknown') }))
      return null
    }

    // Validate size (before compression)
    if (file.size > MAX_IMAGE_SIZE) {
      showError(t('Image too large ({{size}}), max 20MB', { size: formatFileSize(file.size) }))
      return null
    }

    try {
      // Use professional image processor for compression
      const processed = await processImage(file)

      return {
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        mediaType: processed.mediaType,
        data: processed.data,
        name: file.name,
        size: processed.compressedSize
      }
    } catch (error) {
      console.error(`Failed to process image: ${file.name}`, error)
      showError(t('Failed to process image: {{name}}', { name: file.name }))
      return null
    }
  }

  // Add images (with limit check and loading state)
  const addImages = async (files: File[]) => {
    const remainingSlots = MAX_IMAGES - images.length
    if (remainingSlots <= 0) return

    const filesToProcess = files.slice(0, remainingSlots)

    // Show loading state during compression
    setIsProcessingImages(true)

    try {
      const newImages = await Promise.all(filesToProcess.map(processFileWithCompression))
      const validImages = newImages.filter((img): img is ImageAttachment => img !== null)

      if (validImages.length > 0) {
        setImages(prev => [...prev, ...validImages])
      }
    } finally {
      setIsProcessingImages(false)
    }
  }

  // Remove image
  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  // Remove file context
  const removeFileContext = (id: string) => {
    setFileContexts(prev => prev.filter(f => f.id !== id))
  }

  // Handle paste event
  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()  // Prevent default only if we're handling images
      await addImages(imageFiles)
    }
  }

  // Handle drag events
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    const hasKiteFileType = Array.from(e.dataTransfer.types || []).includes('application/x-kite-file')
    setDragOverlayKind(hasKiteFileType ? 'file-context' : 'images')
    if (!isDragOver) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setDragOverlayKind('images')
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setDragOverlayKind('images')

    // Check for file context from file tree drag
    const kiteFileData = e.dataTransfer.getData('application/x-kite-file')

    if (kiteFileData) {
      try {
        const fileData = JSON.parse(kiteFileData) as { path: string; name: string; extension: string }
        // Check if file already exists in fileContexts
        const exists = fileContexts.some(f => f.path === fileData.path)
        if (!exists) {
          const newFileContext: FileContextAttachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'file-context',
            path: fileData.path,
            name: fileData.name,
            extension: fileData.extension
          }
          setFileContexts(prev => [...prev, newFileContext])
        }
        return
      } catch (err) {
        console.error('Failed to parse kite file data:', err)
      }
    }

    // Handle image files
    const files = Array.from(e.dataTransfer.files).filter(file => isValidImageType(file))

    if (files.length > 0) {
      await addImages(files)
    }
  }

  // Handle system file button click
  const handleSystemFileButtonClick = async () => {
    const response = await api.selectFiles()
    if (!response.success) {
      showError(t('Unable to attach system file in current mode'))
      return
    }

    const filePaths = Array.isArray(response.data) ? response.data : []
    if (filePaths.length === 0) return

    const newFileContexts: FileContextAttachment[] = []
    for (const filePath of filePaths) {
      const exists = fileContexts.some(f => f.path === filePath) || newFileContexts.some(f => f.path === filePath)
      if (exists) continue

      const normalizedPath = filePath.replace(/\\/g, '/')
      const fileName = normalizedPath.split('/').pop() || filePath
      const dotIndex = fileName.lastIndexOf('.')
      const extension = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''

      newFileContexts.push({
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'file-context',
        path: filePath,
        name: fileName,
        extension
      })
    }

    if (newFileContexts.length > 0) {
      setFileContexts(prev => [...prev, ...newFileContexts])
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [displayContent])

  // Focus on mount
  useEffect(() => {
    if (!isGenerating && !isOnboardingSendStep) {
      textareaRef.current?.focus()
    }
  }, [isGenerating, isOnboardingSendStep])

  const closeTriggerPanel = useCallback(() => {
    setGlobalExpandState(prev => (Object.keys(prev).length === 0 ? prev : {}))
    setTriggerContext(null)
    setActiveSuggestionIndex(0)
  }, [])

  const refreshTriggerContext = useCallback((nextValue?: string, nextCaret?: number) => {
    if (isOnboardingSendStep) {
      closeTriggerPanel()
      return
    }

    const textarea = textareaRef.current
    const value = nextValue ?? content
    const caret = nextCaret ?? textarea?.selectionStart ?? value.length
    const context = getTriggerContext(value, caret)
    setTriggerContext(context)
  }, [closeTriggerPanel, content, isOnboardingSendStep])

  useEffect(() => {
    if (isOnboardingSendStep) {
      closeTriggerPanel()
    }
  }, [closeTriggerPanel, isOnboardingSendStep])

  useEffect(() => {
    if (!isTriggerPanelOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (inputContainerRef.current && !inputContainerRef.current.contains(event.target as Node)) {
        closeTriggerPanel()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeTriggerPanel, isTriggerPanelOpen])

  useEffect(() => {
    if (!triggerContext) {
      setActiveSuggestionIndex(0)
      lastTriggerTypeRef.current = null
      lastExpandContextRef.current = null
      return
    }
    if (lastTriggerTypeRef.current !== triggerContext.type) {
      setActiveSuggestionTab(triggerContext.type === 'mention' ? 'agents' : 'skills')
    }
    lastTriggerTypeRef.current = triggerContext.type
  }, [triggerContext])

  useEffect(() => {
    setActiveSuggestionIndex(0)
  }, [activeSuggestionTab, triggerContext?.query, triggerContext?.start, triggerContext?.type])

  useEffect(() => {
    if (activeSuggestions.length === 0) {
      setActiveSuggestionIndex(0)
      return
    }
    setActiveSuggestionIndex(prev => Math.min(prev, activeSuggestions.length - 1))
  }, [activeSuggestions.length])

  useEffect(() => {
    if (!triggerContext || !expandStateKey) {
      lastExpandContextRef.current = null
      return
    }

    const previous = lastExpandContextRef.current
    const shouldReset = shouldResetGlobalExpandState({
      prevStateKey: previous?.stateKey || null,
      nextStateKey: expandStateKey,
      prevQuery: previous?.query || '',
      nextQuery: triggerQuery,
      isComposing
    })

    if (shouldReset) {
      setGlobalExpandState(prev => {
        if (prev[expandStateKey] !== true) return prev
        return {
          ...prev,
          [expandStateKey]: false
        }
      })
    }

    lastExpandContextRef.current = {
      stateKey: expandStateKey,
      query: triggerQuery
    }
  }, [expandStateKey, isComposing, triggerContext, triggerQuery])

  useEffect(() => {
    if (!triggerContext || !expandStateKey || isComposing) return
    if (!isGlobalExpanded) return
    if (activeGlobalCount > 0) return

    setGlobalExpandState(prev => {
      if (prev[expandStateKey] !== true) return prev
      return {
        ...prev,
        [expandStateKey]: false
      }
    })
  }, [activeGlobalCount, expandStateKey, isComposing, isGlobalExpanded, triggerContext])

  const applySuggestion = useCallback((item: ComposerSuggestionItem) => {
    if (item.kind === 'action') {
      if (!expandStateKey) return
      const nextExpanded = item.actionId === 'expand-global'
      setGlobalExpandState(prev => {
        if (prev[expandStateKey] === nextExpanded) return prev
        return {
          ...prev,
          [expandStateKey]: nextExpanded
        }
      })
      setActiveSuggestionIndex(0)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
      return
    }

    if (!triggerContext) return
    const replaced = removeTriggerTokenText(content, triggerContext)
    touchComposerMru(mruSpaceId, item.type, item.stableId)
    setMruVersion(version => version + 1)
    setSelectedResourceChips(prev => {
      if (prev.some((chip) => chip.id === item.stableId)) return prev
      return [
        ...prev,
        {
          id: item.stableId,
          type: item.type,
          displayName: normalizeChipDisplayName(item.displayName),
          token: item.insertText
        }
      ]
    })
    setContent(replaced.value)
    closeTriggerPanel()
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(replaced.caret, replaced.caret)
    })
  }, [closeTriggerPanel, content, expandStateKey, mruSpaceId, triggerContext])

  const syncTriggerWithCursor = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    refreshTriggerContext(textarea.value, textarea.selectionStart ?? textarea.value.length)
  }, [refreshTriggerContext])

  const handleContentChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isOnboardingSendStep) return
    const value = event.target.value
    const caret = event.target.selectionStart ?? value.length
    setContent(value)
    refreshTriggerContext(value, caret)
  }

  // Handle send
  const handleSend = () => {
    console.log('[InputArea] handleSend requested', {
      mode: effectiveMode,
      isOnboardingSendStep,
      isAiConfigured,
      aiSetupReason: aiSetupState.reason,
      contentLength: content.trim().length,
      chips: selectedResourceChips.length,
      images: images.length,
      fileContexts: fileContexts.length,
      isProcessingImages
    })

    if (!isAiConfigured && !isOnboardingSendStep) {
      const reason = aiSetupState.reason
      if (reason === 'missing_api_key') {
        showError(t('Please configure API Key in Settings'))
      } else if (reason === 'disabled_profile') {
        showError(t('Please enable the AI provider in Settings'))
      } else if (reason === 'invalid_url') {
        showError(t('URL must end with /chat/completions or /responses'))
      } else {
        showError(t('Please configure AI profile first'))
      }
      console.warn('[InputArea] blocked send by ai setup guard', {
        conversationId: conversation?.id || null,
        profileId: conversationProfileId || null,
        reason
      })
      return
    }

    const textToSend = isOnboardingSendStep
      ? onboardingPrompt
      : composeInputMessage(content, selectedResourceChips)
    const hasContent = textToSend || images.length > 0 || fileContexts.length > 0

    if (hasContent) {
      closeTriggerPanel()
      onSend(
        textToSend,
        images.length > 0 ? images : undefined,
        thinkingEnabled,
        fileContexts.length > 0 ? fileContexts : undefined,
        effectiveMode
      )

      if (!isOnboardingSendStep) {
        setContent('')
        setSelectedResourceChips([])
        setImages([])  // Clear images after send
        setFileContexts([])  // Clear file contexts after send
        // Reset height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
      }
    }
  }

  // Detect mobile device (touch + narrow screen)
  const isMobile = () => {
    return 'ontouchstart' in window && window.innerWidth < 768
  }

  // Handle key press
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const shouldSkipHotkeys = isComposing || e.nativeEvent.isComposing
    if ((e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') && shouldSkipHotkeys) {
      return
    }

    if (isTriggerPanelOpen) {
      if (e.key === 'ArrowDown' && activeSuggestions.length > 0) {
        e.preventDefault()
        setActiveSuggestionIndex(prev => (prev + 1) % activeSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp' && activeSuggestions.length > 0) {
        e.preventDefault()
        setActiveSuggestionIndex(prev => (prev - 1 + activeSuggestions.length) % activeSuggestions.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeTriggerPanel()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !isMobile()) {
        const selected = activeSuggestions[activeSuggestionIndex] ?? activeSuggestions[0]
        if (selected) {
          e.preventDefault()
          applySuggestion(selected)
          return
        }
      }
    }

    if (e.key === 'Backspace' && content.length === 0 && selectedResourceChips.length > 0) {
      e.preventDefault()
      setSelectedResourceChips(prev => prev.slice(0, -1))
      return
    }

    // Mobile: Enter for newline, send via button only
    // PC: Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey && !isMobile()) {
      e.preventDefault()
      handleSend()
    }
    // Esc to stop
    if (e.key === 'Escape' && isGenerating) {
      e.preventDefault()
      onStop()
    }
  }

  const insertText = useCallback((text: string) => {
    setContent(prev => {
      if (!prev || prev.endsWith(' ') || prev.endsWith('\n')) {
        return prev + text
      }
      return prev + ' ' + text
    })
    textareaRef.current?.focus()
  }, [])

  const onInsertSkill = useCallback((skillName: string) => {
    insertText(`/${skillName}`)
  }, [insertText])

  const onThinkingToggle = useCallback(() => {
    setThinkingEnabled(prev => !prev)
  }, [])

  // Consume pending insert requests from sidebar panels
  useEffect(() => {
    if (insertQueue.length === 0) return
    const next = insertQueue[0]
    insertText(next.text)
    dequeueInsert(next.id)
  }, [insertQueue, dequeueInsert, insertText])

  const removeResourceChip = useCallback((chipId: string) => {
    setSelectedResourceChips(prev => prev.filter((chip) => chip.id !== chipId))
    textareaRef.current?.focus()
  }, [])

  // In onboarding mode, can always send (prefilled content)
  // Can send if has text OR has images OR has file contexts (and not processing)
  const canSend = isOnboardingSendStep || (
    isAiConfigured &&
    (content.trim().length > 0 || selectedResourceChips.length > 0 || images.length > 0 || fileContexts.length > 0) &&
    !isProcessingImages
  )

  // Debug: log canSend state
  useEffect(() => {
    console.log('[InputArea] canSend debug:', {
      canSend,
      isOnboardingSendStep,
      isAiConfigured,
      aiSetupState,
      contentLength: content.trim().length,
      selectedResourceChipsLength: selectedResourceChips.length,
      imagesLength: images.length,
      fileContextsLength: fileContexts.length,
      isProcessingImages
    })
  }, [canSend, isOnboardingSendStep, isAiConfigured, aiSetupState, content, selectedResourceChips.length, images.length, fileContexts.length, isProcessingImages])
  const hasImages = images.length > 0
  const hasFileContexts = fileContexts.length > 0
  const showStarterActions = shouldShowStarterActions({
    isGenerating,
    isOnboardingSendStep,
    hasConversationStarted,
    content,
    selectedResourceChipCount: selectedResourceChips.length,
    imageCount: images.length,
    fileContextCount: fileContexts.length
  })
  const handleStarterAction = useCallback((prompt: string) => {
    setContent(prompt)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      syncTriggerWithCursor()
    })
  }, [syncTriggerWithCursor])

  const resolveQueueContent = useCallback((item: {
    content: string
    images?: ImageAttachment[]
    fileContexts?: FileContextAttachment[]
    hasImages?: boolean
    hasFileContexts?: boolean
  }): string => {
    const trimmed = item.content.trim()
    if (trimmed.length > 0) return trimmed
    const hasItemImages = Boolean(item.hasImages || (item.images && item.images.length > 0))
    const hasItemContexts = Boolean(item.hasFileContexts || (item.fileContexts && item.fileContexts.length > 0))
    if (hasItemImages && hasItemContexts) return t('Image + Context')
    if (hasItemImages) return t('Image message')
    if (hasItemContexts) return t('Context message')
    return t('Queued message')
  }, [t])

  useEffect(() => {
    if (!queueHint) return
    const timer = window.setTimeout(() => {
      setQueueHint(null)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [queueHint])

  return (
    <div className={`
      space-studio-input-wrap border-t
      transition-[padding] duration-300 ease-out
      ${isCompact ? 'px-3 py-2' : 'px-4 py-3'}
    `}>
      <div className={isCompact ? '' : 'max-w-3xl mx-auto'}>
        {/* Error toast notification */}
        {imageError && (
          <div className="mb-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20
            flex items-start gap-2 animate-fade-in">
            <AlertCircle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
            <span className="text-sm text-destructive flex-1">{imageError.message}</span>
          </div>
        )}

        {/* Input container */}
        <div
          ref={inputContainerRef}
          className={`
            space-studio-input-shell relative flex flex-col transition-all duration-200
            ${isFocused
              ? 'focused'
              : 'hover:bg-card'
            }
            ${isDragOver ? 'ring-2 ring-foreground/25 bg-card' : ''}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {showStarterActions && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs text-muted-foreground mb-2">{t('Start fast with one click')}</p>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleStarterAction(t(action.promptKey))}
                    className="rounded-full border border-border/75 bg-card px-2.5 py-1 text-xs text-foreground/80 hover:bg-secondary/65 transition-colors"
                  >
                    {t(action.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Image preview area */}
          {hasImages && (
            <ImageAttachmentPreview
              images={images}
              onRemove={removeImage}
            />
          )}

          {/* File context preview area */}
          {hasFileContexts && (
            <FileContextPreview
              files={fileContexts}
              onRemove={removeFileContext}
            />
          )}

          {/* Image processing indicator */}
          {isProcessingImages && (
            <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground border-b border-border/30">
              <Loader2 size={14} className="animate-spin" />
              <span>{t('Processing image...')}</span>
            </div>
          )}

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center
              bg-card/95 rounded-2xl border-2 border-dashed border-border
              pointer-events-none z-10">
              <div className="flex flex-col items-center gap-2 text-foreground/70">
                {dragOverlayKind === 'file-context' ? (
                  <FileText size={24} />
                ) : (
                  <ImagePlus size={24} />
                )}
                <span className="text-sm font-medium">
                  {dragOverlayKind === 'file-context'
                    ? t('Drop to add file context')
                    : t('Drop to add images')}
                </span>
              </div>
            </div>
          )}

          {/* Textarea area */}
          {queueItems.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <div className="rounded-2xl border border-border/60 bg-background/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('Queued {{count}}', { count: queueItems.length })}</span>
                  {onClearQueue && (
                    <button
                      type="button"
                      onClick={onClearQueue}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('Clear all')}
                    </button>
                  )}
                </div>
                <div className="mt-2 space-y-1.5 max-h-28 overflow-auto pr-1">
                  {queueItems.map((item) => {
                    const isGuiding = guidingQueueItemIds.has(item.id)
                    return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                        {resolveQueueContent(item)}
                      </span>
                      {onSendQueueItem && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (isGuiding) return
                            setGuidingQueueItemIds((prev) => {
                              const next = new Set(prev)
                              next.add(item.id)
                              return next
                            })
                            try {
                              const guideResult = await onSendQueueItem(item.id)
                              if (!guideResult.accepted) {
                                setQueueHint(guideResult.error || t('Failed to guide message'))
                                return
                              }
                              if (guideResult.guided) {
                                setQueueHint(t('Guided update embedded into current run.'))
                                return
                              }
                              if (guideResult.fallbackToNewRun) {
                                setQueueHint(t('Guide could not attach to current run. Sent as a new run.'))
                                return
                              }
                              setQueueHint(t('Queued message guided. It will send without interrupting current work.'))
                            } finally {
                              setGuidingQueueItemIds((prev) => {
                                if (!prev.has(item.id)) return prev
                                const next = new Set(prev)
                                next.delete(item.id)
                                return next
                              })
                            }
                          }}
                          disabled={isGuiding}
                          className={`h-6 inline-flex items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
                            isGuiding
                              ? 'bg-muted/60 text-foreground/70 cursor-not-allowed'
                              : 'bg-muted/60 text-foreground hover:bg-muted/80'
                          }`}
                          title={t('Send immediately without interrupting work')}
                        >
                          {isGuiding && <Loader2 size={11} className="animate-spin" />}
                          <span>{t('Guide')}</span>
                        </button>
                      )}
                      {(onEditQueueItem || onRemoveQueueItem) && (
                        <button
                          type="button"
                          onClick={() => {
                            setContent(item.content)
                            setImages(item.images ? [...item.images] : [])
                            setFileContexts(item.fileContexts ? [...item.fileContexts] : [])
                            if (onEditQueueItem) {
                              onEditQueueItem(item.id)
                            } else {
                              onRemoveQueueItem?.(item.id)
                            }
                            setQueueHint(t('Moved queued message to input for editing'))
                            textareaRef.current?.focus()
                          }}
                          className="h-6 inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 text-[11px] text-foreground/80 hover:bg-muted transition-colors"
                          title={t('Edit')}
                        >
                          <Pencil size={11} />
                          <span>{t('Edit')}</span>
                        </button>
                      )}
                      {onRemoveQueueItem && (
                        <button
                          type="button"
                          onClick={() => onRemoveQueueItem(item.id)}
                          className="w-6 h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={t('Remove')}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          {queueHint && (
            <div className="px-3 pb-1">
              <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground">
                {queueHint}
              </div>
            </div>
          )}
          <div className="px-3 pt-3 pb-1">
            {selectedResourceChips.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {selectedResourceChips.map((chip) => {
                  const Icon = chip.type === 'agent' ? Bot : chip.type === 'command' ? Terminal : Zap
                  return (
                    <span
                      key={chip.id}
                      className="space-studio-chip inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-foreground"
                    >
                      <Icon size={14} />
                      <span className="font-medium">{chip.displayName}</span>
                      <button
                        type="button"
                        onClick={() => removeResourceChip(chip.id)}
                        className="rounded p-0.5 hover:bg-muted/70"
                        aria-label={t('Delete')}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={displayContent}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onKeyUp={syncTriggerWithCursor}
              onSelect={syncTriggerWithCursor}
              onClick={syncTriggerWithCursor}
              onPaste={handlePaste}
              onFocus={() => {
                setIsFocused(true)
                syncTriggerWithCursor()
              }}
              onBlur={() => setIsFocused(false)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => {
                setIsComposing(false)
                requestAnimationFrame(syncTriggerWithCursor)
              }}
              placeholder={placeholder || t('Describe what you want to get done, Kite will start immediately')}
              readOnly={isOnboardingSendStep}
              rows={1}
              className={`w-full bg-transparent resize-none
                focus:outline-none text-foreground placeholder:text-muted-foreground/50
                min-h-[24px]
                ${isOnboardingSendStep ? 'cursor-default' : ''}`}
              style={{ maxHeight: '200px' }}
            />
          </div>

          {isTriggerPanelOpen && triggerContext && (
            <ComposerTriggerPanel
              triggerType={triggerContext.type}
              activeTab={activeSuggestionTab}
              onTabChange={setActiveSuggestionTab}
              tabCounts={suggestionCounts}
              items={activeSuggestions}
              activeIndex={activeSuggestionIndex}
              onHoverIndex={setActiveSuggestionIndex}
              onSelect={applySuggestion}
            />
          )}

          {/* Bottom toolbar - always visible, industry standard layout */}
          <InputToolbar
            conversation={conversation}
            config={config}
            spaceId={spaceId}
            isGenerating={isGenerating}
            modeSwitching={modeSwitching}
            isOnboarding={isOnboardingSendStep}
            isProcessingImages={isProcessingImages}
            mode={mode}
            onModeChange={onModeChange}
            aiBrowserEnabled={aiBrowserEnabled}
            onAIBrowserToggle={() => setAIBrowserEnabled(!aiBrowserEnabled)}
            onSystemFileClick={handleSystemFileButtonClick}
            workDir={workDir}
            onInsertSkill={onInsertSkill}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={onThinkingToggle}
            canSend={canSend}
            onSend={handleSend}
            onStop={onStop}
          />
          {queueError && (
            <div className="px-3 pb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {queueError}
              </span>
              {onClearQueueError && (
                <button
                  type="button"
                  onClick={onClearQueueError}
                  className="rounded px-2 py-0.5 hover:bg-muted/60 transition-colors"
                >
                  {t('Clear')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Input Toolbar - Bottom action bar
 * Extracted as a separate component for maintainability and future extensibility
 *
 * Layout: [+attachment] ──────────────────────────────────────── [send]
 */
interface InputToolbarProps {
  conversation: { id: string; ai?: ConversationAiConfig } | null
  config: KiteConfig | null
  spaceId: string | null
  isGenerating: boolean
  modeSwitching: boolean
  isOnboarding: boolean
  isProcessingImages: boolean
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  aiBrowserEnabled: boolean
  onAIBrowserToggle: () => void
  onSystemFileClick: () => void
  workDir?: string
  onInsertSkill: (skillName: string) => void
  thinkingEnabled: boolean
  onThinkingToggle: () => void
  canSend: boolean
  onSend: () => void
  onStop: () => void
}

function InputToolbar({
  conversation,
  config,
  spaceId,
  isGenerating,
  modeSwitching,
  isOnboarding,
  isProcessingImages,
  mode,
  onModeChange,
  aiBrowserEnabled,
  onAIBrowserToggle,
  onSystemFileClick,
  workDir,
  onInsertSkill,
  thinkingEnabled,
  onThinkingToggle,
  canSend,
  onSend,
  onStop
}: InputToolbarProps) {
  const { t } = useTranslation()
  const isPlanMode = mode === 'plan'
  const planButtonLabel = t('Plan')
  return (
    <div className="space-studio-toolbar flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5">
      {/* Left section: attachment button + mode toggles */}
      <div className="flex items-center gap-1 min-w-0">
        <ModelSwitcher
          conversation={conversation}
          config={config}
          spaceId={spaceId}
          isGenerating={isGenerating}
        />
        {!isOnboarding && (
          <>
            <button
              onClick={onSystemFileClick}
              disabled={isProcessingImages}
              className={`w-8 h-8 flex items-center justify-center rounded-lg
                transition-all duration-150
                ${isProcessingImages
                  ? 'opacity-50 cursor-not-allowed text-muted-foreground/40'
                  : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5'
                }
              `}
              title={t('System files')}
            >
              <Plus size={18} />
            </button>

            {/* AI Browser toggle */}
            <button
              onClick={onAIBrowserToggle}
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
                transition-colors duration-200 relative border
                ${aiBrowserEnabled
                  ? 'bg-foreground/10 border-foreground/20 text-foreground'
                  : 'border-border/60 text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5'
                }
              `}
              title={aiBrowserEnabled ? t('AI Browser enabled (click to disable)') : t('Enable AI Browser')}
            >
              <Globe size={15} />
              <span className="text-xs">{t('Browser')}</span>
              {aiBrowserEnabled && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-foreground rounded-full" />
              )}
            </button>

            {/* Skills dropdown */}
            {/* {workDir && (
              <SkillsDropdown
                workDir={workDir}
                onInsertSkill={onInsertSkill}
              />
            )} */}

            {/* Thinking mode toggle */}
            {/* <button
              onClick={onThinkingToggle}
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
                transition-colors duration-200 border
                ${thinkingEnabled
                  ? 'bg-foreground/10 border-foreground/20 text-foreground'
                  : 'border-border/60 text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5'
                }
              `}
              title={thinkingEnabled ? t('Disable Deep Thinking') : t('Enable Deep Thinking')}
            >
              <Atom size={15} />
              <span className="text-xs">{t('Deep Thinking')}</span>
            </button> */}

          </>
        )}
        {!isOnboarding && !isGenerating && (
          <button
            onClick={() => onModeChange(isPlanMode ? 'code' : 'plan')}
            disabled={modeSwitching}
            aria-pressed={isPlanMode}
            className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
              transition-colors duration-200 relative border
              ${isPlanMode
                ? 'bg-foreground/10 border-foreground/20 text-foreground'
                : 'border-border/60 text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5'
              }
              ${modeSwitching ? 'opacity-60 cursor-not-allowed' : ''}
            `}
            title={t(isPlanMode ? 'Disable Plan Mode' : 'Enable Plan Mode')}
          >
            <ClipboardList size={15} />
            <span className="text-xs">{planButtonLabel}</span>
            {isPlanMode && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-foreground rounded-full" />
            )}
          </button>
        )}
      </div>

      {/* Right section: action button only */}
      <div className="flex items-center gap-1.5">
        {(!isGenerating || canSend) && (
          <button
            data-onboarding="send-button"
            onClick={onSend}
            disabled={!canSend}
            className={`
              h-8 px-2.5 flex items-center justify-center transition-all duration-200 text-xs
              ${canSend
                ? 'space-studio-send-btn active:scale-95'
                : 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={isGenerating
              ? t('Send')
              : t(mode === 'plan' ? 'Send (Plan Mode)' : thinkingEnabled ? 'Send (Deep Thinking)' : 'Send')}
          >
            <span>{t('Send')}</span>
          </button>
        )}
        {isGenerating && !canSend && (
          <button
            onClick={onStop}
            className="w-8 h-8 flex items-center justify-center
              bg-destructive/10 text-destructive rounded-lg
              hover:bg-destructive/20 active:bg-destructive/30
              transition-all duration-150"
            title={t('Stop generation (Esc)')}
          >
            <div className="w-3 h-3 border-2 border-current rounded-sm" />
          </button>
        )}
      </div>
    </div>
  )
}
