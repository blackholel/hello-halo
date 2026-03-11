# 浏览器预览面板设计文档

**日期:** 2026-03-11
**功能:** 右侧浏览器预览面板

---

## 1. 需求概述

在对话界面右侧添加一个可折叠的浏览器预览面板，提供以下功能：

- **位置:** 对话界面右侧
- **宽度:** 400px
- **默认状态:** 收起（用户手动打开）
- **核心功能:** 导航控制 + 页面预览

---

## 2. 用户交互流程

1. 用户点击 Header 上的浏览器图标按钮打开面板
2. 面板从右侧滑入，显示当前浏览器页面预览
3. 用户可以使用导航按钮进行操作
4. 再次点击图标或关闭按钮收起面板

---

## 3. 架构设计

### 3.1 组件结构

```
src/renderer/
├── components/
│   └── browser-panel/
│       ├── index.tsx          # 主组件
│       ├── BrowserPanel.tsx    # 面板组件
│       ├── BrowserPreview.tsx # 页面预览（使用 iframe 或 webview）
│       ├── NavigationBar.tsx  # 导航控制栏
│       └── types.ts            # 类型定义
```

### 3.2 状态管理

新增 Zustand store `useBrowserPanelStore`:

```typescript
interface BrowserPanelState {
  isOpen: boolean        // 面板是否展开
  currentUrl: string      // 当前页面 URL
  currentTitle: string    // 当前页面标题
  canGoBack: boolean      // 是否可以后退
  canGoForward: boolean   // 是否可以前进
  isLoading: boolean      // 是否正在加载
  activeViewId: string    // 当前活跃的 BrowserView ID
}
```

### 3.2 IPC 通信

前端通过 `api` 调用主进程：

```typescript
// 主进程现有接口（在 ai-browser 或 browser-view.service 中扩展）
interface BrowserControlAPI {
  // 导航控制
  navigateBack(): Promise<void>
  navigateForward(): Promise<void>
  reload(): Promise<void>
  navigateTo(url: string): Promise<void>

  // 状态查询
  getBrowserState(): Promise<BrowserViewState>

  // 事件监听
  onBrowserStateChange(callback: (state: BrowserViewState) => void): void
}
```

---

## 4. UI 设计

### 4.1 面板布局

```
┌─────────────────────────────┐
│  Browser          ✕        │  <- Header (关闭按钮)
├─────────────────────────────┤
│  ┌─────────────────────┐   │
│  │  ←  →  ↻  +  🔗    │   │  <- 导航栏 (48px 高)
│  └─────────────────────┘   │
├─────────────────────────────┤
│                             │
│     [页面预览区域]           │  <- 预览内容 (flex-1)
│                             │
│                             │
└─────────────────────────────┘
```

### 4.2 导航栏按钮

| 按钮 | 功能 | 图标 |
|------|------|------|
| 后退 | browser_navigate back | ← |
| 前进 | browser_navigate forward | → |
| 刷新 | browser_navigate reload | ↻ |
| 新标签 | browser_new_page | + |
| 地址栏 | 显示 URL，可编辑 | 🔗 |

### 4.3 视觉样式

- **背景色:** 与 SpaceStudio 主背景一致 (`bg-background`)
- **边框:** 左侧边框 (`border-l border-border`)
- **过渡动画:** 300ms ease-in-out 滑入滑出

---

## 5. 实现步骤

### Phase 1: 基础框架

1. 创建 `BrowserPanel` 组件
2. 添加 Zustand store
3. 在 SpacePage 中集成面板

### Phase 2: 导航功能

1. 扩展 BrowserView Service 添加 IPC 处理
2. 实现导航按钮功能
3. 同步浏览器状态到前端

### Phase 3: 预览功能

1. 实现页面内容预览
2. 实时更新预览内容
3. 优化性能和用户体验

---

## 6. 关键文件变更

### 新增文件

- `src/renderer/components/browser-panel/index.tsx`
- `src/renderer/components/browser-panel/BrowserPanel.tsx`
- `src/renderer/components/browser-panel/NavigationBar.tsx`
- `src/renderer/components/browser-panel/types.ts`
- `src/renderer/stores/browser-panel.store.ts`

### 修改文件

- `src/renderer/pages/SpacePage.tsx` - 添加面板组件
- `src/main/ipc/browser.ts` - 添加 IPC 处理
- `src/main/services/browser-view.service.ts` - 状态管理

---

## 7. 测试计划

- [ ] 面板打开/收起动画正常
- [ ] 导航按钮功能正常
- [ ] 浏览器状态同步正确
- [ ] 多标签页面板切换正确

---

## 8. 风险与注意事项

1. **性能:** 页面预览需要考虑性能优化，避免频繁渲染
2. **安全:** 使用 Electron 的 BrowserView 需要注意安全隔离
3. **兼容性:** 需要适配不同的窗口大小
