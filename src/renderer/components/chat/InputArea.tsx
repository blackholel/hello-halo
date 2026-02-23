/**
 * Input Area - Enhanced message input with bottom toolbar
 *
 * Layout (following industry standard - Qwen, ChatGPT, Baidu):
 * ┌──────────────────────────────────────────────────────┐
 * │ [Image previews]                                     │
 * │ ┌──────────────────────────────────────────────────┐ │
 * │ │ Textarea                                         │ │
 * │ └──────────────────────────────────────────────────┘ │
 * │ [+] [⚛]─────────────────────────────────  [Send] │
 * │      Bottom toolbar: always visible, expandable     │
 * └──────────────────────────────────────────────────────┘
 *
 * Features:
 * - Auto-resize textarea
 * - Keyboard shortcuts (Enter to send, Shift+Enter newline)
 * - Image paste/drop support with compression
 * - Extended thinking mode toggle (theme-colored)
 * - Bottom toolbar for future extensibility
 */

import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent, ClipboardEvent, DragEvent } from 'react'
import { Plus, ImagePlus, Loader2, AlertCircle, Atom, Globe, ClipboardList } from 'lucide-react'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useAIBrowserStore } from '../../stores/ai-browser.store'
import { useSpaceStore } from '../../stores/space.store'
import { useSkillsStore, type SkillDefinition } from '../../stores/skills.store'
import { useAgentsStore, type AgentDefinition } from '../../stores/agents.store'
import { useCommandsStore, type CommandDefinition } from '../../stores/commands.store'
import { getOnboardingPrompt } from '../onboarding/onboardingData'
import { ImageAttachmentPreview } from './ImageAttachmentPreview'
import { FileContextPreview } from './FileContextPreview'
import { SkillsDropdown } from '../skills/SkillsDropdown'
import { ModelSwitcher } from './ModelSwitcher'
import { ComposerTriggerPanel, type ComposerSuggestionItem, type ComposerSuggestionTab } from './ComposerTriggerPanel'
import { processImage, isValidImageType, formatFileSize } from '../../utils/imageProcessor'
import type { ConversationAiConfig, FileContextAttachment, ImageAttachment, KiteConfig } from '../../types'
import { useTranslation } from '../../i18n'
import { useComposerStore } from '../../stores/composer.store'
import { commandKey } from '../../../shared/command-utils'
import { getTriggerContext, replaceTriggerToken, type TriggerContext } from '../../utils/composer-trigger'
import { isResourceEnabled, toResourceKey } from '../../utils/resource-key'

interface InputAreaProps {
  onSend: (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean, fileContexts?: FileContextAttachment[], planEnabled?: boolean) => void
  onStop: () => void
  isGenerating: boolean
  spaceId: string | null
  placeholder?: string
  isCompact?: boolean
  workDir?: string  // For skills dropdown
  planEnabled: boolean
  onPlanEnabledChange: (enabled: boolean) => void
  conversation: { id: string; ai?: ConversationAiConfig } | null
  config: KiteConfig | null
}

// Image constraints
const MAX_IMAGE_SIZE = 20 * 1024 * 1024  // 20MB max per image (before compression)
const MAX_IMAGES = 10  // Max images per message

// Error message type
interface ImageError {
  id: string
  message: string
}

function getLocalizedName(item: { name: string; displayName?: string; namespace?: string }): string {
  const base = item.displayName || item.name
  return item.namespace ? `${item.namespace}:${base}` : base
}

