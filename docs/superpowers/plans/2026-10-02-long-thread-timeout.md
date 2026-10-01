# 长会话加载超时修复实施计划

> **执行要求：** 按 superpowers 的 systematic-debugging、TDD、verification-before-completion 流程逐项执行。

**目标：** 修复真机打开长会话时的超时/白屏，并交付已验证的 Android APK。

**根因证据：** 会话 `019e9d61-f87e-7951-ab67-925f3970ceea` 的最近 10 个 turn 使用 `itemsView: "full"` 时返回 7,878,849 bytes，其中单个 turn 为 7,326,611 bytes，多个 MCP 工具结果各约 1 MiB；同一分页使用 `itemsView: "summary"` 仅返回 22,755 bytes，并保留每个 turn 的用户消息与助手消息。现有历史请求还共用 10 秒默认超时，超时会关闭整个 WebSocket。真机 v0.2.27 打开该会话后复现整页白屏。首轮轻量化包将内存占用从约 148 MiB 降至约 119 MiB，但仍白屏；通过临时 WebView 调试包捕获到 `TypeError: Object.hasOwn is not a function`，来源是 Markdown 渲染依赖在该机旧版 Huawei WebView 上缺少 ES2022 API。

**修复策略：** 历史首屏、向前分页和前台对账都使用 app-server 提供的 `summary` 视图，避免把历史工具原始结果载入移动端；这些请求使用独立的 60 秒超时，避免慢速局域网把整个连接按默认 10 秒关闭。入口处补充不覆盖原生实现的 `Object.hasOwn` 兼容补丁，使 Markdown 历史可在旧 WebView 渲染。实时新增 item 仍沿用完整通知，当前运行会话的工具活动不受影响。

## 任务 1：先写失败回归测试

**文件：**
- 修改 `tests/ui/thread-session.test.ts`

1. 让 resume、只读回退、历史分页和前台对账的断言要求 `itemsView: "summary"`。
2. 让这些重型历史请求的断言要求第三个参数 `{ timeoutMs: 60_000 }`。
3. 运行 `npm test -- tests/ui/thread-session.test.ts`，确认测试因当前仍发送 `full` 且未传超时选项而失败。

## 任务 2：最小实现并通过聚焦测试

**文件：**
- 修改 `src/app-server/thread-session.ts`

1. 扩展本地 `Requester` 类型，使其接受请求级超时选项。
2. 将 thread 历史相关请求统一为 `itemsView: "summary"`。
3. 为 `thread/resume` 和 `thread/turns/list` 传入 `{ timeoutMs: 60_000 }`；轻量 `thread/read` 保持默认超时。
4. 运行 thread-session 与 app-server-client 测试，确认回归覆盖与请求级超时机制都通过。

## 任务 3：完整验证与真机验证

1. 先添加 `tests/ui/polyfills.test.ts`，确认缺少 `Object.hasOwn` 时失败；再实现 `src/polyfills.ts` 并从 `src/main.tsx` 最先导入。
2. 运行 `npm test`、`npm run typecheck`、`npm run build`。
3. 在真机再次打开目标会话，确认不再白屏、用户/助手历史可见、连接保持已连接，并验证“加载更早消息”分页。

## 任务 4：构建、安装并上传 APK

1. 将 Android 包版本提升到 `v0.2.28`、`versionCode 38`，沿用已验证签名。
2. 在隔离临时目录按现有 PakePlus 工作流构建 APK，安装到测试真机并复验版本和目标会话。
3. 检查 `http://192.168.123.79:8765/`，必要时从 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py` 启动服务。
4. 通过 `PUT /upload/CodexMobile-v0.2.28.apk` 上传；下载回验文件大小和 SHA-256 一致，并记录 48 小时过期时间。
5. 清理本次临时诊断和构建文件。
