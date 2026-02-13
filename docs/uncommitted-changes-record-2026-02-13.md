# 未提交代码变更记录（全量）

- 记录时间: 2026-02-13 10:00:19 +0800
- 工作目录: /Users/dl/ProjectSpace/ownerAgent/hello-halo/worktrees/kite
- 记录范围: 当前所有未提交变更（staged/unstaged/untracked）

## 1. 总体统计

### 1.1 diff 总览
```text
 147 files changed, 1427 insertions(+), 1337 deletions(-)
```

### 1.2 按顶层目录聚合（文件数 / 新增 / 删除）
```text
(root)                     10         93         77
TopDir                  Files Insertions  Deletions
docs                       10        253        157
patches                     1          1          1
resources                   1          6          6
scripts                     2         13         13
src                       106        784        863
tests                      13        267        210
todos                       4         10         10
```

## 2. 文件级清单

### 2.1 当前状态（git status --short）
```text
 M .env.example
 M .gitignore
 M CLAUDE.md
 M CONTRIBUTING.md
 M README.md
 M dji.base
 M docs/README.de.md
 M docs/README.es.md
 M docs/README.fr.md
 M docs/README.ja.md
 M docs/README.zh-CN.md
 M docs/README.zh-TW.md
 M docs/plans/2026-02-08-space-toolkit-whitelist-implementation-summary.md
 M docs/sdk-patch-guide.md
 M docs/skill-card-timeline-rendering.md
 M docs/solutions/integration-issues/skills-loading-v2-session.md
 M electron.vite.config.ts
 M package-lock.json
 M package.json
 M patches/@anthropic-ai+claude-agent-sdk+0.2.22.patch
 M resources/README.txt
 M scripts/generate-icons.sh
 M scripts/translate-i18n.mjs
 M src/main/bootstrap/index.ts
 M src/main/controllers/space.controller.ts
 M src/main/http/routes/index.ts
 M src/main/http/server.ts
 M src/main/index.ts
 M src/main/ipc/space.ts
 M src/main/openai-compat-router/__tests__/server.test.ts
 M src/main/openai-compat-router/server/api-type.ts
 M src/main/services/agent/electron-path.ts
 M src/main/services/agent/message-parser.ts
 M src/main/services/agent/provider-resolver.ts
 M src/main/services/agent/sdk-config.builder.ts
 M src/main/services/agents.service.ts
 M src/main/services/ai-browser/index.ts
 M src/main/services/analytics/analytics.service.ts
 M src/main/services/artifact.service.ts
 M src/main/services/browser-view.service.ts
 M src/main/services/change-set.service.ts
 M src/main/services/commands.service.ts
 M src/main/services/config.service.ts
 M src/main/services/conversation.service.ts
 M src/main/services/git-bash.service.ts
 M src/main/services/hooks.service.ts
 M src/main/services/mock-bash.service.ts
 M src/main/services/onboarding.service.ts
 M src/main/services/perf/README.md
 M src/main/services/perf/index.ts
 M src/main/services/perf/perf.service.ts
 M src/main/services/plugins.service.ts
 M src/main/services/preset.service.ts
 M src/main/services/protocol.service.ts
 M src/main/services/python.service.ts
 M src/main/services/search.service.ts
 M src/main/services/skills-agents-watch.service.ts
 M src/main/services/skills.service.ts
 M src/main/services/space-config.service.ts
 M src/main/services/space.service.ts
 M src/main/services/tray.service.ts
 M src/main/services/updater.service.ts
 M src/main/services/workflow.service.ts
 M src/main/utils/instance.ts
 M src/preload/index.ts
 M src/renderer/App.tsx
 M src/renderer/api/index.ts
 M src/renderer/api/transport.ts
 M src/renderer/assets/styles/globals.css
 M src/renderer/components/agents/AgentsPanel.tsx
 M src/renderer/components/artifact/ArtifactRail.tsx
 M src/renderer/components/artifact/ArtifactTree.tsx
 D src/renderer/components/brand/HaloLogo.tsx
 M src/renderer/components/canvas/ContentCanvas.tsx
 M src/renderer/components/canvas/viewers/BrowserViewer.tsx
 M src/renderer/components/canvas/viewers/ImageViewer.tsx
 M src/renderer/components/chat/ChatView.tsx
 M src/renderer/components/chat/InputArea.tsx
 M src/renderer/components/chat/MessageItem.tsx
 M src/renderer/components/chat/MessageList.tsx
 M src/renderer/components/chat/PlanCard.tsx
 M src/renderer/components/chat/SubAgentCard.tsx
 M src/renderer/components/chat/ThoughtProcess.tsx
 M src/renderer/components/commands/CommandsDropdown.tsx
 M src/renderer/components/commands/CommandsPanel.tsx
 M src/renderer/components/diff/DiffContent.tsx
 M src/renderer/components/diff/DiffModal.tsx
 M src/renderer/components/icons/ToolIcons.tsx
 M src/renderer/components/layout/ChatCapsule.tsx
 M src/renderer/components/onboarding/OnboardingOverlay.tsx
 M src/renderer/components/onboarding/onboardingData.ts
 M src/renderer/components/search/SearchPanel.tsx
 M src/renderer/components/setup/ApiSetup.tsx
 M src/renderer/components/setup/GitBashSetup.tsx
 M src/renderer/components/space/SpaceGuide.tsx
 M src/renderer/components/splash/SplashScreen.tsx
 M src/renderer/components/tool/TodoCard.tsx
 M src/renderer/components/tool/ToolCard.tsx
 M src/renderer/components/updater/UpdateNotification.tsx
 M src/renderer/components/workflows/WorkflowEditorModal.tsx
 M src/renderer/hooks/useSearchShortcuts.ts
 M src/renderer/i18n/index.ts
 M src/renderer/i18n/locales/de.json
 M src/renderer/i18n/locales/en.json
 M src/renderer/i18n/locales/es.json
 M src/renderer/i18n/locales/fr.json
 M src/renderer/i18n/locales/ja.json
 M src/renderer/i18n/locales/zh-CN.json
 M src/renderer/i18n/locales/zh-TW.json
 M src/renderer/index.html
 M src/renderer/lib/perf-collector.ts
 M src/renderer/main.tsx
 M src/renderer/overlay-main.tsx
 M src/renderer/overlay.html
 M src/renderer/overlay/ChatCapsuleOverlay.tsx
 M src/renderer/pages/HomePage.tsx
 M src/renderer/pages/SettingsPage.tsx
 M src/renderer/pages/SpacePage.tsx
 M src/renderer/services/canvas-lifecycle.ts
 M src/renderer/stores/agents.store.ts
 M src/renderer/stores/ai-browser.store.ts
 M src/renderer/stores/app.store.ts
 M src/renderer/stores/commands.store.ts
 M src/renderer/stores/onboarding.store.ts
 M src/renderer/stores/python.store.ts
 M src/renderer/stores/skills.store.ts
 M src/renderer/stores/space.store.ts
 M src/renderer/types/index.ts
 M src/shared/types/claude-code.ts
 M tailwind.config.cjs
 M tests/README.md
 M tests/e2e/fixtures/electron.ts
 M tests/e2e/specs/chat.spec.ts
 M tests/e2e/specs/smoke.spec.ts
 M tests/playwright.config.ts
 M tests/unit/services/agent.service.test.ts
 M tests/unit/services/config.test.ts
 M tests/unit/services/hooks.service.test.ts
 M tests/unit/services/plugins.service.test.ts
 M tests/unit/services/space.test.ts
 M tests/unit/setup.ts
 M tests/unit/utils/instance.test.ts
 M tests/vitest.config.ts
 M todos/001-complete-p1-excessive-console-logs.md
 M todos/004-complete-p2-symlink-attack-risk.md
 M todos/007-complete-p2-missing-error-handling.md
 M todos/009-complete-p3-skills-path-inconsistency.md
?? docs/uncommitted-changes-record-2026-02-13.md
?? src/renderer/components/brand/KiteLogo.tsx
```

