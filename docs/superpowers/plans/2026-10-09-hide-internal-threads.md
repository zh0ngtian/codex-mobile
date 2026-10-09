# 隐藏子 Agent 与内部辅助会话实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 普通列表、主动与被动置顶、无项目分组和搜索结果隐藏子 Agent 与内部辅助会话。

**Architecture:** 新增共享 `isVisibleThread` 分类函数，根据 `ephemeral`、`parentThreadId`、`source`、`threadSource`、`sourceKind` 的明确分类证据过滤。保留普通桌面/CLI 会话、UUID 标题和用户复制会话。列表去重、优先摘要读取、聚合展示和全文/回退搜索复用此函数；项目分页在过滤后继续补足五条。

**Tech Stack:** TypeScript、React、Vitest、Vite、Android Gradle、iOS Xcode 与本机 Ad Hoc 签名发布。

### Task 1: 先复现再修复

**Files:** 新建 `src/features/threads/thread-visibility.ts`，修改 `src/app-server/thread-list-loader.ts`、`src/app-server/thread-search.ts`、`src/features/threads/thread-list-model.ts`；测试对应 `tests/ui/thread-{list-loader,list-model,search}.test.ts`。

- [x] 添加聚合列表过滤测试：具名运行中子 Agent、父会话、临时会话、压缩/审查来源和内部来源均隐藏；普通 UUID 标题和 `forkedFromId` 保留。
- [x] 添加运行中补取及本机置顶过滤测试；模拟子 Agent 经 `thread/loaded/list` 与 `thread/read` 返回，期望置顶区只有普通会话。
- [x] 添加项目分页补足测试：首批含子 Agent，后续读取直到普通会话五条；验证无项目分组也不计隐藏记录。
- [x] 添加全文搜索和旧服务端回退搜索过滤测试。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/thread-list-loader.test.ts tests/ui/thread-list-model.test.ts tests/ui/thread-search.test.ts`，确认新断言因隐藏记录仍出现而失败。
- [x] 实现共享分类函数，列表去重排除已明确分类的 ID，优先摘要读取与聚合函数使用过滤；搜索复用分类；项目分页移除仅有显式排除 ID 才补足的限制。
- [x] 重跑上述测试，期望全部通过；README 补充可见会话规则。

### Task 2: 验证、提交和双端交付

- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test`、`npm run build`、`git diff --check`。
- [x] 阅读并遵守 `docs/commit-conventions.md`，以 `fix(会话列表): 隐藏子 Agent 与内部辅助会话` 提交，正文包含新增功能和主要修改；同步 main 后推送。
- [x] 排队获取固定发布锁，读取 Android/iOS 两个固定渠道，使用高于两者的统一版本构建双端。
- [x] 推送成功后构建 Android APK，并运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '隐藏子 Agent 与内部辅助会话'` 构建、签名和发布 IPA。
- [x] 用 `apk-server.py publish-channel codex-mobile <APK> --version <统一版本> --notes '隐藏子 Agent 与内部辅助会话'` 发布 APK；通过两个固定 JSON、HEAD、完整 GET 核对版本、大小、SHA-256，交付签名 IPA 与 APK 固定链接。
- [x] 清理无用临时文件与本次 worktree；记录实际验证结果。不创建测试会话，因此无需测试会话归档。

## 验证记录

- 七项新增回归断言先失败，覆盖列表聚合、运行中/置顶补取、过滤后分页、稀疏摘要和两种搜索路径；修复后聚焦 51 项通过。
- 全量 Vitest 91 个文件、811 项通过；TypeScript 与 Vite 构建通过，保留原有大包提示；`git diff --check` 通过。
- 未创建真实测试会话。
- 协议还明确包含 `memory_consolidation` 内部记忆整理来源；补充测试先失败再通过，用户 `automation` 会话保留。

## 交付记录

- 客户端代码已推送 main：`1f6b585` 与 `01eb271`；构建基于 `01eb27155db8d5181ef51ce56a1d6f315c892e3b`，已集成并行任务的 OTA 等待提示修改。
- 持有主工作区 `.mobile-build/.fixed-channel-publish.lock` 完成版本分配、双端构建、发布和校验；原双端固定渠道均为 `0.2.128`，本次统一 `0.2.129`。
- APK：4,705,291 字节；SHA-256 `a2717848abd907bf043eeeaf41112c258cf3cfe114da24a55a85f99ca738f3b0`。
- IPA：3,763,719 字节；SHA-256 `3ec5122f1ca2e9e8180c41e7b2292a650c3ea3ebbfaf7566d2710436fd92988a`；Ad Hoc 已签名，`vip.loock.codexmobile`、application-identifier 与钥匙串组继续保留已安装身份。
- 两个固定 JSON、HEAD、完整 GET 的版本、大小与散列全部一致，HTTPS OTA 已发布并回验。构建与验签不代表真机覆盖安装及数据保留已验证。
- 安装包、签名报告与 `verification.json` 保存在主工作区 `.mobile-build/hide-internal-release/`，临时构建工作树收尾归档；仅模拟测试数据，无真实测试会话需要归档。
