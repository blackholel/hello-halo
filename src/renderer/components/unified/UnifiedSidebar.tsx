import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Trash2
} from 'lucide-react'
import type { ConversationMeta, CreateSpaceInput, Space } from '../../types'
import { SpaceIcon } from '../icons/ToolIcons'
import { useTranslation } from '../../i18n'

interface UnifiedSidebarProps {
  spaces: Space[]
  currentSpaceId: string | null
  currentConversationId: string | null
  conversationsBySpaceId: Map<string, ConversationMeta[]>
  isLoading: boolean
  onSelectSpace: (spaceId: string) => Promise<void>
  onExpandSpace: (spaceId: string) => Promise<void>
  onSelectConversation: (spaceId: string, conversationId: string) => Promise<void>
  onCreateSpace: (input: CreateSpaceInput) => Promise<Space | null>
  onCreateConversation: (spaceId: string) => Promise<void>
  onRenameConversation: (spaceId: string, conversationId: string, title: string) => Promise<void>
  onDeleteConversation: (spaceId: string, conversationId: string) => Promise<void>
  onBackToCurrentSpaceMode: () => void
}

const EXPANDED_SPACES_KEY = 'kite-unified-expanded-spaces'

function readExpandedSpaces(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_SPACES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

function persistExpandedSpaces(spaceIds: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_SPACES_KEY, JSON.stringify(Array.from(spaceIds)))
  } catch {
    // Ignore persistence failures in private mode / quota.
  }
}

export function UnifiedSidebar({
  spaces,
  currentSpaceId,
  currentConversationId,
  conversationsBySpaceId,
  isLoading,
  onSelectSpace,
  onExpandSpace,
  onSelectConversation,
  onCreateSpace,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
  onBackToCurrentSpaceMode
}: UnifiedSidebarProps) {
  const { t } = useTranslation()
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(() => readExpandedSpaces())
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null)
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [editingConversation, setEditingConversation] = useState<{
    spaceId: string
    conversationId: string
    title: string
  } | null>(null)

  const sortedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [spaces])

  const toggleExpanded = async (spaceId: string) => {
    const next = new Set(expandedSpaceIds)
    const willExpand = !next.has(spaceId)
    if (willExpand) {
      next.add(spaceId)
      await onExpandSpace(spaceId)
    } else {
      next.delete(spaceId)
    }
    setExpandedSpaceIds(next)
    persistExpandedSpaces(next)
  }

  const handleCreateSpace = async () => {
    const trimmed = newSpaceName.trim()
    if (!trimmed) return

    const created = await onCreateSpace({
      name: trimmed,
      icon: 'folder'
    })
    if (!created) return

    const next = new Set(expandedSpaceIds)
    next.add(created.id)
    setExpandedSpaceIds(next)
    persistExpandedSpaces(next)
    setCreatingSpace(false)
    setNewSpaceName('')
  }

  const handleRenameSubmit = async () => {
    if (!editingConversation) return
    const title = editingConversation.title.trim()
    if (!title) return
    await onRenameConversation(
      editingConversation.spaceId,
      editingConversation.conversationId,
      title
    )
    setEditingConversation(null)
  }

  return (
    <aside className="w-[320px] h-full border-r border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('All spaces')}</p>
            <button
              onClick={onBackToCurrentSpaceMode}
              disabled={!currentSpaceId}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('Back to current space')}
              aria-label={t('Back to current space')}
            >
              {t('Back to current space')}
            </button>
          </div>
          <button
            onClick={() => setCreatingSpace(true)}
            className="p-2 rounded-lg hover:bg-secondary/80 transition-colors"
            title={t('New space')}
            aria-label={t('New space')}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {sortedSpaces.map((space) => {
            const isExpanded = expandedSpaceIds.has(space.id)
            const conversations = conversationsBySpaceId.get(space.id) || []
            const isActiveSpace = currentSpaceId === space.id

            return (
              <div
                key={space.id}
                className="mb-1 rounded-xl border border-transparent hover:border-border/60"
                onMouseEnter={() => setHoveredSpaceId(space.id)}
                onMouseLeave={() => setHoveredSpaceId((prev) => (prev === space.id ? null : prev))}
              >
                <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl ${isActiveSpace ? 'bg-secondary/80' : 'hover:bg-secondary/50'}`}>
                  <button
                    onClick={() => void toggleExpanded(space.id)}
                    className="p-1 rounded-md hover:bg-background/60 transition-colors"
                    aria-label={isExpanded ? t('Collapse') : t('Expand')}
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => void onSelectSpace(space.id)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <SpaceIcon iconId={space.icon} size={16} />
                    <span className="text-sm truncate">{space.isTemp ? 'Kite' : space.name}</span>
                  </button>

                  {hoveredSpaceId === space.id && (
                    <button
                      onClick={() => void onCreateConversation(space.id)}
                      className="p-1 rounded-md hover:bg-background/60 transition-colors"
                      title={t('New conversation')}
                      aria-label={t('New conversation')}
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="pl-7 pr-2 pb-1">
                    {conversations.length === 0 ? (
                      <div className="text-xs text-muted-foreground px-2 py-1.5">
                        {isLoading ? t('Loading...') : t('No conversations')}
                      </div>
                    ) : (
                      conversations.map((conversation) => {
                        const isActiveConversation = isActiveSpace && currentConversationId === conversation.id
                        const isEditing = editingConversation?.conversationId === conversation.id

                        return (
                          <div
                            key={`${space.id}:${conversation.id}`}
                            className={`group flex items-center gap-1 px-2 py-1 rounded-lg ${isActiveConversation ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50'}`}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingConversation.title}
                                onChange={(event) => setEditingConversation({
                                  ...editingConversation,
                                  title: event.target.value
                                })}
                                onBlur={() => void handleRenameSubmit()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void handleRenameSubmit()
                                  }
                                  if (event.key === 'Escape') {
                                    setEditingConversation(null)
                                  }
                                }}
                                className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-0.5 text-xs"
                              />
                            ) : (
                              <button
                                onClick={() => void onSelectConversation(space.id, conversation.id)}
                                className="flex-1 min-w-0 text-left text-xs truncate py-0.5"
                                title={conversation.title}
                              >
                                {conversation.title}
                              </button>
                            )}

                            {!isEditing && (
                              <>
                                <button
                                  onClick={() => setEditingConversation({
                                    spaceId: space.id,
                                    conversationId: conversation.id,
                                    title: conversation.title
                                  })}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background/60 transition-all"
                                  title={t('Rename')}
                                  aria-label={t('Rename')}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (!window.confirm(t('Delete this conversation?'))) return
                                    void onDeleteConversation(space.id, conversation.id)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-destructive transition-all"
                                  title={t('Delete')}
                                  aria-label={t('Delete')}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {creatingSpace && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={() => setCreatingSpace(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('Create space')}</h3>
            <input
              autoFocus
              value={newSpaceName}
              onChange={(event) => setNewSpaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateSpace()
                }
              }}
              placeholder={t('Space name')}
              className="mt-3 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCreatingSpace(false)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary/70"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void handleCreateSpace()}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90"
              >
                {t('Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
