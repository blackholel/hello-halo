# Monaco Editor CSP 阻止加载问题

---
title: Monaco Editor 在 Electron 应用中因 CSP 限制无法加载
category: integration-issues
severity: medium
tags:
  - electron
  - monaco-editor
  - csp
  - security
  - cdn
  - local-loading
affected_components:
  - src/renderer/components/canvas/viewers/CodeEditor.tsx
  - src/renderer/index.html
date_resolved: 2025-01-22
---

## 问题症状

在 Electron 应用中集成 Monaco Editor 后，打开代码文件时编辑器无法加载，控制台报错：

```
Refused to load the script 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js'
because it violates the following Content Security Policy directive:
"script-src 'self' 'unsafe-inline' https://hm.baidu.com"
```

## 根本原因

`@monaco-editor/react` 默认从 CDN (`cdn.jsdelivr.net`) 动态加载 Monaco Editor 的核心脚本。但应用的 Content Security Policy (CSP) 配置只允许从以下来源加载脚本：

- `'self'` - 同源脚本
- `'unsafe-inline'` - 内联脚本
- `https://hm.baidu.com` - 百度统计

CDN 域名 `https://cdn.jsdelivr.net` 不在允许列表中，因此被浏览器拦截。

### CSP 配置位置

`src/renderer/index.html`:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'unsafe-inline' https://hm.baidu.com; ..."
/>
```

## 解决方案

配置 `@monaco-editor/react` 的 loader 使用本地 `node_modules` 中的 `monaco-editor` 包，而不是从 CDN 加载。

### 实现代码

`src/renderer/components/canvas/viewers/CodeEditor.tsx`:

```typescript
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure Monaco to use local files instead of CDN (CSP blocks CDN)
loader.config({ monaco })
```

### 关键点

1. **必须安装两个包**：
   ```bash
   npm install @monaco-editor/react monaco-editor
   ```

2. **loader.config() 必须在组件外部调用**，确保在 Monaco Editor 初始化之前执行

3. **本地加载会增加 bundle 大小**，但这是在严格 CSP 环境下的必要权衡

## 替代方案（不推荐）

### 方案 B：修改 CSP 允许 CDN

```html
<meta
  http-equiv="Content-Security-Policy"
  content="script-src 'self' 'unsafe-inline' https://hm.baidu.com https://cdn.jsdelivr.net; ..."
/>
```

**不推荐原因**：
- 降低安全性，允许从外部 CDN 加载脚本
- 依赖外部网络，离线时无法使用
- CDN 可能被墙或不稳定

## 预防策略

1. **集成第三方库前检查其资源加载方式**
   - 查看库的文档，了解是否有本地加载选项
   - 检查是否依赖 CDN 或外部资源

2. **在 Electron 应用中优先使用本地资源**
   - 避免运行时从 CDN 加载脚本
   - 将所有依赖打包到应用中

3. **测试 CSP 兼容性**
   - 在开发环境中启用严格 CSP
   - 检查控制台是否有 CSP 违规警告

## 相关资源

- [@monaco-editor/react 文档 - 使用本地 Monaco](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package)
- [Electron 安全最佳实践 - CSP](https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy)
- [MDN - Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

## 经验教训

1. Electron 应用中使用第三方编辑器库时，需注意其默认的资源加载方式
2. CSP 策略会阻止从未授权域名加载脚本，需要将依赖本地化或修改 CSP
3. `@monaco-editor/react` 提供了 `loader.config()` API 来配置本地加载，这是官方推荐的方式
