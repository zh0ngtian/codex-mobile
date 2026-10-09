# iOS 原生对话交互实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 执行独立任务，遵循 superpowers:test-driven-development；规格审查后进行质量审查。

**Goal:** 将 iOS 对话的消息列表、输入框、键盘布局和消息详情交互原生化，并保持现有会话、弱网、附件和跨端行为。

**Architecture:** React 继续拥有 app-server 会话、草稿、审批与写操作状态，通过版本化快照投影到 UIKit 原生对话控制器。原生只发送带上下文与序列号的交互事件，不建立第二套网络连接。主导航、设置与复杂图表/远程内容继续复用已有界面，保留完整内容入口；核心文本、消息详情、输入、附件菜单、会话菜单采用原生交互。

**Tech Stack:** TypeScript / React / Swift / UIKit / WKWebView / Vitest / XCTest / 现有签名和 OTA 发布脚本。

---

## 桥接契约

- Web handler: `window.webkit.messageHandlers.nativeConversation`。
- 安装标记：`window.__codexNativeConversationReady = true`，派发 `codex-mobile-native-conversation-ready`。
- Web → Native：`{ type: "snapshot", snapshot }`，或 `{ type: "hide", contextId }`。
- Native → Web：`codex-mobile-native-conversation-action`，detail 为 `{ contextId, sequence, type, text?, id?, cursor? }`；sequence 在原生控制器生命周期内单调递增。
- snapshot: `{ version: 1, locale, isNewChat, contextId, visible, title, subtitle, draft, draftCursor, draftCursorSequence, acknowledgedSequence, enabled, sendEnabled, sendLabel, busy, error, status, loadState, olderTurnsState, fontSize, rows, attachments, mentions, projects, backends, selectedProject, selectedBackendId, settingsLabel, queued }`。
- rows: `{ id, role: "user" | "assistant" | "tool" | "system", text, detail?, turnId?, messageId?, timestamp?, rich? }`；稳定 ID 使用真实 turn/item ID，缺失时使用其稳定位置。
- attachments: `{ id, name, kind: "image" | "file", url? }`；mentions: `{ id, label, description }`；projects/backends: `{ id, label }`；queued: `{ id, text, failed }`。
- actions: `draft`, `submit`, `interrupt`, `back`, `retry`, `loadOlder`, `web`, `agentSettings`, `permissionSettings`, `photos`, `files`, `location`, `removeAttachment`, `mention`, `project`, `backend`, `pin`, `duplicate`, `rename`, `archive`, `edit`, `queuedAction`, `queuedCancel`。
- 只接收本地入口主 frame，序列与 contextId 必须匹配；切换会话后旧 action 不得执行。
- 原生未确认的本地输入不能被旧快照覆盖；中文 marked text 不得被回写；提交等待 React 草稿完成后才调用现有 send。

### 任务 1：原生界面和交互状态

**Files:** 创建 `mobile/ios/NativeConversationBridge.swift`、`mobile/ios/NativeConversationViewController.swift`、`mobile/ios/NativeConversationState.swift`；测试 `mobile/ios/NativeConversationStateTests.swift`、`mobile/ios/NativeConversationUITests.swift`。

- [x] 先写草稿确认、旧快照、会话切换、翻历史与自动跟随策略回归；使用 `swiftc -D NATIVE_CONVERSATION_STATE_TESTS NativeConversationState.swift NativeConversationStateTests.swift -o <临时测试文件>` 编译执行，观察功能缺失导致失败。
- [x] 实现纯 Foundation 状态策略及 UIKit 控制器：消息复用、稳定锚点、交互收键盘、选择复制、工具详情 Sheet、附件/会话菜单、原生 UITextView 和键盘布局。
- [x] 输入确认示例：`acknowledgedSequence < lastDraftSequence` 时保留原生草稿；`markedTextRange != nil` 时不回写文本。
- [x] 使用 `view.keyboardLayoutGuide.topAnchor` 约束输入区底部；输入框以内容高度增长到上限，保留 Done 工具栏、焦点与光标。
- [x] 消息更新前记录首个可见行 ID 与 offset，分页/非跟随更新后恢复；只在接近底部或本次提交时跟随。
- [x] 原生 UI 测试验证输入元素位于 webView 外、连续发送、未发送草稿、键盘收起、回列表再开会话和历史位置。

