# 恢复 GitHub 双端自动构建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** main 的客户端相关推送自动构建统一版本 APK 与 unsigned IPA，两端成功后上传同一个 GitHub Release。

**Architecture:** 工作流先读取全部 Release 标签与仓库版本下限，分配高于已用版本的新版本，再启动 Ubuntu Android 和 macOS iOS 两个任务。构建入口读取现役本地 recipe；iOS 复用 ios:prepare 的图标和工程准备，Android 执行现役 recipe。只上传云端产物；本机签名、OTA、LAN 与软件源发布保持现役流程。

**Tech Stack:** GitHub Actions、Node.js 22.14.0、YAML、Vitest、JDK 17、Android SDK、macOS 15 Intel、Xcode 26.3。

---

### 任务 1：先验证契约

文件：`tests/ci/mobile-build-workflow.test.ts`。

- [x] 编写 CLI 回归：已有 v0.2.146 与 unsigned-ipa-0.2.147 标签时输出 0.2.148；拒绝版本倒退与非法 versionCode；验证两端 plan 指向当前固定容器及 recipe，iOS 显式未签名。
- [x] 编写 YAML 契约：main push 和手动入口、单一版本任务、双端矩阵、双端成功后才发布、无 npm 发布和云端签名凭据。
- [x] 运行 `npm test -- tests/ci/mobile-build-workflow.test.ts --maxWorkers=2`，确认缺失 CLI/workflow 导致预期失败。

### 任务 2：实现与验证

新建 `scripts/resolve-mobile-version.mjs`、`scripts/build-mobile.mjs`、`.github/workflows/build-mobile.yml`。

- [x] 版本 CLI 从 `--releases <json>` 与 `mobile-version-floor.json` 计算最大版本，自动递增 patch，处理 patch/minor 999 进位，校验 Android versionCode；`--requested` 必须高于最大版本；写入 GITHUB_OUTPUT。
- [x] 构建 CLI 接受 `--platform android|ios --version <version> --plan`。iOS 调用 ios:prepare，再执行 recipe 的 unsigned 构建与校验；Android 检出 recipe.container 并顺序执行 recipe.steps。两端向 `.mobile-build/artifacts` 写入安装包、SHA-256 与来源提交回执。
- [x] 工作流 main push 路径只覆盖客户端、共用构建入口及配置；workflow_dispatch 提供 release_version。并行任务使用统一 APP_VERSION，上传各自产物；release 依赖整个 matrix 成功后下载并校验散列，通过 gh release 创建正式 Release。npm 保持手动。
- [x] 运行新增 CLI/YAML 测试与 `npm test -- tests/ci --maxWorkers=2`；执行 `npm run typecheck` 与 `git diff --check`。

### 任务 3：启用并验收

修改 `README.md`、`mobile/README.md`、`docs/ios-ota-release.md`，说明自动云端出包与本机签名渠道的边界。

- [x] 按提交规范提交，合入并推送 main；不修改客户端源码或现役 recipe，不重新发布局域网安装包。
- [x] 等待本次 push 对应的 Actions，确认版本、Android/iOS 状态、Release 附件大小和 SHA-256；失败则修复并再次验证。
- [x] 在本计划记录验收结果，提交并推送文档；文档推送不触发构建。
- [ ] 归档本任务 worktree，清理临时测试文件。


## 验收记录（2026-10-11）

- 恢复提交 `651d08c`；分页兼容修复 `e08f5ee`；最终 Android 环境与路径修复 `6ec8c3e`。已合入并推送 main。
- TDD 已验证工作流缺失、gh 分页参数冲突、Android SDK 默认 tools 包及原生相对路径问题的失败，再修复转绿；最终构建相关测试 6 个文件、48 项全部通过，`npm run typecheck` 与 diff 检查通过。
- [最终自动运行 38115100859](https://github.com/zh0ngtian/codex-mobile/actions/runs/38115100859) 由 main push 自动触发，版本、Android、iOS 与共同发布任务全部 success。
- [GitHub Release v0.2.148](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.2.148) 两端版本一致。完整下载全部附件后，验证安装包字节数、SHA-256、校验文件及构建回执一致，来源提交均为 `6ec8c3ee57a10d3acf1adbe37a8529756456dfa2`。

| 云端产物 | 版本 | 字节数 | SHA-256 | 签名 |
| --- | --- | --- | --- | --- |
| CodexMobile-v0.2.148.apk | 0.2.148 | 4714203 | c3784c8c9f9672ec7a06077fcabf5d09f7661ec98a226caafc83c0da50ee6923 | 原有 debug 构建签名 |
| CodexMobile-v0.2.148-unsigned.ipa | 0.2.148 | 3758081 | 8231ca3adccb71d7a0c21707b21466b2843b8be0ce26eafeda200ca2e1c7216a | 未签名 |

本次仅修改 CI、构建入口、测试与说明，未改变客户端源码、原生补丁或现役 recipe 的产物配置。未重新发布本机签名渠道；固定渠道保留 0.2.146，已回验两端清单、HEAD 和完整 GET：

| 固定渠道 | 版本 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| latest.apk | 0.2.146 | 4714647 | 2c23e3733937bcf7dfea8a73f835c030e55289afbe579f85aa47bdfbf301540a |
| latest.ipa（Ad Hoc 已签名） | 0.2.146 | 3781983 | 32585321903f8ab6e1c93b44e080dc5e4b76b0ce7b29b4406276fc85c88bf0da |

[固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[固定 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。云端 unsigned IPA 与本机已签名渠道分别交付。npm 保持手动发布。
