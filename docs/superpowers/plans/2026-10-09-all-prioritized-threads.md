# 主动及被动置顶默认全部展开实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 按步骤执行，沿用当前用户授权的提交、推送与双平台发布流程。

**Goal:** 主动置顶、运行中和未读对话默认全部显示，不受项目折叠或最近五条分页限制。

**Architecture:** 沿用顶部置顶区完整渲染；扩展列表加载器，将本机置顶、未读 ID 和服务端已加载的运行中对话独立补取摘要。刷新保留仍属于置顶区的对话，普通项目继续按五条分页。

**Tech Stack:** React、TypeScript、Vitest、Vite、Gradle、Xcode。

### Task 1：复现缺失

- [x] 在 `tests/ui/thread-list-loader.test.ts` 增加已加载对话分页、未读摘要补取、去重、单条失败和旧客户端迟到测试。模拟 `thread/loaded/list` 返回 `{ data: ['running'], nextCursor: null }`，`thread/read` 返回 `{ thread: { id: 'running', status: { type: 'active' } } }`，确认 `onPinnedData` 收到最近五条之外的摘要。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-loader.test.ts`，确认因缺少被动置顶加载而失败。

### Task 2：修复默认完整加载

- [x] 在 `src/app-server/thread-list-loader.ts` 添加 `prioritizedThreadIds?: string[]` 和 `includeRunningThreads?: boolean`。分页读取 `thread/loaded/list({ limit: 100, cursor })`，去重后读取摘要，显式 ID 或 `isThreadRunning(metadata.status)` 的摘要调用现有 `onPinnedData`；普通分页排除该 ID 集合。
- [x] 在 `src/App.tsx` 使用 `new Set([...readLocalPinned(), ...readLocalUnread(), ...threadsRef.current.filter(thread => isThreadRunning(thread.status)).map(thread => String(thread.id))])` 保留置顶区记录，加载时传入 `prioritizedThreadIds` 并开启 `includeRunningThreads`。回调合并所有补取的摘要，沿用 `decorateThreads` 恢复最新本机置顶和未读状态；已结束运行的摘要也合并，使其回到普通列表。
- [x] 重跑加载器、置顶模型、列表 UI 回归；验证超过五条、折叠项目下所有置顶仍完整渲染。

### Task 3：提交与交付

- [ ] 运行 `npm run build` 和 `git diff --check`；仅提交本次文件，按 `docs/commit-conventions.md` 中文 Conventional Commits 提交并推送。
- [ ] 查询 Android `latest.json` 和 iOS `latest-ios.json`，以严格更高的统一版本从已推送提交构建两个安装包。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <包> --version <统一版本> --notes '主动置顶、运行中和未读对话默认完整显示，不受项目分页限制'` 分别发布。
- [ ] 校验固定清单、HEAD、完整 GET 的版本、字节大小和 SHA-256，核对 IPA 签名状态；清理临时文件，记录验证结果。仅在创建了测试对话时归档这些测试对话。

## 验证记录

- 新增的三项加载器测试先因未加载被动置顶失败，修复后通过。
- 聚焦测试（排除 `.mobile-build` 中旧源码）4 个文件、69 项全部通过；覆盖 21 条主动/未读/运行置顶及折叠项目。
- `npm run build` 和 `git diff --check` 通过。
- 已通过本机 Codex CLI 生成的协议 schema 核对 `thread/loaded/list` 的字符串 ID 和分页游标契约。
- 未创建远程测试对话，无需归档；安装包交付使用统一版本 0.2.118，高于两个固定渠道的 0.2.117。
- 补充同批列表更新回归：ID 状态尚未同步时按当前摘要保留主动置顶、未读和运行中记录；已结束运行的最新摘要优先。该测试先失败，修复后通过。