### 任务 2：快照与现有行为接入

**Files:** 创建 `src/features/conversation/native-conversation.ts`、`src/features/conversation/useNativeConversation.ts`、`tests/ui/native-conversation.test.tsx`；修改 `ConversationPage.tsx`。

- [x] 先写快照投影、旧上下文与重复动作拒绝、submit 草稿同步、不可交互状态和 Web 回退的失败回归。
- [x] 复用已有标题清理、turn 分组和工具摘要函数，投影用户消息、助手回复、工具详情及未识别项；不丢弃未知内容。
- [x] 示例：`dispatch({ contextId: 'device:thread', sequence: 1, type: 'draft', text: '中文草稿' })` 更新现有草稿，旧 context 或重复 sequence 不调用业务回调。
- [x] submit 记录目标文本，React 已提交相同 draft 后再调用 `onSubmit({ preventDefault() {} })`，避免闭包发送旧文本；禁用/审批/断线状态不越权提交。
- [x] 接入附件选择、模型权限、Skill 建议、会话菜单、历史编辑、排队消息；复杂内容可切回完整页面并返回原生。
- [x] 侧栏或现有 Web Sheet 出现时临时隐藏原生层，关闭后恢复；Web 和 Android 无桥接时保持现有行为。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/native-conversation.test.tsx tests/ui/conversation-page-pagination.test.tsx tests/ui/conversation-scroll.test.tsx tests/ui/connection-recovery.test.ts`。

### 任务 3：工程集成与验证

**Files:** 修改 `.github/workflows/build-ios.yml`、`scripts/configure-ios-tests.rb`、`tests/ci/ios-local-build.test.ts`；更新 `docs/ios-simulator-verification.md`、`README.md`。

- [x] 先验证流水线复制原生源文件、配置桥接与测试 target 的断言失败，再集成；生成工程必须包含源文件且重复配置不重复注册。
- [x] `npm run ios:prepare -- --version <测试版本>`，构建成功后在固定模拟器排队执行 XCTest；验证截图和真实网关消息往返。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- --exclude '.mobile-build/**'`、`npm run typecheck`、`npm run build`、相关 Python iOS 测试及 `git diff --check`。
- [x] 完成独立规格审查、质量审查，修复发现的问题后再交付。

### 任务 4：提交与双端发布

- [ ] 阅读 `docs/commit-conventions.md`，中文 Conventional Commit 正文准确列出功能与改动，提交推送并集成主分支。
- [ ] 固定渠道发布排队，读取 Android/iOS/OTA 现有版本，分配统一更高版本；从推送后的源码构建 APK 与签名 IPA。
- [ ] `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes 'iOS 原生对话交互'`。
- [ ] Android 使用固定流水线或本机相同步骤构建，再通过 `apk-server.py publish-channel` 发布。
- [ ] 固定 JSON、HEAD、完整 GET 核对两端版本、字节数及 SHA-256；保留签名身份连续性。
- [ ] 归档测试会话，停止测试网关，清除临时产物并归档 worktree；回复固定 APK/IPA 下载链接与元数据。真机覆盖安装保留数据不能由模拟器测试替代。


## 验证证据

- XCTest 4 项全绿（真实网关回复 NATIVE_IOS_OK），UIKit wrapper 修复前可点击断言失败，修复后全部通过。
- Vitest 823 项，Python iOS 87 项，Foundation 草稿/IME/光标/菜单/中英回归、TypeScript 和前端构建通过。
- 独立规格与代码质量审查 Approved；多设备所有权、隐藏弹框和原生详情遮挡问题已修复。