### 2.2 逐文件增删行（git diff --numstat）
```text
7	7	.env.example
1	1	.gitignore
18	18	CLAUDE.md
3	3	CONTRIBUTING.md
38	22	README.md
9	9	dji.base
38	22	docs/README.de.md
38	22	docs/README.es.md
38	22	docs/README.fr.md
38	22	docs/README.ja.md
39	23	docs/README.zh-CN.md
39	23	docs/README.zh-TW.md
1	1	docs/plans/2026-02-08-space-toolkit-whitelist-implementation-summary.md
1	1	docs/sdk-patch-guide.md
1	1	docs/skill-card-timeline-rendering.md
20	20	docs/solutions/integration-issues/skills-loading-v2-session.md
3	3	electron.vite.config.ts
2	2	package-lock.json
7	7	package.json
1	1	patches/@anthropic-ai+claude-agent-sdk+0.2.22.patch
6	6	resources/README.txt
2	2	scripts/generate-icons.sh
11	11	scripts/translate-i18n.mjs
1	1	src/main/bootstrap/index.ts
4	4	src/main/controllers/space.controller.ts
4	4	src/main/http/routes/index.ts
9	9	src/main/http/server.ts
4	4	src/main/index.ts
4	4	src/main/ipc/space.ts
5	5	src/main/openai-compat-router/__tests__/server.test.ts
1	1	src/main/openai-compat-router/server/api-type.ts
1	1	src/main/services/agent/electron-path.ts
3	3	src/main/services/agent/message-parser.ts
1	1	src/main/services/agent/provider-resolver.ts
11	11	src/main/services/agent/sdk-config.builder.ts
6	6	src/main/services/agents.service.ts
2	2	src/main/services/ai-browser/index.ts
6	6	src/main/services/analytics/analytics.service.ts
1	1	src/main/services/artifact.service.ts
1	1	src/main/services/browser-view.service.ts
1	1	src/main/services/change-set.service.ts
5	5	src/main/services/commands.service.ts
15	15	src/main/services/config.service.ts
1	1	src/main/services/conversation.service.ts
2	2	src/main/services/git-bash.service.ts
14	14	src/main/services/hooks.service.ts
2	2	src/main/services/mock-bash.service.ts
2	2	src/main/services/onboarding.service.ts
6	6	src/main/services/perf/README.md
1	1	src/main/services/perf/index.ts
1	1	src/main/services/perf/perf.service.ts
13	13	src/main/services/plugins.service.ts
3	3	src/main/services/preset.service.ts
7	7	src/main/services/protocol.service.ts
1	1	src/main/services/python.service.ts
13	13	src/main/services/search.service.ts
4	4	src/main/services/skills-agents-watch.service.ts
6	6	src/main/services/skills.service.ts
4	4	src/main/services/space-config.service.ts
33	31	src/main/services/space.service.ts
3	3	src/main/services/tray.service.ts
1	1	src/main/services/updater.service.ts
1	1	src/main/services/workflow.service.ts
15	12	src/main/utils/instance.ts
8	8	src/preload/index.ts
6	6	src/renderer/App.tsx
135	135	src/renderer/api/index.ts
9	9	src/renderer/api/transport.ts
35	35	src/renderer/assets/styles/globals.css
1	1	src/renderer/components/agents/AgentsPanel.tsx
2	2	src/renderer/components/artifact/ArtifactRail.tsx
1	1	src/renderer/components/artifact/ArtifactTree.tsx
0	84	src/renderer/components/brand/HaloLogo.tsx
1	1	src/renderer/components/canvas/ContentCanvas.tsx
1	1	src/renderer/components/canvas/viewers/BrowserViewer.tsx
2	2	src/renderer/components/canvas/viewers/ImageViewer.tsx
5	5	src/renderer/components/chat/ChatView.tsx
5	5	src/renderer/components/chat/InputArea.tsx
3	3	src/renderer/components/chat/MessageItem.tsx
1	1	src/renderer/components/chat/MessageList.tsx
9	9	src/renderer/components/chat/PlanCard.tsx
2	2	src/renderer/components/chat/SubAgentCard.tsx
2	2	src/renderer/components/chat/ThoughtProcess.tsx
1	1	src/renderer/components/commands/CommandsDropdown.tsx
3	3	src/renderer/components/commands/CommandsPanel.tsx
1	1	src/renderer/components/diff/DiffContent.tsx
3	3	src/renderer/components/diff/DiffModal.tsx
1	1	src/renderer/components/icons/ToolIcons.tsx
2	2	src/renderer/components/layout/ChatCapsule.tsx
6	6	src/renderer/components/onboarding/OnboardingOverlay.tsx
16	16	src/renderer/components/onboarding/onboardingData.ts
3	3	src/renderer/components/search/SearchPanel.tsx
1	1	src/renderer/components/setup/ApiSetup.tsx
4	4	src/renderer/components/setup/GitBashSetup.tsx
5	5	src/renderer/components/space/SpaceGuide.tsx
4	4	src/renderer/components/splash/SplashScreen.tsx
1	1	src/renderer/components/tool/TodoCard.tsx
3	3	src/renderer/components/tool/ToolCard.tsx
5	5	src/renderer/components/updater/UpdateNotification.tsx
4	4	src/renderer/components/workflows/WorkflowEditorModal.tsx
1	1	src/renderer/hooks/useSearchShortcuts.ts
2	2	src/renderer/i18n/index.ts
25	25	src/renderer/i18n/locales/de.json
25	25	src/renderer/i18n/locales/en.json
25	25	src/renderer/i18n/locales/es.json
25	25	src/renderer/i18n/locales/fr.json
25	25	src/renderer/i18n/locales/ja.json
25	25	src/renderer/i18n/locales/zh-CN.json
25	25	src/renderer/i18n/locales/zh-TW.json
3	3	src/renderer/index.html
3	3	src/renderer/lib/perf-collector.ts
1	1	src/renderer/main.tsx
1	1	src/renderer/overlay-main.tsx
2	2	src/renderer/overlay.html
2	2	src/renderer/overlay/ChatCapsuleOverlay.tsx
14	14	src/renderer/pages/HomePage.tsx
12	12	src/renderer/pages/SettingsPage.tsx
4	4	src/renderer/pages/SpacePage.tsx
4	4	src/renderer/services/canvas-lifecycle.ts
1	1	src/renderer/stores/agents.store.ts
1	1	src/renderer/stores/ai-browser.store.ts
5	5	src/renderer/stores/app.store.ts
1	1	src/renderer/stores/commands.store.ts
5	5	src/renderer/stores/onboarding.store.ts
10	10	src/renderer/stores/python.store.ts
1	1	src/renderer/stores/skills.store.ts
17	17	src/renderer/stores/space.store.ts
7	7	src/renderer/types/index.ts
3	3	src/shared/types/claude-code.ts
5	5	tailwind.config.cjs
2	2	tests/README.md
52	34	tests/e2e/fixtures/electron.ts
23	23	tests/e2e/specs/chat.spec.ts
30	18	tests/e2e/specs/smoke.spec.ts
5	5	tests/playwright.config.ts
14	14	tests/unit/services/agent.service.test.ts
10	10	tests/unit/services/config.test.ts
2	2	tests/unit/services/hooks.service.test.ts
29	29	tests/unit/services/plugins.service.test.ts
48	30	tests/unit/services/space.test.ts
16	16	tests/unit/setup.ts
35	26	tests/unit/utils/instance.test.ts
1	1	tests/vitest.config.ts
1	1	todos/001-complete-p1-excessive-console-logs.md
1	1	todos/004-complete-p2-symlink-attack-risk.md
6	6	todos/007-complete-p2-missing-error-handling.md
2	2	todos/009-complete-p3-skills-path-inconsistency.md
```

