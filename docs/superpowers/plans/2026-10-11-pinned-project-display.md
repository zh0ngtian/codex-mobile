# 置顶会话同时显示在项目区域实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本任务独立 worktree 逐项执行；列表行为与双端发布连续完成，不委派子任务。

**Goal:** 主动置顶、运行中和未读会话同时显示在置顶区域及所属项目（含无项目）区域。

**Architecture:** 单机项目分组直接渲染其全部已加载会话，搜索时保留有匹配会话的项目。沿用主动及被动置顶汇总、项目时间排序、折叠状态和普通会话分页；全部机器视图继续沿用置顶与最近分区。

**Tech Stack:** React、TypeScript、Testing Library、Vitest、Android WebView、WKWebView、Ad Hoc OTA。

### 任务 1：回归与实现

文件：`tests/ui/thread-list-page.test.tsx`、`src/features/threads/ThreadListPage.tsx`、`README.md`。

- [x] 验证基线：`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-page.test.tsx tests/ui/thread-list-model.test.ts`。
- [x] RED：新增主动、运行中、未读及无项目会话双区域显示测试，验证两个入口打开同一会话、取消置顶仅移除置顶副本；更新搜索与现有单机断言。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-page.test.tsx`，确认因为项目区域过滤优先会话而失败。
- [x] GREEN：项目搜索过滤改为 `!query.trim() || group.threads.length > 0`；删除 `recentThreads` 过滤，改为 `group.threads.map((thread) => renderRow(thread, false))`；删除不再使用的 `isThreadPrioritized` 导入。
- [x] README 说明单机会话双区域展示、项目折叠和搜索行为，保持每批五条普通会话与全部机器视图规则。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-page.test.tsx tests/ui/thread-list-model.test.ts tests/ui/thread-list-loader.test.ts tests/ui/thread-pinning.test.ts`，再执行 `npm run build`。

### 任务 2：提交与双端发布

- [ ] 按 `docs/commit-conventions.md` 提交中文 Conventional Commit；确认主分支可快进，推送 `main`。
- [ ] 在主工作区 `.mobile-build/.fixed-channel-publish.lock` 排队，读取 LAN 两端、OTA、GitHub Releases，选取同一更高版本。
- [ ] 复用 `mobile/android/build-recipe.yml` 构建 APK；在本 worktree 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '置顶会话同时显示在项目区域'`。
- [ ] 使用固定 `apk-server.py publish-channel codex-mobile <APK> --version <统一版本> --notes '置顶会话同时显示在项目区域'` 发布 Android。
- [ ] 固定双端 JSON、HEAD、完整 GET 版本、大小与 SHA-256 一致；HTTPS OTA 回验通过。
- [ ] 阅读 SignOs 当前 `distribution/source-aggregator/README.md`，确认软件源同步本次 GitHub Release unsigned IPA，保持开发者署名。
- [ ] 将安装包、签名与发布回执保存到长期主工作区，清理无用临时文件；交付固定 OTA/APK/IPA 链接、版本、大小、散列与签名状态。

## 开发验证记录

- 基线 45 项通过；RED 阶段新增双区域行为及搜索断言按预期失败。
- GREEN 阶段列表、分组、加载器与本地置顶 82 项通过，前端构建成功。
- 采用 superpowers:finishing-a-development-branch 收尾；仓库已授权提交、推送和双端发布，不另行选择交付流程。
