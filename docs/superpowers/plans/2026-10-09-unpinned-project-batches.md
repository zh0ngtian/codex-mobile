# 置顶与项目普通对话分页实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐项执行；分页、界面接入和发布由同一执行者连续完成。采用 superpowers:test-driven-development。

**Goal:** 全部本机置顶对话独立加载，每个项目及无项目分组另取最近五条非置顶对话。

**Architecture:** 沿用置顶摘要独立读取。项目分页接收排除 ID 集合，以剩余普通对话数量为请求 limit，跨页跳过置顶及无项目记录；返回最后消费页的游标，不丢失下一批普通对话。无项目查询先从目标 ID 集合排除置顶，追加数量只计算普通对话，并保留已加载置顶。

**Tech Stack:** TypeScript、React、Vitest、Vite、Android Gradle、Xcode。

---

### Task 1：回归测试及分页实现

**Files:** `tests/ui/thread-list-loader.test.ts`、`src/app-server/thread-list-loader.ts`

- [x] RED：增加跨页跳过置顶、全置顶页、普通对话不足五条、下一批游标连续、重复游标停止、无项目置顶不占名额和加载器刷新/重试测试。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-loader.test.ts`，确认因当前未排除置顶而失败。
- [x] GREEN：增加 `loadProjectThreadRecords(client, cwd, cursor, excludedThreadIds)`，每页请求 `limit: PROJECT_THREAD_BATCH_SIZE - threads.length`，过滤排除 ID，使用游标补足五条或到历史末尾；重复游标终止。保留未提供游标的旧服务端兼容行为。
- [x] 为 `loadProjectlessThreadRecords` 增加 `pinnedThreadIds` 参数，从目标 ID 中先排除置顶；加载器保存本轮置顶集合并在初始加载、刷新及重试中传递。
- [x] 重跑聚焦测试，确认通过。

### Task 2：应用接入与说明

**Files:** `src/App.tsx`、`README.md`

- [x] 项目追加传入 `new Set([...readLocalPinned(), ...projectlessThreadIds])`；无项目追加传入 `readLocalPinned()`，合并时保留本机置顶记录。
- [x] `toggleProject` 的已加载数量过滤 `thread.isPinned !== true`，避免无项目下一批超额；重试入口传递最新本机置顶 ID。
- [x] README 明确“全部置顶 + 每项目最近五条非置顶”，追加亦为每批五条。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-loader.test.ts tests/ui/thread-list-page.test.tsx tests/ui/thread-pinning.test.ts`、`npm run typecheck`、`npm run build` 和 `git diff --check`。

### Task 3：提交及双平台固定渠道交付

- [ ] 遵守 `docs/commit-conventions.md`，只暂存本次文件，提交中文 Conventional Commit，推送当前分支。保留工作区已有 iOS 修改。
- [ ] 读取两个固定渠道版本，选取均更高的统一版本；从已提交源码构建 APK 和未签名 IPA。
- [ ] 分别执行 `python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <安装包> --version <统一版本> --notes '置顶对话全部加载，每个项目另取最近五条非置顶对话，更多按五条普通对话分页。'`。
- [ ] 对 Android `latest.json`/`latest.apk`、iOS `latest-ios.json`/`latest.ipa` 核对清单、HEAD、完整 GET 的版本、大小及 SHA-256；删除本次临时源码和下载，保留安装包与交付校验记录。

验证记录：新增六项分页回归测试先失败再通过；相关测试 90 项通过，类型检查及前端构建通过。固定渠道当前均为 0.2.104，本次统一构建版本为 0.2.106。
