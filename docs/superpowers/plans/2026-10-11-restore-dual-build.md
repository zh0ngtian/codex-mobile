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

- [ ] 按提交规范提交，合入并推送 main；不修改客户端源码或现役 recipe，不重新发布局域网安装包。
- [ ] 等待本次 push 对应的 Actions，确认版本、Android/iOS 状态、Release 附件大小和 SHA-256；失败则修复并再次验证。
- [ ] 在本计划记录验收结果，提交并推送文档；文档推送不触发构建。
- [ ] 归档本任务 worktree，清理临时测试文件。
