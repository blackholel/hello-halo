# 浏览器预览面板实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在对话界面右侧添加一个可折叠的浏览器预览面板，提供导航控制功能（后退、前进、刷新、新标签页）

**Architecture:** 采用组件化架构，新增 BrowserPanel 组件集成到 SpacePage，使用 Zustand 管理面板状态，通过现有 IPC 与主进程通信控制浏览器

**Tech Stack:** React + Zustand + TailwindCSS + 现有 Electron IPC

---

## Task 1: 创建 Zustand Store

**Files:**
- Create: `src/renderer/stores/browser-panel.store.ts`

**Step 1: 创建 store 文件**

```typescript
import { create } from 'zustand'

export interface BrowserPanelState {
  isOpen: boolean
  currentUrl: string
  currentTitle: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  activeViewId: string | null
}

interface BrowserPanelActions {
  open: () => void
  close: () => void
  toggle: () => void
  setActiveViewId: (viewId: string | null) => void
  updateState: (state: Partial<BrowserPanelState>) => void
}

export const useBrowserPanelStore = create<BrowserPanelState & BrowserPanelActions>((set) => ({
  isOpen: false,
  currentUrl: '',
  currentTitle: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  activeViewId: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setActiveViewId: (viewId) => set({ activeViewId: viewId }),
  updateState: (newState) => set(newState),
}))
```

**Step 2: 提交**

```bash
git add src/renderer/stores/browser-panel.store.ts
git commit -m "feat: add browser panel Zustand store"
```

---

## Task 2: 创建 BrowserPanel 组件

**Files:**
- Create: `src/renderer/components/browser-panel/index.tsx`
- Create: `src/renderer/components/browser-panel/BrowserPanel.tsx`
- Create: `src/renderer/components/browser-panel/NavigationBar.tsx`

**Step 1: 创建 NavigationBar 组件**

`src/renderer/components/browser-panel/NavigationBar.tsx`:

```typescript
import { RefreshCw, ArrowLeft, ArrowRight, Plus, Link2 } from 'lucide-react'
import { useBrowserPanelStore } from '../../stores/browser-panel.store'
import { api } from '../../api'

export function NavigationBar() {
  const { currentUrl, canGoBack, canGoForward, isLoading, activeViewId, updateState } = useBrowserPanelStore()

  const handleBack = async () => {
    if (!activeViewId) return
    await api.browserGoBack(activeViewId)
  }

  const handleForward = async () => {
    if (!activeViewId) return
    await api.browserGoForward(activeViewId)
  }

  const handleRefresh = async () => {
    if (!activeViewId) return
    await api.browserReload(activeViewId)
  }

  const handleNewTab = async () => {
    // 打开新标签页，默认导航到空白页或主页
    const viewId = `panel-${Date.now()}`
    await api.createBrowserView(viewId, 'https://www.google.com')
    useBrowserPanelStore.getState().setActiveViewId(viewId)
  }

  const handleUrlChange = async (newUrl: string) => {
    if (!activeViewId) return
    const url = newUrl.startsWith('http') ? newUrl : `https://${newUrl}`
    await api.navigateBrowserView(activeViewId, url)
  }

  return (
    <div className="h-12 flex items-center gap-2 px-3 border-b border-border bg-background">
      <button
        onClick={handleBack}
        disabled={!canGoBack}
        className="p-1.5 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        title="后退"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      <button
        onClick={handleForward}
        disabled={!canGoForward}
        className="p-1.5 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        title="前进"
      >
        <ArrowRight className="w-4 h-4" />
      </button>

      <button
        onClick={handleRefresh}
        disabled={isLoading}
        className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
        title="刷新"
      >
        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
      </button>

      <button
        onClick={handleNewTab}
        className="p-1.5 rounded hover:bg-accent"
        title="新建标签页"
      >
        <Plus className="w-4 h-4" />
      </button>

      <div className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-muted">
        <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          value={currentUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none min-w-0"
          placeholder="输入网址..."
        />
      </div>
    </div>
  )
}
```

**Step 2: 创建 BrowserPreview 组件（占位符，实际预览通过 BrowserView 实现）**

`src/renderer/components/browser-panel/BrowserPreview.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useBrowserPanelStore } from '../../stores/browser-panel.store'
import { api } from '../../api'

export function BrowserPreview() {
  const { activeViewId, updateState } = useBrowserPanelStore()
  const [screenshot, setScreenshot] = useState<string | null>(null)

  // 监听浏览器状态变化
  useEffect(() => {
    const unsubscribe = api.onBrowserStateChange((data: any) => {
      updateState({
        currentUrl: data.url || '',
        currentTitle: data.title || '',
        canGoBack: data.canGoBack || false,
        canGoForward: data.canGoForward || false,
        isLoading: data.isLoading || false,
      })
    })
    return () => unsubscribe()
  }, [updateState])

  // 定时获取截图更新预览
  useEffect(() => {
    if (!activeViewId) return

    const interval = setInterval(async () => {
      try {
        const result = await api.captureBrowserView(activeViewId)
        if (result.success && result.data) {
          setScreenshot(result.data)
        }
      } catch (e) {
        // ignore
      }
    }, 2000) // 每2秒更新一次

    return () => clearInterval(interval)
  }, [activeViewId])

  if (!activeViewId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="mb-2">暂无打开的页面</p>
          <p className="text-sm">点击 + 创建新标签页</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden bg-white">
      {screenshot ? (
        <img src={screenshot} alt="Browser preview" className="w-full h-full object-contain" />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          加载中...
        </div>
      )}
    </div>
  )
}
```

**Step 3: 创建主 BrowserPanel 组件**

`src/renderer/components/browser-panel/BrowserPanel.tsx`:

```typescript
import { X } from 'lucide-react'
import { useBrowserPanelStore } from '../../stores/browser-panel.store'
import { NavigationBar } from './NavigationBar'
import { BrowserPreview } from './BrowserPreview'

