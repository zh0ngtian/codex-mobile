# 置顶对话完整显示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冷启动、刷新和重连后完整显示本机置顶对话，不受项目最近五条分页限制。

**Architecture:** 列表加载器在最近列表之外按本机置顶 ID 调用 `thread/read`，只读取摘要。补取结果独立合并，项目刷新保留置顶记录，沿用加载序列防止旧客户端结果覆盖新数据。单条失败不影响其他对话。

**Tech Stack:** React、TypeScript、Vitest、Vite、Android Gradle、Xcode。

### Task 1: 测试复现与最小修复

- [ ] 在 `tests/ui/thread-list-loader.test.ts` 增加最近五条之外置顶对话、无项目标记、单条失败、旧客户端迟到和刷新保留回归测试。
- [ ] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-loader.test.ts`，确认新测试因缺少置顶补取失败。
- [ ] 在 `src/app-server/thread-list-loader.ts` 增加 `pinnedThreadIds` 加载选项及 `onPinnedData` 回调，用 `client.request("thread/read", { threadId, includeTurns: false })` 并行读取去重后的 ID，移除 `turns`，沿用序列检查及无项目标记。
- [ ] 新增 `mergeThreadListPage(current, incoming, retainedIds)`，返回 `dedupeThreadsById([...incoming, ...current.filter(thread => retainedIds.has(String(thread.id)))])`。
- [ ] 在 `src/App.tsx` 传入 `pinnedThreadIds: [...readLocalPinned()]`，补取回调只合并仍然置顶的记录；普通列表及项目刷新保留本机置顶记录，保持原分页游标及完整加载项目逻辑。
- [ ] 重跑聚焦测试，确认全部通过；更新 README 中置顶行为说明。

### Task 2: 验证、提交与交付

- [ ] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test`、`npm run build`、`git diff --check`。
- [ ] 遵守 `docs/commit-conventions.md` 提交并推送到 main。
- [ ] 读取两个固定渠道现有版本，统一使用更高版本构建 APK 与未签名 IPA。
- [ ] 使用 `apk-server.py publish-channel codex-mobile` 分别发布两个安装包。
- [ ] 对两个固定清单、HEAD、完整 GET 核对版本、字节大小和 SHA-256；清理本次临时文件并交付固定链接和校验信息。
