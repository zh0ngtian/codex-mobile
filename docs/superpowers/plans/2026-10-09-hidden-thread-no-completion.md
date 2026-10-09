# 隐藏会话免完成通知实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在独立 worktree 按步骤执行，按 superpowers:test-driven-development 先验证失败再修复。

**Goal:** 被列表隐藏的子 Agent、内部辅助、记忆整理和临时会话均不发送系统或 Bark 完成通知；普通主会话和用户复制/自动化会话继续通知。

**Architecture:** 将已有可见性分类函数放到 `server/thread-visibility.ts`，客户端原模块重导出，通知跟踪器复用同一函数。客户端在 thread RPC 成功响应到达时通过 `onThreadMetadata` 先登记原始分类，随后再交给列表/搜索过滤；不把历史 RPC 当成实时完成事件。保留子 Agent 活动事件登记和有界缓存。

**Tech Stack:** TypeScript、Vitest、Playwright、React、Node、Android Gradle、iOS Ad Hoc。

## 1. 回归复现

- [x] 在 `tests/server/final-answer-completion.test.ts` 添加 threadSource=subagent、memory_consolidation、sourceKind、字符串来源、内部对象和 ephemeral 分类；验证稀疏元数据、改名、事件反序仍不通知，主会话及 automation/fork 继续通知。
- [x] 在 `tests/ui/app-server-client.test.ts` 验证 thread/list、read、search 响应先回调 `onThreadMetadata`，非 thread RPC、错误与纯 ID 列表不登记。
- [x] 扩展 `tests/server/bark-notifications.test.ts`，通过实际 HTTP 接收端验证额外隐藏分类无推送。
- [x] 运行聚焦 Vitest 和现有 `tests/e2e/final-answer-push.spec.ts`，确认隐藏列表导致系统通知泄漏及新增分类失败。

## 2. 实现与验证

- [x] 将分类函数移动到 `server/thread-visibility.ts`，客户端 `src/features/threads/thread-visibility.ts` 重导出；`server/final-answer-completion.ts` 复用分类函数。
- [x] `src/app-server/client.ts` 保存待处理请求 method，提供 `onThreadMetadata` 订阅，在成功 thread RPC 响应 resolve 前登记 result.thread 或 data 中 thread/摘要，忽略不带对象 ID 的记录。
- [x] `src/App.tsx` 在 onReady、loadThreads 之前订阅并登记通知跟踪器；失效连接不登记。
- [x] 扩展系统通知端到端用例覆盖列表隐藏、运行中摘要补取和实时来源；重跑聚焦测试、端到端、全量 Vitest、`npm run build:package`、`git diff --check`。
- [x] README 补充隐藏会话免通知契约。

## 3. 交付

- [ ] 遵守提交规范提交推送，更新长期主工作区和本机网关部署，核对网关健康与已部署模块分类，无需发送真实通知。
- [ ] 持主工作区 `.mobile-build/.fixed-channel-publish.lock` 分配高于双端固定渠道的统一版本；在本任务 worktree 构建 APK 和已签名 IPA，并发布固定 HTTP/HTTPS OTA 渠道。
- [ ] 固定 JSON、HEAD、完整 GET 核验版本、大小与 SHA-256；记录验证结果，交付正文包含 OTA 安装页与双端下载链接和签名状态。
- [ ] 保留交付产物与验证报告，删除临时文件并归档 worktree；模拟测试不创建真实测试会话。

## 验证记录

- 六项新增分类断言和原始摘要回调在旧代码下失败；五类 Bark 集成测试在正确初始化后复现实际错误推送，修复后通过。
- 原客户端生产构建下六项系统通知端到端中五项复现漏过滤（旧有实时子 Agent 场景通过）；修复后六项全部通过。
- 聚焦 Vitest 78 项通过；全量 92 个文件、836 项通过；`npm run build:package`、TypeScript、Vite 和网关打包通过，保留原有大包提示。
- 端到端使用已安装 Chromium、本地模拟 RPC 与系统桥；未创建真实会话或发送真实推送。
