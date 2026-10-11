# Bark 推送与设置实施计划

> **For agentic workers:** 使用 superpowers:test-driven-development；独立网关任务使用 superpowers:subagent-driven-development，主 Agent 完成客户端和发布集成。

**Goal:** 设置提供系统推送/Bark 推送二选一，保存时校验 Bark 链接，网关在 App 退出后发送最终回复通知，点击进入对应会话。

**Architecture:** 默认保留系统本地通知；Bark 设置以客户端安装 ID 和设备 ID 注册到每个已启用网关。网关保存注册、观察 HTTP/流式实时事件、去重并发送 Bark HTTP POST；流式客户端退出时保留正在运行的上游连接。原生容器注册 `codexmobile://thread`，通过既有完成通知导航传递冷启动目标。

**Tech Stack:** React/TypeScript、Node HTTP/WebSocket、Vitest、SwiftUI/WKWebView、Android Intent、PakePlus 构建流水线。

## 1. 网关与共享契约

文件：`server/notification-settings.ts`、`server/bark-notifications.ts`、`server/gateway.ts`、`server/http-session.ts`、`tests/server/bark-notifications.test.ts`。

- [x] 先写格式、鉴权、去重、完成事件过滤、关闭订阅、持久化和流式退出后完成的失败测试，运行 `npx vitest run tests/server/bark-notifications.test.ts` 确认红灯。
- [x] 共享模块导出 `NotificationPreference = { mode: "system" | "bark"; barkUrl: string }` 和 `parseBarkPushUrl(value: string): string`。仅接受 HTTP(S)、服务器和设备 Key；拒绝账号密码、查询、片段、控制符、错误路径和公共服务保留路径。
- [x] 鉴权 `POST /api/notifications/settings` 接受 `{ clientId, backendId, mode, barkUrl }`，系统方式删除注册，Bark 方式保存规范化链接，响应 `{ saved: true }`；`/api/host` 声明 `barkPush: true`。
- [x] 只观察 `item/completed` 中 `agentMessage` 且 `phase === "final_answer"`，以安装、设备、会话和回合去重。POST JSON `{title, body, group, url, id}`，`url` 使用 `codexmobile://thread?backendId=...&threadId=...`，不包含网关口令。不遍历历史响应补发。
- [x] 设置和发送记录放在 `$CODEX_HOME/codex-mobile-notifications`，权限 0600；发送超时、有限重试、错误不影响 RPC。流式仍运行的会话在手机退出后保留上游，回合完成或有界超时后释放。
- [x] 运行网关测试，分别审查需求覆盖与代码质量。

## 2. 客户端设置与互斥

文件：`src/notifications/preferences.ts`、`src/notifications/PushSettings.tsx`、`src/notifications/run-completion.ts`、`src/features/backends/BackendManagerSheet.tsx`、`src/App.tsx`、`src/i18n`、`src/styles.css`、`tests/ui/push-settings.test.tsx`。

- [x] 先写设置失败测试：默认系统、提示“系统推送会有延迟，并且可能会漏推送”、选择 Bark 显示链接、错误链接保存不生效、正确链接保存与重开保持选择、Bark 不触发本地通知。
- [x] 执行 `npx vitest run tests/ui/push-settings.test.tsx`，确认新增行为失败。
- [x] 使用现有设备设置区域样式增加单选组和 Bark 链接表单，验证失败就地显示错误；有效设置持久保存后同步到设备网关，网络失败显示具体设备并自动重试。
- [x] 通知方式从 localStorage 在通知发送时读取，Bark 下不调用本地原生通知。禁用/删除设备或改回系统时向旧网关注销订阅。
- [x] 添加中文/英文文案，测试 `npx vitest run tests/ui/push-settings.test.tsx tests/ui/backend-components.test.tsx tests/ui/run-completion-notification.test.ts`。

## 3. 会话深链接

文件：`.github/workflows/build-ios.yml`、`.github/workflows/build-android.yml`、`src/notifications/run-completion.ts`、`tests/ui/run-completion-notification.test.ts`、`tests/ci/ios-local-build.test.ts`。

- [x] 测试深链接只接受 `codexmobile://thread` 和非空机器/会话 ID，冷启动待前端就绪后再消费目标。
- [x] iOS 添加 `CFBundleURLTypes`，SwiftUI `.onOpenURL` 缓存目标，WKWebView 完成加载后通过 `codex-mobile-open-thread` 派发；前端仍等连接 online 后打开。
- [x] Android 声明 VIEW intent-filter，读取首次 Intent 和 `onNewIntent` 中链接，复用原生完成导航桥接。
- [ ] 使用本地生成工程验证 iOS Simulator 冷启动、热启动跳转，编译两个原生容器。

## 4. 验证、提交、双端发布

- [x] 更新 README 的通知说明与配置边界；执行 `npm run typecheck`、`npm test`、`npm run build:package`、`git diff --check`。
- [ ] 按 `docs/commit-conventions.md` 提交并推送本次修改，集成到 main；从已推送提交构建。
- [ ] 读取两个固定渠道清单，选择同时更高的统一版本。构建 APK 与未签名 IPA，不将个人证书或 Bark Key 打包。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes '支持 Bark 推送、通知方式设置和会话跳转'` 分别发布。
- [ ] 通过两个固定 JSON、HEAD 和完整 GET 验证版本、文件大小、SHA-256，交付固定 APK/IPA 链接，明确 IPA 签名状态。清理本次无用临时文件。

## 自审

用户要求的二选一、系统提示、Bark 输入和保存校验由任务 2 覆盖；退出后推送由任务 1 覆盖；之前讨论的指定会话跳转由任务 3 覆盖；仓库交付约定由任务 4 覆盖。共享设置类型和注册请求在前后端保持同一契约。

## 验证记录

- 规格和代码质量两轮审查通过；发现的空设备注销重试、流式精简完成事件、Android 加载期间跳转丢失均经失败测试后修复。
- 全量 Vitest：86 文件、729 项通过（Node 26 使用 `NODE_OPTIONS=--no-experimental-webstorage`）；`npm run build:package` 和 diff 检查通过。
- iOS Simulator 设置页 XCTest 通过；使用本地模拟网关验证原生会话冷启动、热启动深链接。未使用用户真实 Bark Key 发送通知。
