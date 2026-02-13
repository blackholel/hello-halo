/**
 * ArtifactTree - Professional tree view using react-arborist
 * VSCode-style file explorer with keyboard navigation, virtual scrolling, and more
 */

import { useState, useCallback, useEffect, useMemo, createContext, useContext, useRef } from 'react'
import { Tree, NodeRendererProps, NodeApi } from 'react-arborist'
import { api } from '../../api'
import { useCanvasStore } from '../../stores/canvas.store'
import type { ArtifactTreeNode } from '../../types'
import { FileIcon } from '../icons/ToolIcons'
import {
  ChevronRight,
  ChevronDown,
  Download,
  Eye,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Pencil,
  Copy,
  Trash2,
  FolderOpen
} from 'lucide-react'
import { useIsGenerating } from '../../stores/chat.store'
import { useTranslation } from '../../i18n'
import { dirname, join } from 'path-browserify'

// Context to pass openFile function to tree nodes without each node subscribing to store
// This prevents massive re-renders when canvas state changes
type OpenFileFn = (path: string, title?: string) => Promise<void>
const OpenFileContext = createContext<OpenFileFn | null>(null)

// Context for tree operations (context menu, drag, etc.)
interface TreeOperationsContext {
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void
  spaceWorkingDir: string
}
const TreeOperationsContext = createContext<TreeOperationsContext | null>(null)

const isWebMode = api.isRemoteMode()

// File types that can be viewed in the Content Canvas
const CANVAS_VIEWABLE_EXTENSIONS = new Set([
  // Code
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'swift', 'kt', 'php', 'sh', 'bash', 'zsh', 'sql', 'yaml', 'yml', 'xml',
  'vue', 'svelte', 'css', 'scss', 'less',
  // Documents
  'md', 'markdown', 'txt', 'log', 'env', 'pdf',
  // Data
  'json', 'csv',
  // Web
  'html', 'htm',
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
])

interface ArtifactTreeProps {
  spaceId: string
}

// Fixed offsets for tree height calculation (in pixels)
// App Header (44) + Rail Header (40) + Rail Footer (~60) + Tree Header (28) + Toolbar (32) + buffer
const TREE_HEIGHT_OFFSET = 212

