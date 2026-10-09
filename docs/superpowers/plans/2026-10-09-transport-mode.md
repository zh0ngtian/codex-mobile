# 客户端 HTTP / 流式传输切换实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐项执行；按 test-driven-development 与 verification-before-completion 验证。用户已授权实现、提交推送及固定渠道交付。

**Goal:** 管理设备页增加统一传输方式选择，默认 HTTP，可切换 WebSocket 流式，并记住选择。

**Architecture:** 使用本机 localStorage 保存 `codex-mobile:transport-mode`，仅接受 `http` / `stream`。AppBootstrap 持有选择，传给设置页和所有设备工作区；设备连接签名包含传输方式，变化时重建连接、恢复当前会话。HTTP 保持现有轮询与去重，流式复用 `/ws` 和现有 JSON-RPC 增量处理。设备测试使用所选传输。

**Tech Stack:** React、TypeScript、Vitest、Playwright、现有 Android 构建与固定 APK 渠道。

## 任务 1：先验证需求缺失

文件：`tests/ui/app-bootstrap.test.tsx`、`tests/ui/backend-connection-manager.test.ts`、`tests/ui/backend-probe.test.ts`。

- [x] 测试管理设备默认 HTTP、选择流式后写入 localStorage、冷启动恢复与非法值回退。
- [x] 测试默认真实连接为 HttpRpcTransport、流式连接使用带 token 的 `/ws`，切换关闭旧连接并忽略迟到通知。
- [x] 测试流式设备探测不依赖 httpPolling、连接失败与超时仍报错。
- [x] 运行 `npx vitest run tests/ui/app-bootstrap.test.tsx tests/ui/backend-connection-manager.test.ts tests/ui/backend-probe.test.ts`，确认新增行为测试失败。

## 任务 2：实现并回归

文件：新增 `src/backends/transport-preference.ts`；修改 `src/backends/types.ts`、`src/backends/connection-manager.ts`、`src/backends/probe.ts`、`src/App.tsx`、`src/features/backends/BackendManagerSheet.tsx`、`src/i18n.tsx`、`README.md`。

- [x] 定义 `TransportMode = "http" | "stream"` 与存储读写；读取失败默认 HTTP，写入失败仍保留当前内存选择。
- [x] AppBootstrap 使用 `useState(() => readTransportMode(window.localStorage))`，选择时保存并更新 state；工作区接收临时 `transportMode` 配置并在 effect 依赖中包含它。
- [x] 连接工厂按 `backend.transportMode === "stream" ? new WebSocket(url) : new HttpRpcTransport(backend)` 创建连接；签名归一化缺省值为 HTTP。
- [x] 管理设备加入互斥按钮 `HTTP` / `流式`，使用 `aria-pressed` 标记当前选择；说明切换自动重连。
- [x] 探测按选择初始化，流式沿用带 token 的 `/ws`，finally 关闭探测连接；HTTP 才要求 httpPolling。
- [x] 更新中英文文案和 README；运行聚焦测试、`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests --exclude '**/.mobile-build/**'`、`npm run build:package`、`git diff --check`。
- [x] Playwright 验证默认 HTTP、切换后真正走 WebSocket，连续 delta 更新、完成、刷新后保持流式、切回 HTTP 恢复当前会话。

## 任务 3：交付

- [ ] 阅读提交规范，暂存检查，提交中文 Conventional Commit 并推送。
- [ ] 推送后读取固定渠道版本，构建更高版本 APK，沿用现有签名。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>` 发布。
- [ ] 比对固定 JSON、HEAD、完整 GET 的版本、大小及 SHA-256；清理本次临时文件，交付固定 APK 地址和摘要。

## 验证结果

- 新增默认值、保存、切换连接和流式探测测试先观察到 4 个预期失败，再实现转绿。
- 83 个测试文件、683 项测试通过；禁用 Node 26 实验性 Web Storage，并排除其他任务在 `.mobile-build` 中复制的测试源码。
- `npm run build:package` 与类型检查通过。
- Playwright 通过真实浏览器 WebSocket API 验证 HTTP 默认、切换、连续增量、运行中刷新续接、完成、冷启动偏好与切回 HTTP；截图确认两项选择布局正确。
- 运行中刷新曾丢失回复前缀，已在增量缓冲中复用当前快照，并在重连恢复后更新缓冲；回归通过。
- 提交后的 APK 发布与固定渠道核验记录保存在 `.mobile-build/transport-release/delivery.json`，交付回复报告最终版本。