### 2.3 变更摘要（git diff --stat）
```text
 .env.example                                       |  14 +-
 .gitignore                                         |   2 +-
 CLAUDE.md                                          |  36 +--
 CONTRIBUTING.md                                    |   6 +-
 README.md                                          |  60 +++--
 dji.base                                           |  18 +-
 docs/README.de.md                                  |  60 +++--
 docs/README.es.md                                  |  60 +++--
 docs/README.fr.md                                  |  60 +++--
 docs/README.ja.md                                  |  60 +++--
 docs/README.zh-CN.md                               |  62 +++--
 docs/README.zh-TW.md                               |  62 +++--
 ...ace-toolkit-whitelist-implementation-summary.md |   2 +-
 docs/sdk-patch-guide.md                            |   2 +-
 docs/skill-card-timeline-rendering.md              |   2 +-
 .../skills-loading-v2-session.md                   |  40 +--
 electron.vite.config.ts                            |   6 +-
 package-lock.json                                  |   4 +-
 package.json                                       |  14 +-
 .../@anthropic-ai+claude-agent-sdk+0.2.22.patch    |   2 +-
 resources/README.txt                               |  12 +-
 scripts/generate-icons.sh                          |   4 +-
 scripts/translate-i18n.mjs                         |  22 +-
 src/main/bootstrap/index.ts                        |   2 +-
 src/main/controllers/space.controller.ts           |   8 +-
 src/main/http/routes/index.ts                      |   8 +-
 src/main/http/server.ts                            |  18 +-
 src/main/index.ts                                  |   8 +-
 src/main/ipc/space.ts                              |   8 +-
 .../openai-compat-router/__tests__/server.test.ts  |  10 +-
 src/main/openai-compat-router/server/api-type.ts   |   2 +-
 src/main/services/agent/electron-path.ts           |   2 +-
 src/main/services/agent/message-parser.ts          |   6 +-
 src/main/services/agent/provider-resolver.ts       |   2 +-
 src/main/services/agent/sdk-config.builder.ts      |  22 +-
 src/main/services/agents.service.ts                |  12 +-
 src/main/services/ai-browser/index.ts              |   4 +-
 src/main/services/analytics/analytics.service.ts   |  12 +-
 src/main/services/artifact.service.ts              |   2 +-
 src/main/services/browser-view.service.ts          |   2 +-
 src/main/services/change-set.service.ts            |   2 +-
 src/main/services/commands.service.ts              |  10 +-
 src/main/services/config.service.ts                |  30 +--
 src/main/services/conversation.service.ts          |   2 +-
 src/main/services/git-bash.service.ts              |   4 +-
 src/main/services/hooks.service.ts                 |  28 +--
 src/main/services/mock-bash.service.ts             |   4 +-
 src/main/services/onboarding.service.ts            |   4 +-
 src/main/services/perf/README.md                   |  12 +-
 src/main/services/perf/index.ts                    |   2 +-
 src/main/services/perf/perf.service.ts             |   2 +-
 src/main/services/plugins.service.ts               |  26 +-
 src/main/services/preset.service.ts                |   6 +-
 src/main/services/protocol.service.ts              |  14 +-
 src/main/services/python.service.ts                |   2 +-
 src/main/services/search.service.ts                |  26 +-
 src/main/services/skills-agents-watch.service.ts   |   8 +-
 src/main/services/skills.service.ts                |  12 +-
 src/main/services/space-config.service.ts          |   8 +-
 src/main/services/space.service.ts                 |  64 ++---
 src/main/services/tray.service.ts                  |   6 +-
 src/main/services/updater.service.ts               |   2 +-
 src/main/services/workflow.service.ts              |   2 +-
 src/main/utils/instance.ts                         |  27 ++-
 src/preload/index.ts                               |  16 +-
 src/renderer/App.tsx                               |  12 +-
 src/renderer/api/index.ts                          | 270 ++++++++++-----------
 src/renderer/api/transport.ts                      |  18 +-
 src/renderer/assets/styles/globals.css             |  70 +++---
 src/renderer/components/agents/AgentsPanel.tsx     |   2 +-
 src/renderer/components/artifact/ArtifactRail.tsx  |   4 +-
 src/renderer/components/artifact/ArtifactTree.tsx  |   2 +-
 src/renderer/components/brand/HaloLogo.tsx         |  84 -------
 src/renderer/components/canvas/ContentCanvas.tsx   |   2 +-
 .../components/canvas/viewers/BrowserViewer.tsx    |   2 +-
 .../components/canvas/viewers/ImageViewer.tsx      |   4 +-
 src/renderer/components/chat/ChatView.tsx          |  10 +-
 src/renderer/components/chat/InputArea.tsx         |  10 +-
 src/renderer/components/chat/MessageItem.tsx       |   6 +-
 src/renderer/components/chat/MessageList.tsx       |   2 +-
 src/renderer/components/chat/PlanCard.tsx          |  18 +-
 src/renderer/components/chat/SubAgentCard.tsx      |   4 +-
 src/renderer/components/chat/ThoughtProcess.tsx    |   4 +-
 .../components/commands/CommandsDropdown.tsx       |   2 +-
 src/renderer/components/commands/CommandsPanel.tsx |   6 +-
 src/renderer/components/diff/DiffContent.tsx       |   2 +-
 src/renderer/components/diff/DiffModal.tsx         |   6 +-
 src/renderer/components/icons/ToolIcons.tsx        |   2 +-
 src/renderer/components/layout/ChatCapsule.tsx     |   4 +-
 .../components/onboarding/OnboardingOverlay.tsx    |  12 +-
 .../components/onboarding/onboardingData.ts        |  32 +--
 src/renderer/components/search/SearchPanel.tsx     |   6 +-
 src/renderer/components/setup/ApiSetup.tsx         |   2 +-
 src/renderer/components/setup/GitBashSetup.tsx     |   8 +-
 src/renderer/components/space/SpaceGuide.tsx       |  10 +-
 src/renderer/components/splash/SplashScreen.tsx    |   8 +-
 src/renderer/components/tool/TodoCard.tsx          |   2 +-
 src/renderer/components/tool/ToolCard.tsx          |   6 +-
 .../components/updater/UpdateNotification.tsx      |  10 +-
 .../components/workflows/WorkflowEditorModal.tsx   |   8 +-
 src/renderer/hooks/useSearchShortcuts.ts           |   2 +-
 src/renderer/i18n/index.ts                         |   4 +-
 src/renderer/i18n/locales/de.json                  |  50 ++--
 src/renderer/i18n/locales/en.json                  |  50 ++--
 src/renderer/i18n/locales/es.json                  |  50 ++--
 src/renderer/i18n/locales/fr.json                  |  50 ++--
 src/renderer/i18n/locales/ja.json                  |  50 ++--
 src/renderer/i18n/locales/zh-CN.json               |  50 ++--
 src/renderer/i18n/locales/zh-TW.json               |  50 ++--
 src/renderer/index.html                            |   6 +-
 src/renderer/lib/perf-collector.ts                 |   6 +-
 src/renderer/main.tsx                              |   2 +-
 src/renderer/overlay-main.tsx                      |   2 +-
 src/renderer/overlay.html                          |   4 +-
 src/renderer/overlay/ChatCapsuleOverlay.tsx        |   4 +-
 src/renderer/pages/HomePage.tsx                    |  28 +--
 src/renderer/pages/SettingsPage.tsx                |  24 +-
 src/renderer/pages/SpacePage.tsx                   |   8 +-
 src/renderer/services/canvas-lifecycle.ts          |   8 +-
 src/renderer/stores/agents.store.ts                |   2 +-
 src/renderer/stores/ai-browser.store.ts            |   2 +-
 src/renderer/stores/app.store.ts                   |  10 +-
 src/renderer/stores/commands.store.ts              |   2 +-
 src/renderer/stores/onboarding.store.ts            |  10 +-
 src/renderer/stores/python.store.ts                |  20 +-
 src/renderer/stores/skills.store.ts                |   2 +-
 src/renderer/stores/space.store.ts                 |  34 +--
 src/renderer/types/index.ts                        |  14 +-
 src/shared/types/claude-code.ts                    |   6 +-
 tailwind.config.cjs                                |  10 +-
 tests/README.md                                    |   4 +-
 tests/e2e/fixtures/electron.ts                     |  86 ++++---
 tests/e2e/specs/chat.spec.ts                       |  46 ++--
 tests/e2e/specs/smoke.spec.ts                      |  48 ++--
 tests/playwright.config.ts                         |  10 +-
 tests/unit/services/agent.service.test.ts          |  28 +--
 tests/unit/services/config.test.ts                 |  20 +-
 tests/unit/services/hooks.service.test.ts          |   4 +-
 tests/unit/services/plugins.service.test.ts        |  58 ++---
 tests/unit/services/space.test.ts                  |  78 +++---
 tests/unit/setup.ts                                |  32 +--
 tests/unit/utils/instance.test.ts                  |  61 +++--
 tests/vitest.config.ts                             |   2 +-
 todos/001-complete-p1-excessive-console-logs.md    |   2 +-
 todos/004-complete-p2-symlink-attack-risk.md       |   2 +-
 todos/007-complete-p2-missing-error-handling.md    |  12 +-
 todos/009-complete-p3-skills-path-inconsistency.md |   4 +-
 147 files changed, 1427 insertions(+), 1337 deletions(-)
```