// Simple hook using window height minus fixed offset
// No complex measurement needed - window.innerHeight is always immediately available
function useTreeHeight() {
  const [height, setHeight] = useState(() => window.innerHeight - TREE_HEIGHT_OFFSET)

  useEffect(() => {
    const handleResize = () => {
      setHeight(window.innerHeight - TREE_HEIGHT_OFFSET)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return height
}

// Transform backend tree data to react-arborist format
interface TreeNodeData {
  id: string
  name: string
  path: string
  extension: string
  isFolder: boolean
  children?: TreeNodeData[]
}

function transformToArboristData(nodes: ArtifactTreeNode[]): TreeNodeData[] {
  return nodes.map(node => ({
    id: node.id,
    name: node.name,
    path: node.path,
    extension: node.extension,
    isFolder: node.type === 'folder',
    children: node.children ? transformToArboristData(node.children) : undefined
  }))
}

// Context menu state
interface ContextMenuState {
  x: number
  y: number
  node: TreeNodeData
}

export function ArtifactTree({ spaceId }: ArtifactTreeProps) {
  const { t } = useTranslation()
  const [treeData, setTreeData] = useState<TreeNodeData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [spaceWorkingDir, setSpaceWorkingDir] = useState<string>('')
  const isGenerating = useIsGenerating()
  const treeHeight = useTreeHeight()
  const containerRef = useRef<HTMLDivElement>(null)

  // Subscribe to openFile once at parent level, pass down via context
  // This prevents each TreeNodeComponent from subscribing to the store
  const openFile = useCanvasStore(state => state.openFile)

  // Load tree data
  const loadTree = useCallback(async () => {
    if (!spaceId) return

    try {
      setIsLoading(true)
      const response = await api.listArtifactsTree(spaceId)
      if (response.success && response.data) {
        const transformed = transformToArboristData(response.data as ArtifactTreeNode[])
        setTreeData(transformed)

        // Get working directory from first item's parent or space
        if (transformed.length > 0) {
          const firstPath = transformed[0].path
          setSpaceWorkingDir(dirname(firstPath))
        } else {
          // Get space info to determine working dir
          const spaceResponse = await api.getSpace(spaceId)
          if (spaceResponse.success && spaceResponse.data) {
            setSpaceWorkingDir((spaceResponse.data as { path: string }).path)
          }
        }
      }
    } catch (error) {
      console.error('[ArtifactTree] Failed to load tree:', error)
    } finally {
      setIsLoading(false)
    }
  }, [spaceId])

  // Load on mount and when space changes
  useEffect(() => {
    loadTree()
  }, [loadTree])

  // Refresh when generation completes
  useEffect(() => {
    if (!isGenerating) {
      const timer = setTimeout(loadTree, 500)
      return () => clearTimeout(timer)
    }
  }, [isGenerating, loadTree])

  // Refresh when external actions modify artifacts (e.g., change set rollback)
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string }>).detail
      if (detail?.spaceId && detail.spaceId !== spaceId) return
      loadTree()
    }

    window.addEventListener('artifacts:refresh', handleRefresh)
    return () => window.removeEventListener('artifacts:refresh', handleRefresh)
  }, [spaceId, loadTree])

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenu) {
        setContextMenu(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [contextMenu])

  // Count total items
  const itemCount = useMemo(() => {
    const count = (nodes: TreeNodeData[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + (node.children ? count(node.children) : 0)
      }, 0)
    }
    return count(treeData)
  }, [treeData])

  // File operations
  const handleCreateFile = useCallback(async (parentPath?: string) => {
    const fileName = prompt(t('Enter file name:'))
    if (!fileName) return

    const targetDir = parentPath || spaceWorkingDir
    if (!targetDir) {
      console.error('[ArtifactTree] No target directory')
      return
    }

    const filePath = join(targetDir, fileName)
    const result = await api.createFile(filePath)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to create file'))
    }
  }, [spaceWorkingDir, loadTree, t])

  const handleCreateFolder = useCallback(async (parentPath?: string) => {
    const folderName = prompt(t('Enter folder name:'))
    if (!folderName) return

    const targetDir = parentPath || spaceWorkingDir
    if (!targetDir) {
      console.error('[ArtifactTree] No target directory')
      return
    }

    const folderPath = join(targetDir, folderName)
    const result = await api.createFolder(folderPath)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to create folder'))
    }
  }, [spaceWorkingDir, loadTree, t])

  const handleRename = useCallback(async (node: TreeNodeData) => {
    const newName = prompt(t('Enter new name:'), node.name)
    if (!newName || newName === node.name) return

    const result = await api.renameArtifact(node.path, newName)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to rename'))
    }
  }, [loadTree, t])

  const handleDelete = useCallback(async (node: TreeNodeData) => {
    const confirmed = confirm(
      node.isFolder
        ? t('Delete folder "{name}" and all its contents?', { name: node.name })
        : t('Delete file "{name}"?', { name: node.name })
    )
    if (!confirmed) return

    const result = await api.deleteArtifact(node.path)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to delete'))
    }
  }, [loadTree, t])

  const handleCopyPath = useCallback((node: TreeNodeData) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  const handleShowInFolder = useCallback(async (node: TreeNodeData) => {
    if (!isWebMode) {
      await api.showArtifactInFolder(node.path)
    }
  }, [])

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNodeData) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node
    })
  }, [])

  // Handle tree move (drag & drop within tree)
  const handleMove = useCallback(async (args: {
    dragIds: string[]
    parentId: string | null
    index: number
  }) => {
    // Find the dragged node and target parent
    const findNode = (nodes: TreeNodeData[], id: string): TreeNodeData | null => {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findNode(node.children, id)
          if (found) return found
        }
      }
      return null
    }

    const draggedNode = findNode(treeData, args.dragIds[0])
    if (!draggedNode) return

    let targetDir: string
    if (args.parentId) {
      const parentNode = findNode(treeData, args.parentId)
      if (parentNode && parentNode.isFolder) {
        targetDir = parentNode.path
      } else {
        return // Can't drop on a file
      }
    } else {
      targetDir = spaceWorkingDir
    }

    const result = await api.moveArtifact(draggedNode.path, targetDir)
    if (result.success) {
      loadTree()
    } else {
      console.error('[ArtifactTree] Move failed:', result.error)
    }
  }, [treeData, spaceWorkingDir, loadTree])

  // Tree operations context value
  const treeOperations = useMemo(() => ({
    onContextMenu: handleContextMenu,
    spaceWorkingDir
  }), [handleContextMenu, spaceWorkingDir])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-2">
        <div className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-2" />
        <p className="text-xs text-muted-foreground">{t('Loading...')}</p>
      </div>
    )
  }

  if (treeData.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 border-b border-border/50 bg-card/95">
          <button
            onClick={() => handleCreateFile()}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('New File')}
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleCreateFolder()}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('New Folder')}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={loadTree}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('Refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center flex-1 text-center px-2">
          <div className="w-10 h-10 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center mb-2">
            <ChevronRight className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground">{t('No files')}</p>
        </div>
      </div>
    )
  }

  return (
    <OpenFileContext.Provider value={openFile}>
      <TreeOperationsContext.Provider value={treeOperations}>
        <div ref={containerRef} className="flex flex-col h-full relative">
          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 border-b border-border/50 bg-card/95">
            <button
              onClick={() => handleCreateFile()}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('New File')}
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleCreateFolder()}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('New Folder')}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={loadTree}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('Refresh')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Header with count */}
          <div className="flex-shrink-0 bg-card/95 backdrop-blur-sm px-2 py-1.5 border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider">
            {t('Files')} ({itemCount})
          </div>

          {/* Tree - uses window height based calculation */}
          <div className="flex-1 overflow-hidden">
            <Tree
              data={treeData}
              openByDefault={false}
              width="100%"
              height={treeHeight}
              indent={16}
              rowHeight={26}
              overscanCount={5}
              paddingTop={4}
              paddingBottom={4}
              disableDrag={false}
              disableDrop={false}
              disableEdit
              onMove={handleMove}
            >
              {TreeNodeComponent}
            </Tree>
          </div>

          {/* Context Menu */}
          {contextMenu && (
            <div
              className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1"
              style={{
                left: contextMenu.x,
                top: contextMenu.y
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.node.isFolder && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                    onClick={() => {
                      handleCreateFile(contextMenu.node.path)
                      setContextMenu(null)
                    }}
                  >
                    <FilePlus className="w-4 h-4" />
                    {t('New File')}
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                    onClick={() => {
                      handleCreateFolder(contextMenu.node.path)
                      setContextMenu(null)
                    }}
                  >
                    <FolderPlus className="w-4 h-4" />
                    {t('New Folder')}
                  </button>
                  <div className="h-px bg-border my-1" />
                </>
              )}
              <button
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                onClick={() => {
                  handleRename(contextMenu.node)
                  setContextMenu(null)
                }}
              >
                <Pencil className="w-4 h-4" />
                {t('Rename')}
              </button>
              <button
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                onClick={() => {
                  handleCopyPath(contextMenu.node)
                  setContextMenu(null)
                }}
              >
                <Copy className="w-4 h-4" />
                {t('Copy Path')}
              </button>
              {!isWebMode && (
                <button
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                  onClick={() => {
                    handleShowInFolder(contextMenu.node)
                    setContextMenu(null)
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                  {t('Show in Folder')}
                </button>
              )}
              <div className="h-px bg-border my-1" />
              <button
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2 text-destructive"
                onClick={() => {
                  handleDelete(contextMenu.node)
                  setContextMenu(null)
                }}
              >
                <Trash2 className="w-4 h-4" />
                {t('Delete')}
              </button>
            </div>
          )}
        </div>
      </TreeOperationsContext.Provider>
    </OpenFileContext.Provider>
  )
}

