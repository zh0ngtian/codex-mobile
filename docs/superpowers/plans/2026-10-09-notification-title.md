# 完成通知显示会话标题实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本任务工作树执行；按 superpowers:test-driven-development 先验证失败再实现，不修改其他任务的未提交内容。

**Goal:** Bark 通知正文与系统通知一致，显示已完成会话的标题，App 退出后仍可使用最新标题。

**Architecture:** BarkNotifications 保存有界的会话标题缓存，只提取 thread 对象中的 name/preview，实时 thread/name/updated 同步重命名。HTTP 与 WebSocket 的成功 RPC 响应登记标题，不改变完成判定和持久化去重。未知标题回退“新对话”，不使用最终回复正文。

**Tech Stack:** TypeScript、Node HTTP/WebSocket、Vitest、Playwright、既有移动端构建流水线。

## 1. 先验证期望内容

- [x] 在 `tests/server/bark-notifications.test.ts` 增加真实本地 Bark 接收断言：thread/started 的 name、HTTP thread/resume、thread/list 和成功 thread/name/set 的标题成为 push.body；重命名失败保留原标题；流式 App 断开后的 name 更新仍生效；其他会话的标题不会串用；历史 RPC 只提供标题而不触发推送。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/bark-notifications.test.ts`，确认旧固定正文导致断言失败。
- [x] 在 `tests/e2e/final-answer-push.spec.ts` 末尾增加 `expect(pushes.every((push: any) => push.body === thread.name)).toBe(true)`，通过真实页面的 iOS 通知桥检查现有系统推送内容。

## 2. 登记标题并接入传输

- [x] `server/bark-notifications.ts` 增加 `private titles = new Map<string, { name?: string | null; preview?: string | null }>()`；增加 rememberThread 提取合法 id 和 name/preview，最多缓存 2048 个会话，每个字段最多 4096 字符，事件与 RPC 不保存正文。
- [x] 增加 `observeRpc(request, response)`，只登记成功的 result.thread、thread/list 的 result.data，以及 thread/name/set 的 request.params.name；失败 RPC 不改变标题。
- [x] observe 的完成判定前处理无请求 id 的 thread/started 和 thread/name/updated；成功完成时计算 `const body = title?.name?.trim() || title?.preview?.trim() || "新对话"` 并用于 Bark payload。
- [x] `server/http-session.ts` 在 observeRpcState 的状态筛选前调用 `this.notifications?.observeRpc(request, response)`；`server/gateway.ts` 在已关联的 request 响应块中调用 `notifications.observeRpc(request, message)`，保证只使用匹配成功响应。
- [x] README 写明系统和 Bark 正文显示会话标题；运行 Bark、网关、HTTP 会话、最终回复判定、系统通知测试以及 `npm run build:package`。
- [x] 执行 `PLAYWRIGHT_CHANNEL=chromium HOST=127.0.0.1 PORT=4173 CODEX_APP_SERVER_MODE=external CODEX_APP_SERVER_URL=ws://127.0.0.1:19999 CODEX_MOBILE_TOKEN=test-token npx playwright test tests/e2e/final-answer-push.spec.ts --reporter=line`，确认标题与最终完成时机均正确。

## 3. 提交与发布

- [ ] `git diff --check` 与暂存检查通过后按 `docs/commit-conventions.md` 提交本次文件，集成最新 main 并推送，不暂存其他任务改动。
- [ ] 读取固定 Android/iOS 清单，选取统一更高版本；从已推送提交分别构建 APK、IPA 和网关包，更新本机网关并核对版本。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes '完成通知正文显示会话标题，系统与 Bark 一致'` 分别发布；JSON、HEAD 与完整 GET 核对版本、字节数和 SHA-256；检查 APK 签名与现有渠道一致，注明 IPA 未签名。
- [ ] 保留安装包、网关包和 verification.json，删除本次临时构建目录并归档工作树；测试只使用本地模拟会话，不向真实用户会话发送请求。

验证记录：旧固定正文使 8 项接收端断言失败；新实现的 110 项通知和传输单元测试、1 项真实页面 iOS 通知桥测试通过，前端及网关构建通过。