### 2.4 未跟踪文件
```text
docs/uncommitted-changes-record-2026-02-13.md
src/renderer/components/brand/KiteLogo.tsx
```

## 3. 本轮（本次对话）新增改动重点

### 3.1 代码与测试
- src/main/utils/instance.ts
  - 增加策略注释，明确仅支持 ~/.kite，不读取/迁移 ~/.halo。
- src/main/services/space.service.ts
  - 增加策略注释，空间元数据仅识别 .kite/meta.json。
- tests/unit/utils/instance.test.ts
  - 新增负向测试：存在 ~/.halo 时，默认目录仍为 ~/.kite。
- tests/unit/services/space.test.ts
  - 新增负向测试：仅有 .halo/meta.json 的目录不被 listSpaces/getSpace 识别。

### 3.2 文档更新（Breaking Change + 手动迁移说明）
- README.md
- docs/README.de.md
- docs/README.es.md
- docs/README.fr.md
- docs/README.ja.md
- docs/README.zh-CN.md
- docs/README.zh-TW.md

## 4. 验证记录（本轮执行）
```text
$ npm run test:unit
结果: 15 files passed, 273 tests passed.

$ npm run build
结果: build succeeded（存在既有 dynamic import warning，不影响构建成功）。
```

## 5. 说明
- 本文档为当前工作区快照记录；若后续继续修改，本文档不会自动同步。
- 本文档未包含完整 patch 内容（避免文档体积过大）；如需逐行 patch，可使用 git diff 导出。