export function BrowserPanel() {
  const { isOpen, close } = useBrowserPanelStore()

  if (!isOpen) return null

  return (
    <div className="w-[400px] h-full border-l border-border bg-background flex flex-col shrink-0 animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="h-11 flex items-center justify-between px-4 border-b border-border">
        <span className="font-medium text-sm">Browser</span>
        <button
          onClick={close}
          className="p-1 rounded hover:bg-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Bar */}
      <NavigationBar />

      {/* Preview */}
      <BrowserPreview />
    </div>
  )
}
```

**Step 4: 创建入口文件**

`src/renderer/components/browser-panel/index.tsx`:

```typescript
export { BrowserPanel } from './BrowserPanel'
```

**Step 5: 提交**

```bash
git add src/renderer/components/browser-panel/
git commit -m "feat: add browser panel components"
```

---

## Task 3: 在 SpacePage 中集成 BrowserPanel

**Files:**
- Modify: `src/renderer/pages/SpacePage.tsx`

**Step 1: 导入 BrowserPanel 组件**

在文件顶部添加导入：

```typescript
import { BrowserPanel } from '../components/browser-panel'
```

**Step 2: 在 SpacePage 返回的 JSX 中添加面板**

找到 ChatView 组件后面，添加 BrowserPanel：

```typescript
{/* Chat view */}
{!isCanvasMaximized && layoutMode === 'split' && (
  <div ... >
    <ChatView ... />
  </div>
)}

{/* 添加 BrowserPanel */}
<BrowserPanel />
```

**Step 3: 提交**

```bash
git add src/renderer/pages/SpacePage.tsx
git commit -m "feat: integrate browser panel in SpacePage"
```

---

## Task 4: 添加 Header 按钮控制面板开关

**Files:**
- Modify: `src/renderer/pages/SpacePage.tsx`

**Step 1: 导入 store 和图标**

```typescript
import { useBrowserPanelStore } from '../stores/browser-panel.store'
import { Globe } from 'lucide-react'
```

**Step 2: 添加 Header 按钮**

在 Header 的 right 部分添加按钮（在 layout mode toggle 之前）：

```typescript
// Browser Panel toggle
<button
  onClick={() => useBrowserPanelStore.getState().toggle()}
  className="p-2 rounded-lg transition-all duration-200 group"
  title={t('Browser Panel')}
>
  <Globe className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
</button>
```

**Step 3: 提交**

```bash
git add src/renderer/pages/SpacePage.tsx
git commit -m "feat: add browser panel toggle button in header"
```

---

## Task 5: 处理面板收起/展开时的布局

**Files:**
- Modify: `src/renderer/pages/SpacePage.tsx`

**Step 1: 修改布局逻辑**

当 BrowserPanel 打开时，Chat 区域的宽度需要调整。找到 chat 容器，修改其样式：

```typescript
// 在现有的 className 中添加条件
className={`
  space-studio-pane space-studio-chat-pane flex flex-col min-w-0 relative overflow-hidden
  ${hasBrowserTab ? '' : 'transition-[border-color] duration-300 ease-out'}
  ${isCanvasOpen ? '' : 'flex-1'}
  ${isCanvasTransitioning ? 'pointer-events-none' : ''}
`}
```

由于 BrowserPanel 是固定宽度 (400px)，SpacePage 现有的 flex 布局应该会自动处理。确保 BrowserPanel 在 flex 容器中正确放置。

**Step 2: 提交**

```bash
git commit -m "fix: adjust layout for browser panel"
```

---

## Task 6: 测试和验证

**Step 1: 运行开发服务器**

```bash
npm run dev
```

**Step 2: 验证功能**

1. 点击 Header 上的 Globe 图标，面板应该从右侧滑入
2. 点击 X 按钮或再次点击 Globe 图标，面板应该收起
3. 导航按钮（后退、前进、刷新）应该可用
4. 截图预览应该定期更新

**Step 3: 提交**

```bash
git commit -m "test: verify browser panel functionality"
```

---

## 实现完成检查清单

- [ ] BrowserPanel 组件正确渲染
- [ ] 面板可以打开和收起
- [ ] 导航按钮功能正常
- [ ] 截图预览正常显示
- [ ] Header 按钮控制正常
- [ ] 布局不会冲突

---

## 后续优化（如需要）

1. **标签页管理** - 在面板顶部添加标签栏，支持多标签切换
2. **实时预览优化** - 使用 WebSocket 或更高效的更新机制
3. **地址栏优化** - 支持 URL 验证和自动补全
4. **收藏功能** - 添加书签支持
