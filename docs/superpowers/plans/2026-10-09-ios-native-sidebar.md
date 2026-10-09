# iOS 原生边栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 iOS 会话边栏的阅读、搜索、筛选、分组与管理改成原生交互，沿用已验收的 ChatGPT 黑白灰视觉规范。

**Architecture:** React 继续管理设备、全文搜索、项目分页、折叠持久化与会话管理；通过独立的 nativeSidebar version=1 快照投影到 UIKit。原生边栏与原生对话共用 WK 容器的 sibling 结构，由同一个桥协调可见性及 VoiceOver 隐藏状态。

**Tech Stack:** React/TypeScript、UIKit UITableView/UISearchTextField/UIRefreshControl/UIContextMenuInteraction、Swift Foundation 状态测试、Vitest、XCTest。

## 任务 1：状态契约与 React 投影

文件：新增 `src/features/threads/native-sidebar.ts`、`useNativeSidebar.ts`、`tests/ui/native-sidebar.test.tsx`；修改 `ThreadListPage.tsx`、`src/App.tsx`。

- [x] 写失败测试，验证已置顶/未读排序、跨设备身份、项目折叠与分页状态、搜索摘要。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/native-sidebar.test.tsx`，保留预期失败证据。
- [x] 实现 nativeSidebar 独立 channel，contextId+sequence 拒绝重复/旧事件，只有当前可见且有效的会话/设备/项目可操作。
- [x] 原生重命名传入 name，继续使用现有管理回调；后台设备不发布界面，离线禁用写操作，业务失败保留错误。
- [x] 再执行上述测试，验证搜索输入不被旧快照覆盖、边栏关闭清空搜索、对话草稿不丢失。

契约：`NativeSidebarSnapshot` 含 version/contextId/visible/acknowledgedSequence/locale/query/title/subtitle/selectedBackendId/backends/sections/loadState/searching/refreshing/error/pendingKey/pendingAction/strings；section 含 id/title/backendId/cwd/collapsible/expanded/loading/error/more/rows；row 含 id/threadId/title/source/time/pinned/unread/running/opening/readOnly。动作含 contextId/sequence/type/id?/text?，type 为 query/close/new/refresh/devices/backend/project-collapse/project-more/project-retry/open/pin/refresh-thread/duplicate/rename/archive/copy。

## 任务 2：UIKit 边栏

文件：新增 `mobile/ios/NativeSidebarState.swift`、`NativeSidebarStateTests.swift`、`NativeSidebarViewController.swift`；修改 `NativeConversationBridge.swift`、`.github/workflows/build-ios.yml`、`tests/ci/ios-local-build.test.ts`。

- [x] 先写 Foundation 测试：本地搜索未 ack 时不被旧值覆盖、context 切换清理、hide 不接受错 context、重复行拒绝。
- [x] 执行 `swiftc -D NATIVE_SIDEBAR_STATE_TESTS mobile/ios/NativeSidebarState.swift mobile/ios/NativeSidebarStateTests.swift -o /tmp/codex-native-sidebar-state && /tmp/codex-native-sidebar-state`，先红后绿。
- [x] UIKit 实现：固定顶部标题/刷新/设备菜单，原生搜索框和新聊天，自动高度列表、44pt 目标、项目展开、更多/重试、正在搜索/空态/失败、未读/执行状态。
- [x] 原生上下文菜单及 VoiceOver 操作保留 pin/refresh/duplicate/rename/archive/copy；重命名用 UIAlertController；搜索与滑动不触发误开会话。
- [x] 抽屉宽度手机留至少 44pt scrim、iPad 不超过 420pt；自适应 Dynamic Type、安全区、键盘；Reduce Motion 不做几何动画。
- [x] 共用桥让原生层可见性与 WK accessibility 状态一致；原生 dismiss 手势和 scrim 回写 React，不直接改业务状态。

## 任务 3：构建与真实 UI 验收

文件：新增 `mobile/ios/NativeSidebarUITests.swift`；更新 `scripts/configure-ios-tests.rb` 及现有 NativeConversationUITests 的边栏定位；原始截图及日志保存在主工作区忽略目录 `.mobile-build/ios-native-sidebar-audit/`，避免把真实会话列表发布到仓库。

- [x] XCTest 先验证原生 sidebar 标识、搜索框、设备菜单、会话打开/返回、新聊天草稿、长按菜单、项目折叠及搜索清除。
- [x] `npm run ios:prepare -- --version <candidate>` 后配置 UI tests，在独占模拟器锁下构建执行。
- [x] 验收普通手机、375pt 小屏、深色、系统最大字号、iPad；查看实际截图，确认标题/列表/搜索/底部动作可读可用。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test`、`npm run build`、`python3 -m unittest discover -s tests/ci -p '*ios*.py'`；Swift Markdown/Conversation/Sidebar 状态回归。
- [x] 独立规范审查，再质量审查，解决所有影响交付的问题。

