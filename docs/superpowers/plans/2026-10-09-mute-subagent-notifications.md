# 子 Agent 会话免通知实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在隔离工作树逐项执行；按 superpowers:test-driven-development 先验证失败再实现。

**Goal:** 子 Agent 会话不触发 Bark 或系统完成通知，主任务通知保持正常；更新无客户端改动时免构建的仓库规则。

**Architecture:** 在共用 FinalAnswerCompletionTracker 登记有界的子会话 ID 分类。分类来自 thread.source 的 subAgent/subagent、parentThreadId、threadSource 的子 Agent 类型及 subAgentActivity.agentThreadId；RPC 和列表只登记分类，不触发历史通知。Bark 的 rememberThread 和客户端已有会话数据提供来源，实时 thread/started 提供新会话来源。

**Tech Stack:** TypeScript、React、Node HTTP/WebSocket、Vitest、Playwright、现有 Android/iOS 构建流程。

## 1. 规则和回归测试

- [x] 更新 `AGENTS.md`：未修改客户端运行代码时免 APK/IPA 构建；客户端引用的共用模块计入客户端改动。
- [x] 在 `tests/server/final-answer-completion.test.ts` 测试无标题子会话、两种来源大小写、父会话字段、主会话包含子 Agent 活动、改名和普通 fork。
- [x] 在 `tests/server/bark-notifications.test.ts` 经真实 HTTP 接收端验证 thread/started、thread/read/list/resume、流式来源登记；子会话无推送，同连接主会话继续推送。
- [x] 在 `tests/e2e/final-answer-push.spec.ts` 经系统通知桥验证列表与实时来源过滤。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/final-answer-completion.test.ts tests/server/bark-notifications.test.ts`，确认新增子会话断言失败。

## 2. 最小实现

- [x] `server/final-answer-completion.ts` 新增 `rememberThread(thread)`，仅缓存分类 ID；`observe` 在完成判定前登记实时来源并拒绝子会话完成信号。
- [x] `server/bark-notifications.ts` 的 `rememberThread` 首先调用 `this.completions.rememberThread(thread)`，不依赖标题存在。
- [x] `src/App.tsx` 在完成判定前登记 `threadsRef.current` 与 `activeRef.current`；捕获 thread/started 不受会话列表是否显示影响。
- [x] 运行通知与传输测试、系统通知端到端、`npm run build:package`、`git diff --check`，自审来源覆盖和普通会话通知。

## 3. 提交部署

- [x] 按 `docs/commit-conventions.md` 提交本任务文件，集成并推送；保留其他任务未提交修改。
- [x] 更新本机网关并核验状态。由于本次修改客户端共用模块及接入，读取双端清单后排队分配统一更高版本，构建 APK 和 IPA。
- [x] 分别执行 `apk-server.py publish-channel codex-mobile <安装包> --version <版本> --notes '子 Agent 会话不再发送完成通知'`；通过固定 JSON、HEAD、完整 GET 核对版本、大小和 SHA-256，提供签名状态。
- [x] 记录验证证据并清理临时产物；测试使用模拟会话，不创建真实会话。

验证记录：基线 35 项测试通过；新增 10 项单元断言和 2 项系统通知端到端断言在旧实现下失败；修复后通知与传输 120 项测试和系统通知 2 项通过，前端与网关打包通过。

交付记录：代码 `61a6526` 已集成并推送 main；本机网关升级至 `0.2.123`，部署模块对指定子会话的过滤验证通过，未发送测试通知。以主工作区 `.mobile-build/.fixed-channel-publish.lock` 持锁完成版本分配及双端发布。APK/未签名 IPA 均为 `0.2.123`，固定 JSON、HEAD、完整 GET 版本、大小及 SHA-256 一致，APK 签名与既有渠道相同。安装包与 verification.json 保留在主工作区 `.mobile-build/mute-subagent-notifications-release`。本次测试使用模拟传输，无真实测试会话需归档。