export function InputArea({
  onSend,
  onStop,
  isGenerating,
  spaceId,
  placeholder,
  isCompact = false,
  workDir,
  planEnabled,
  onPlanEnabledChange,
  conversation,
  config,
}: InputAreaProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [fileContexts, setFileContexts] = useState<FileContextAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [imageError, setImageError] = useState<ImageError | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)  // Extended thinking mode
  const [showAttachMenu, setShowAttachMenu] = useState(false)  // Attachment menu visibility
  const [triggerContext, setTriggerContext] = useState<TriggerContext | null>(null)
  const [activeSuggestionTab, setActiveSuggestionTab] = useState<ComposerSuggestionTab>('skills')
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const lastTriggerTypeRef = useRef<TriggerContext['type'] | null>(null)
  const insertQueue = useComposerStore(state => state.insertQueue)
  const dequeueInsert = useComposerStore(state => state.dequeueInsert)

  // AI Browser state
  const { enabled: aiBrowserEnabled, setEnabled: setAIBrowserEnabled } = useAIBrowserStore()
  const { currentSpace, spaces, haloSpace, getSpacePreferences } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    spaces: state.spaces,
    haloSpace: state.haloSpace,
    getSpacePreferences: state.getSpacePreferences
  }))
  const {
    skills,
    loadedWorkDir: loadedSkillsWorkDir,
    loadSkills
  } = useSkillsStore((state) => ({
    skills: state.skills,
    loadedWorkDir: state.loadedWorkDir,
    loadSkills: state.loadSkills
  }))
  const {
    commands,
    loadedWorkDir: loadedCommandsWorkDir,
    loadCommands
  } = useCommandsStore((state) => ({
    commands: state.commands,
    loadedWorkDir: state.loadedWorkDir,
    loadCommands: state.loadCommands
  }))
  const {
    agents,
    loadedWorkDir: loadedAgentsWorkDir,
    loadAgents
  } = useAgentsStore((state) => ({
    agents: state.agents,
    loadedWorkDir: state.loadedWorkDir,
    loadAgents: state.loadAgents
  }))
  const resolvedSpace = useMemo(() => {
    if (!spaceId) return null
    if (currentSpace?.id === spaceId) return currentSpace
    if (haloSpace?.id === spaceId) return haloSpace
    return spaces.find(space => space.id === spaceId) || null
  }, [spaceId, currentSpace, haloSpace, spaces])

  const spacePreferences = useMemo(() => {
    if (!spaceId) return undefined
    if (resolvedSpace?.preferences) return resolvedSpace.preferences
    return getSpacePreferences(spaceId)
  }, [getSpacePreferences, resolvedSpace?.preferences, spaceId])

  const enabledSkills = spacePreferences?.skills?.enabled || []
  const enabledAgents = spacePreferences?.agents?.enabled || []

  const triggerQuery = triggerContext?.query.trim().toLowerCase() || ''

  useEffect(() => {
    if (loadedSkillsWorkDir !== (workDir ?? null) || skills.length === 0) {
      void loadSkills(workDir)
    }
  }, [loadedSkillsWorkDir, loadSkills, skills.length, workDir])

  useEffect(() => {
    if (loadedCommandsWorkDir !== (workDir ?? null) || commands.length === 0) {
      void loadCommands(workDir)
    }
  }, [commands.length, loadCommands, loadedCommandsWorkDir, workDir])

  useEffect(() => {
    if (loadedAgentsWorkDir !== (workDir ?? null) || agents.length === 0) {
      void loadAgents(workDir)
    }
  }, [agents.length, loadAgents, loadedAgentsWorkDir, workDir])

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (imageError) {
      const timer = setTimeout(() => setImageError(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [imageError])

  // Close attachment menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
      }
    }

    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAttachMenu])

  // Show error to user
  const showError = (message: string) => {
    setImageError({ id: `err-${Date.now()}`, message })
  }

  // Onboarding state
  const { isActive: isOnboarding, currentStep } = useOnboardingStore()
  const isOnboardingSendStep = isOnboarding && currentStep === 'send-message'

  // In onboarding send step, show prefilled prompt
  const onboardingPrompt = getOnboardingPrompt(t)
  const displayContent = isOnboardingSendStep ? onboardingPrompt : content
  const isTriggerPanelOpen = Boolean(triggerContext) && !isOnboardingSendStep && !isGenerating

  const matchesTriggerQuery = useCallback((...values: Array<string | undefined>) => {
    if (!triggerQuery) return true
    return values.some(value => value?.toLowerCase().includes(triggerQuery))
  }, [triggerQuery])

  const filteredSkills = useMemo(() => {
    let items = skills.filter(skill => skill.source === 'space')
    if (enabledSkills.length > 0) {
      items = items.filter(skill => isResourceEnabled(enabledSkills, skill))
    }
    return items.filter((skill) => matchesTriggerQuery(
      toResourceKey(skill),
      skill.name,
      skill.displayName,
      skill.description
    ))
  }, [enabledSkills, matchesTriggerQuery, skills])

  const filteredCommands = useMemo(() => {
    const items = commands.filter(command => command.source === 'space')
    return items.filter((command) => matchesTriggerQuery(
      commandKey(command),
      command.name,
      command.displayName,
      command.description
    ))
  }, [commands, matchesTriggerQuery])

  const filteredAgents = useMemo(() => {
    let items = agents.filter(agent => agent.source === 'space')
    if (enabledAgents.length > 0) {
      items = items.filter(agent => isResourceEnabled(enabledAgents, agent))
    }
    return items.filter((agent) => matchesTriggerQuery(
      toResourceKey(agent),
      agent.name,
      agent.displayName,
      agent.description
    ))
  }, [agents, enabledAgents, matchesTriggerQuery])

  const skillSuggestions = useMemo<ComposerSuggestionItem[]>(() => (
    filteredSkills.map((skill: SkillDefinition) => {
      const key = toResourceKey(skill)
      return {
        id: `skill:${skill.path}`,
        type: 'skill',
        displayName: getLocalizedName(skill),
        insertText: `/${key}`,
        description: skill.description
      }
    })
  ), [filteredSkills])

  const commandSuggestions = useMemo<ComposerSuggestionItem[]>(() => (
    filteredCommands.map((command: CommandDefinition) => {
      const key = commandKey(command)
      return {
        id: `command:${command.path}`,
        type: 'command',
        displayName: getLocalizedName(command),
        insertText: `/${key}`,
        description: command.description
      }
    })
  ), [filteredCommands])

  const agentSuggestions = useMemo<ComposerSuggestionItem[]>(() => (
    filteredAgents.map((agent: AgentDefinition) => {
      const key = toResourceKey(agent)
      return {
        id: `agent:${agent.path}`,
        type: 'agent',
        displayName: getLocalizedName(agent),
        insertText: `@${key}`,
        description: agent.description
      }
    })
  ), [filteredAgents])

  const suggestionCounts = useMemo<Record<ComposerSuggestionTab, number>>(() => ({
    skills: skillSuggestions.length,
    commands: commandSuggestions.length,
    agents: agentSuggestions.length
  }), [agentSuggestions.length, commandSuggestions.length, skillSuggestions.length])

  const activeSuggestions = useMemo(() => {
    if (!triggerContext) return [] as ComposerSuggestionItem[]
    if (triggerContext.type === 'mention') {
      return agentSuggestions
    }
    if (activeSuggestionTab === 'commands') {
      return commandSuggestions
    }
    if (activeSuggestionTab === 'agents') {
      return agentSuggestions
    }
    return skillSuggestions
  }, [activeSuggestionTab, agentSuggestions, commandSuggestions, skillSuggestions, triggerContext])

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
    if (!isDragOver) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

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

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      await addImages(files)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle image button click (from attachment menu)
  const handleImageButtonClick = () => {
    setShowAttachMenu(false)
    fileInputRef.current?.click()
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
    setTriggerContext(null)
    setActiveSuggestionIndex(0)
  }, [])

  const refreshTriggerContext = useCallback((nextValue?: string, nextCaret?: number) => {
    if (isOnboardingSendStep || isGenerating) {
      closeTriggerPanel()
      return
    }

    const textarea = textareaRef.current
    const value = nextValue ?? content
    const caret = nextCaret ?? textarea?.selectionStart ?? value.length
    const context = getTriggerContext(value, caret)
    setTriggerContext(context)
  }, [closeTriggerPanel, content, isGenerating, isOnboardingSendStep])

  useEffect(() => {
    if (isGenerating || isOnboardingSendStep) {
      closeTriggerPanel()
    }
  }, [closeTriggerPanel, isGenerating, isOnboardingSendStep])

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

  const applySuggestion = useCallback((item: ComposerSuggestionItem) => {
    if (!triggerContext) return
    const replaced = replaceTriggerToken(content, triggerContext, item.insertText)
    setContent(replaced.value)
    closeTriggerPanel()
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(replaced.caret, replaced.caret)
    })
  }, [closeTriggerPanel, content, triggerContext])

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
    const textToSend = isOnboardingSendStep ? onboardingPrompt : content.trim()
    const hasContent = textToSend || images.length > 0 || fileContexts.length > 0

    if (hasContent && !isGenerating) {
      closeTriggerPanel()
      onSend(
        textToSend,
        images.length > 0 ? images : undefined,
        thinkingEnabled,
        fileContexts.length > 0 ? fileContexts : undefined,
        planEnabled
      )

      if (!isOnboardingSendStep) {
        setContent('')
        setImages([])  // Clear images after send
        setFileContexts([])  // Clear file contexts after send
        // Don't reset thinkingEnabled - user might want to keep it on
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

  // Consume pending insert requests from sidebar panels
  useEffect(() => {
    if (insertQueue.length === 0) return
    const next = insertQueue[0]
    insertText(next.text)
    dequeueInsert(next.id)
  }, [insertQueue, dequeueInsert, insertText])

  // Handle skill insertion from SkillsDropdown
  const handleInsertSkill = (skillName: string) => {
    insertText(`/${skillName} `)
  }

  // In onboarding mode, can always send (prefilled content)
  // Can send if has text OR has images OR has file contexts (and not processing/generating)
  const canSend = isOnboardingSendStep || ((content.trim().length > 0 || images.length > 0 || fileContexts.length > 0) && !isGenerating && !isProcessingImages)
  const hasImages = images.length > 0
  const hasFileContexts = fileContexts.length > 0

  return (
    <div className={`
      border-t border-border/50 bg-background/80 backdrop-blur-sm
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

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Input container */}
        <div
          ref={inputContainerRef}
          className={`
            relative flex flex-col rounded-2xl transition-all duration-200
            ${isFocused
              ? 'ring-1 ring-primary/30 bg-card shadow-sm'
              : 'bg-secondary/50 hover:bg-secondary/70'
            }
            ${isGenerating ? 'opacity-60' : ''}
            ${isDragOver ? 'ring-2 ring-primary/50 bg-primary/5' : ''}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
              bg-primary/5 rounded-2xl border-2 border-dashed border-primary/30
              pointer-events-none z-10">
              <div className="flex flex-col items-center gap-2 text-primary/70">
                <ImagePlus size={24} />
                <span className="text-sm font-medium">{t('Drop to add images')}</span>
              </div>
            </div>
          )}

          {/* Textarea area */}
          <div className="px-3 pt-3 pb-1">
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
              placeholder={placeholder || t('Type a message, let Kite help you...')}
              disabled={isGenerating}
              readOnly={isOnboardingSendStep}
              rows={1}
              className={`w-full bg-transparent resize-none
                focus:outline-none text-foreground placeholder:text-muted-foreground/50
                disabled:cursor-not-allowed min-h-[24px]
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
            isOnboarding={isOnboardingSendStep}
            isProcessingImages={isProcessingImages}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={() => setThinkingEnabled(!thinkingEnabled)}
            planEnabled={planEnabled}
            onPlanToggle={() => onPlanEnabledChange(!planEnabled)}
            aiBrowserEnabled={aiBrowserEnabled}
            onAIBrowserToggle={() => setAIBrowserEnabled(!aiBrowserEnabled)}
            showAttachMenu={showAttachMenu}
            onAttachMenuToggle={() => setShowAttachMenu(!showAttachMenu)}
            onImageClick={handleImageButtonClick}
            imageCount={images.length}
            maxImages={MAX_IMAGES}
            attachMenuRef={attachMenuRef}
            canSend={canSend}
            onSend={handleSend}
            onStop={onStop}
            workDir={workDir}
            onInsertSkill={handleInsertSkill}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Input Toolbar - Bottom action bar
 * Extracted as a separate component for maintainability and future extensibility
 *
 * Layout: [+attachment] [skills] ──────────────────── [⚛ thinking] [send]
 */
interface InputToolbarProps {
  conversation: { id: string; ai?: ConversationAiConfig } | null
  config: KiteConfig | null
  spaceId: string | null
  isGenerating: boolean
  isOnboarding: boolean
  isProcessingImages: boolean
  thinkingEnabled: boolean
  onThinkingToggle: () => void
  planEnabled: boolean
  onPlanToggle: () => void
  aiBrowserEnabled: boolean
  onAIBrowserToggle: () => void
  showAttachMenu: boolean
  onAttachMenuToggle: () => void
  onImageClick: () => void
  imageCount: number
  maxImages: number
  attachMenuRef: React.RefObject<HTMLDivElement | null>
  canSend: boolean
  onSend: () => void
  onStop: () => void
  workDir?: string
  onInsertSkill: (skillName: string) => void
}

function InputToolbar({
  conversation,
  config,
  spaceId,
  isGenerating,
  isOnboarding,
  isProcessingImages,
  thinkingEnabled,
  onThinkingToggle,
  planEnabled,
  onPlanToggle,
  aiBrowserEnabled,
  onAIBrowserToggle,
  showAttachMenu,
  onAttachMenuToggle,
  onImageClick,
  imageCount,
  maxImages,
  attachMenuRef,
  canSend,
  onSend,
  onStop,
  workDir,
  onInsertSkill
}: InputToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between px-2 pb-2 pt-1">
      {/* Left section: attachment button + mode toggles */}
      <div className="flex items-center gap-1 min-w-0">
        <ModelSwitcher
          conversation={conversation}
          config={config}
          spaceId={spaceId}
          isGenerating={isGenerating}
        />
        {!isGenerating && !isOnboarding && (
          <>
            {/* Attachment menu */}
            <div className="relative" ref={attachMenuRef}>
              <button
                onClick={onAttachMenuToggle}
                disabled={isProcessingImages}
                className={`w-8 h-8 flex items-center justify-center rounded-lg
                  transition-all duration-150
                  ${showAttachMenu
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
                  }
                  ${isProcessingImages ? 'opacity-50 cursor-not-allowed' : ''}
                `}
                title={t('Add attachment')}
              >
                <Plus size={18} className={`transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`} />
              </button>

              {/* Attachment menu dropdown */}
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-popover border border-border
                  rounded-xl shadow-lg min-w-[160px] z-20 animate-fade-in">
                  <button
                    onClick={onImageClick}
                    disabled={imageCount >= maxImages}
                    className={`w-full px-3 py-2 flex items-center gap-3 text-sm
                      transition-colors duration-150
                      ${imageCount >= maxImages
                        ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-foreground hover:bg-muted/50'
                      }
                    `}
                  >
                    <ImagePlus size={16} className="text-muted-foreground" />
                    <span>{t('Add image')}</span>
                    {imageCount > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {imageCount}/{maxImages}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* AI Browser toggle */}
            <button
              onClick={onAIBrowserToggle}
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
                transition-colors duration-200 relative
                ${aiBrowserEnabled
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
                }
              `}
              title={aiBrowserEnabled ? t('AI Browser enabled (click to disable)') : t('Enable AI Browser')}
            >
              <Globe size={15} />
              <span className="text-xs">{t('Browser')}</span>
              {aiBrowserEnabled && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full" />
              )}
            </button>

            {/* Skills dropdown */}
            {workDir && (
              <SkillsDropdown
                workDir={workDir}
                onInsertSkill={onInsertSkill}
              />
            )}

            {/* Thinking mode toggle */}
            <button
              onClick={onThinkingToggle}
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
                transition-colors duration-200
                ${thinkingEnabled
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
                }
              `}
              title={thinkingEnabled ? t('Disable Deep Thinking') : t('Enable Deep Thinking')}
            >
              <Atom size={15} />
              <span className="text-xs">{t('Deep Thinking')}</span>
            </button>

            {/* Plan mode toggle */}
            <button
              onClick={onPlanToggle}
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-lg
                transition-colors duration-200
                ${planEnabled
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
                }
              `}
              title={planEnabled ? t('Disable Plan Mode') : t('Enable Plan Mode')}
            >
              <ClipboardList size={15} />
              <span className="text-xs">{t('Plan')}</span>
            </button>
          </>
        )}
      </div>

      {/* Right section: action button only */}
      <div className="flex items-center">
        {isGenerating ? (
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
        ) : (
          <button
            data-onboarding="send-button"
            onClick={onSend}
            disabled={!canSend}
            className={`
              w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200
              ${canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95'
                : 'bg-muted/50 text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={t(planEnabled ? 'Send (Plan Mode)' : thinkingEnabled ? 'Send (Deep Thinking)' : 'Send')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
