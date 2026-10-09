# 非原生界面优化与原生对比实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按已验收的 ChatGPT 黑白灰原则优化 Web 对话页与边栏，在同一 iOS 安装包、同一数据和草稿上切换比较两种体验。

**Architecture:** React 保留全部业务状态，新增独立界面偏好外部 store；两个原生桥根据共同模式显式 hide/恢复快照。界面切换入口位于现有设备管理，不重建 App 或设备连接。Web 对话和边栏分别使用局部样式文件，共享主题 token，系统深浅色自动生效。

**Tech Stack:** React/TypeScript、CSS、UIKit/WKWebView 桥、Vitest、Playwright、XCTest、固定局域网 APK/签名 IPA 发布。

## 1. 同设备切换和主题

文件：新增 `src/ui/interface-mode.ts`、`src/features/settings/InterfaceModeSettings.tsx`、`tests/ui/interface-mode.test.tsx`；修改 `useNativeConversation.ts`、`useNativeSidebar.ts`、`BackendManagerSheet.tsx`、`styles.css` 和 `i18n.tsx`。

- [x] 新增回归：存储偏好、原生默认、不可写存储当前页面可生效；`render(<InterfaceModeSettings />)` 选择网页后两个 native hook 发送 hide，旧 native 动作不得提交，切回 native 必须发送未变化的快照。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/interface-mode.test.tsx tests/ui/native-conversation.test.tsx tests/ui/native-sidebar.test.tsx`，记录 red。
- [x] 使用 `useSyncExternalStore` 共享模式，`interfaceModeStorageKey = "codex-mobile:interface-mode"`，只接受 native/web；捕获存储失败。界面组 `role="group"`、两按钮 `aria-pressed`，仅有原生能力的客户端显示。
- [x] hook 显式守卫模式与可见性，hide 后清空已发送缓存，postMessage 成功后才缓存；保留草稿、历史和设备连接。
- [x] 共享背景/表面/正文/次级/边框/反色/焦点 token；正文 17px，次级文字至少 4.5:1，按系统深浅色，尊重 Reduce Motion；green 后执行前端 build。

## 2. 网页对话页

文件：`ConversationPage.tsx`、`ConversationControls.tsx`、`Timeline.tsx`、新增 `web-conversation.css` 与对应可操作性回归。

- [x] 对照现有 Web 实图，优先验证紧凑顶栏、至少44px操作、空输入有效宽度、短气泡自然宽度、Markdown 仅局部横向表格滚动。
- [x] 重排为单行顶栏、轻量状态、内容优先时间线；模型/权限保留现有弹层入口；设备/项目目标仅在新聊天空态展示，现有会话从菜单查看，保留设备/项目选择。
- [x] 输入单行只保留附件、正文和发送；真实多行提供展开，避免无用按钮挤压文字；用户消息操作保留键盘/触控入口。
- [x] 375px、大屏、深色、特大字号、键盘和错误实图验收；业务回归通过。

## 3. 网页边栏

文件：`ThreadListPage.tsx`、`BackendSwitcher.tsx`、新增 `web-sidebar.css` 与对应行为回归。

- [x] 顶部标题/关闭与设备选择、搜索清晰分层；搜索位于顶部，底部单独新聊天；搜索有label、清除、正在搜索、无结果建议、失败与重试。
- [x] 列表独立滚动，标题两行和次级来源可读；固定控件不覆盖首尾会话，手机留关闭区、iPad 限宽420px。
- [x] 项目展开/分页和管理能力保持；关闭收键盘；仅用SVG图标；长按与滚动不冲突。
- [x] 真实375px与平板、深浅色和大字号截图检查，搜索/关闭/项目与草稿回归通过。

## 4. 集成、验收与交付

- [x] 两项独立实现接入后做规格与质量审查，解决影响交付的问题。
- [x] 全量 Vitest、TypeScript/build；Playwright 验证 Web 几何、对比度、键盘操作和无横向页面溢出；iOS 真模拟器验证原生/Web 来回切换、草稿和边栏。
- [ ] 按 `docs/commit-conventions.md` 提交并推送 main。
- [ ] 独占固定发布锁，读取 Android/iOS/OTA 清单选择统一更高版本；构建 APK 与私有配置 Ad Hoc IPA，发布两个固定渠道和 HTTPS OTA。
- [ ] 清单、HEAD、完整GET、签名与散列全部核对，保存实际截图/产物/日志至主工作区忽略目录；清理本次资源，测试会话及时归档。
- [ ] 文档记录比较入口和验收范围，交付回复提供固定 OTA、APK/IPA 版本、大小、SHA-256及签名状态。