## 任务 4：提交与固定渠道交付

- [x] 阅读 `docs/commit-conventions.md`，按中文 Conventional Commits 提交；接入最新 main 并推送。
- [x] 独占发布锁下读取两个现有固定清单，选择统一更高版本；构建 APK、通过本机私有配置构建并签署 IPA。
- [x] 发布固定 LAN 双端渠道及 HTTPS OTA；逐一用清单、HEAD、完整 GET 验证版本、字节数、SHA-256；保留本机签名报告。
- [x] 确认没有新增服务端测试会话、保存必要构建证据并清除临时文件；尝试平台归档 worktree，因置顶任务或工作区保护而保留；文档记录实际结果后提交推送。
- [x] 最终交付同时展示 OTA 安装页、APK/IPA 下载链接、统一版本、两份大小和 SHA-256，以及 IPA 签名状态。

## 实际验收记录

- React 投影、Foundation 搜索 ack/IME、构建注入与异步管理异常均先记录失败，再修复为通过。
- 普通手机：原生边栏搜索、关闭清除、草稿保留、设备菜单、项目折叠、长按菜单、原生重命名取消与左滑关闭通过；原生对话键盘和返回回归通过。
- 375pt 小屏：默认与深色截图逐张查看；辅助字号曾只留下 67pt 列表空间，新增断言后先失败，收起品牌与统计后列表空间及首行可点击验收通过。
- iPad：搜索、关闭与草稿恢复通过；实际截图发现后方旧 Web 边栏露出，补齐原生/Web 可见性切换后复测，确认仅一份列表。
- 断网搜索：停止本任务网关后专门执行测试，键盘上方错误与重试可见，输入保留，错误不误显示为无结果。
- 桥异常恢复：发送失败后回退网页，再 ready 时重发相同快照；回归先失败后通过。
- Python iOS 87 项、Swift Markdown 37 项及 Conversation/Sidebar 状态回归通过；前端构建通过。最终 Vitest 93 个文件、843 项通过；发布信息在固定渠道校验后补齐。
- 独立规范及质量审查已完成，影响交付的问题均已修复并复核通过。
- 本次未向真实会话发送消息；复制会话 ID、重命名取消、项目折叠恢复等验收未改变真实会话内容，无新增服务端测试会话需要归档。
- 模拟器与构建验签不能证明真机覆盖安装和数据保留；本次没有宣称真机验收。


交付版本为 `0.2.133`，源提交 `a41d76b`。双端与 HTTPS OTA 的版本、HEAD 和完整 GET 校验通过，APK/IPA 与本机产物 SHA-256 一致，IPA Ad Hoc 已签名。大小、散列与入口见 [模拟器验证文档](../../ios-simulator-verification.md)。产物和报告保存在主工作区 `.mobile-build/ios-native-sidebar-audit/release/0.2.133/`。

平台归档返回 `This worktree is protected by a pinned task or workspace.`，工作树保留为 `feat/ios-native-sidebar`；本次构建缓存、临时文件、网关和模拟器占用已经清理，必要证据保存在长期主工作区。