// Custom node renderer for VSCode-like appearance
// Uses context for openFile to avoid store subscription in each node
function TreeNodeComponent({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  // Get openFile from context (subscribed once at parent ArtifactTree level)
  const openFile = useContext(OpenFileContext)
  const treeOps = useContext(TreeOperationsContext)
  const data = node.data
  const isFolder = data.isFolder

  // Check if this file can be viewed in the canvas
  const canViewInCanvas = !isFolder && data.extension &&
    CANVAS_VIEWABLE_EXTENSIONS.has(data.extension.toLowerCase())

  // Handle click - open in canvas, system app, or download
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder) {
      node.toggle()
      return
    }

    // Try to open in Canvas first for viewable files
    if (canViewInCanvas && openFile) {
      openFile(data.path, data.name)
      return
    }

    // Fallback behavior for non-viewable files
    if (isWebMode) {
      // In web mode, trigger download
      api.downloadArtifact(data.path)
    } else {
      // In desktop mode, open with system app
      try {
        await api.openArtifact(data.path)
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
  }

  // Handle double-click to force open with system app
  const handleDoubleClickFile = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder) {
      node.toggle()
      return
    }
    if (isWebMode) {
      api.downloadArtifact(data.path)
    } else {
      try {
        await api.openArtifact(data.path)
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
  }

  // Handle right-click - show context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (treeOps) {
      treeOps.onContextMenu(e, data)
    }
  }

  // Handle drag start for external drag (to canvas, etc.)
  const handleDragStart = (e: React.DragEvent) => {
    if (isFolder) return

    // Set data for external drop targets (like Content Canvas)
    e.dataTransfer.setData('application/x-kite-file', JSON.stringify({
      path: data.path,
      name: data.name,
      extension: data.extension
    }))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={handleClick}
      onDoubleClick={handleDoubleClickFile}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={!isFolder}
      className={`
        flex items-center h-full pr-2 cursor-pointer select-none
        transition-colors duration-75
        ${node.isSelected ? 'bg-primary/15' : ''}
        ${isHovered && !node.isSelected ? 'bg-secondary/60' : ''}
        ${node.isFocused ? 'outline outline-1 outline-primary/50 -outline-offset-1' : ''}
      `}
      title={canViewInCanvas
        ? t('Click to preview · double-click to open with system')
        : (isWebMode && !isFolder ? t('Click to download file') : data.path)
      }
    >
      {/* Expand/collapse arrow for folders */}
      <span
        className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          if (isFolder) node.toggle()
        }}
      >
        {isFolder ? (
          node.isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70" />
          )
        ) : null}
      </span>

      {/* File/folder icon */}
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1.5">
        <FileIcon
          extension={data.extension}
          isFolder={isFolder}
          isOpen={isFolder && node.isOpen}
          size={15}
        />
      </span>

      {/* File name */}
      <span className={`
        text-[13px] truncate flex-1
        ${isFolder ? 'font-medium text-foreground/90' : 'text-foreground/80'}
      `}>
        {data.name}
      </span>

      {/* Action indicator */}
      {!isFolder && isHovered && (
        canViewInCanvas ? (
          <Eye className="w-3 h-3 text-primary flex-shrink-0 ml-1" />
        ) : isWebMode ? (
          <Download className="w-3 h-3 text-primary flex-shrink-0 ml-1" />
        ) : null
      )}
    </div>
  )
}
