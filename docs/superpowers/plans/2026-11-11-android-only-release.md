# Android 原生界面发布与后续单端构建计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布已完成的 Android 原生 Material You 界面与双端共享地址明文修复，并落实不涉及 iOS 的改动不构建 iOS 包的长期要求。

**Architecture:** 新增 `codex-mobile-github-android` 项目与 `mobile-github-android` kind，阶段固定 `main/build/verify`，沿用 main 互斥锁和版本预留。冻结项目决定构建平台，Android 单端不生成或校验 IPA、不访问 iOS 软件源；既有双端和历史冻结合同保持兼容。

**Tech Stack:** Python 发布适配器与 unittest、Node 冻结校验脚本与 Vitest、GitHub Actions、现有 releasectl。

基线：`origin/main = cfb0c76667a1796806595584a0e781ed81a18005`。开发工作区：`/Users/zhongtian/.codex/worktrees/android-layout-alignment/codex-mobile`。发布任务：`codex-mobile-20261111-native-layout-release`（GitHub-only 双端）。用户已授权本次发布及后续按受影响平台构建。当前 `device-panel.ts` 的地址明文修复由 iOS 原生设备表单共用，因此本次仍发布 GitHub APK／unsigned IPA 及软件源；后续纯 Android 改动使用新单端入口。不部署网关。先登记的 Android 任务 `codex-mobile-20261111-android-native-layout` 已在 ready 前 withdrawn，无版本或批次。

## 任务一：以 TDD 接入 Android 单端构建和验收

- [x] 运行现有 `tests/ci` 和 Python 发布适配器回归，确认基线。
- [x] 在 `tests/ci/test_github_only_release_adapter.py` 或新的 Android 专用测试中增加失败测试：新身份/阶段校验、禁止 source/iosbuild/sign/ota/ipa、prepare 不读取 iOS、仅收集 APK、verify 独立下载 APK、成功凭证 `platforms=[android]` 与 `softwareSourceUpdated=false`，错误身份及阶段拒绝。
- [x] 在 `tests/ci/release-batch.test.ts` 增加失败测试：Android 冻结项目仅输出 Android matrix、仅接受 Android 回执、拒绝其他项目的身份混搭；旧项目仍要求双端回执。
- [x] 在工作流契约测试增加失败测试：matrix 来自冻结校验输出，Release 附件仅来自校验平台，不因缺少 IPA 失败，现有双端仍上传两端包。
- [x] 保存失败输出，确认失败原因是缺少新范围支持。
- [x] 最小修改 `scripts/codex_mobile_release_adapter.py`、`scripts/validate-release-batch.mjs`、`.github/workflows/build-mobile.yml`，增加 `release/coordinator.android.example.json`，不改历史项目合同或分发策略的现有值。
- [x] 运行新增测试至通过，再运行完整 `tests/ci`、Python 适配器回归、协调器恢复回归、`npm run typecheck`，保存日志。
- [x] 需求评审通过后执行代码质量评审，修复重要问题并回归。

## 任务二：同步现行约定并提交固定来源

- [x] 修订 `AGENTS.md`、`README.md`、`docs/release-coordination.md`、`docs/interaction-alignment.md`：仅涉及 Android 时选 Android 项目；涉及 iOS 或影响 iOS 的共享运行代码时选择双端项目；按本批平台提供链接与散列，Android 不等待软件源。
- [x] `release/notes.md` 只记录用户可感知的 Android 原生界面、动效、双端地址明文与紧凑布局改进。
- [x] 复用 Android 21 项仪器测试和 145 项业务回归的既有证据；本次只改发布流程，执行发布相关回归，无需重复 UI 测试。
- [x] 阅读提交约定，`git diff --check`，确认最新远端 main，按中文 Conventional Commits 提交并推送任务分支。
- [x] 将真实通过的四项 required checks 写入仓库外 validation JSON，ready 固定 SHA，持续 heartbeat。

## 任务三：正式构建、独立验收与交付

- [x] 等待协调器整合、版本预留、冻结、main 推送及 GitHub 双端构建。
- [x] 验证 GitHub Actions 本批双端构建；成功批次凭证指向本冻结 SHA、APK 和 unsigned IPA；后续 Android 单端分支由契约回归验证无 iOS 作业。
- [x] 独立核对 Release 元数据、两端 HEAD 和完整 GET，比较文件大小与 SHA-256；检查 APK 的版本、包名和原生入口，并核对 IPA 版本与未签名状态及软件源。
- [x] 确认新 Android 单端入口的测试不访问软件源或下载 IPA；本批双端按原软件源合同验收，记录证据；本机旧 LAN 与 OTA 服务不启动。
- [x] 交付可点击的 GitHub Release、APK、unsigned IPA 和软件源链接、版本、大小、SHA-256，说明本批包含共享表单的 iOS 修复及后续单端规则。

状态：已完成实现、评审、正式双端批次和独立渠道验收。0.3.45成功交付；后续Android单端入口已通过契约回归，首次真实单端批次待后续发布验收。

本地验证：基线 162 项构建合同／261 项 Python；第一轮实现后 171／271 项及 typecheck 通过，补修远端附件后为 171／273 项，协调器恢复 59 项通过。需求评审发现的远端 Release 混入 IPA 缺口已完成红绿修复并通过复审；最终质量评审通过，无 Critical／Important 阻塞，随后已 ready 固定任务来源并取得成功批次。iPhone 17 Pro／iOS 27.0 正常字号竖屏地址明文输入、普通字段类型及取消返回通过 1 项 XCTest，截图 `docs/assets/ios-simulator/device-address-20261111.png`；仅离线夹具，无真实测试会话，任务模拟器已删除。

评审保留一项非阻塞改进建议：适配器本地目录可进一步拒绝残留 IPA 校验文件或旧 APK；CI 发布前校验、远端回验均已使用严格白名单，真实 shell 夹具验证只上传冻结范围的三项／六项附件，未发现越界交付路径。本次不扩大本地目录清理范围。

## 最终交付

0.3.45／3045 已正式发布：[GitHub Release](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.3.45)。客户端成功批次 `89b75441-f1ec-4b96-b895-ef7d1e6a1063`，冻结 `ddf58d120a3b7fd53c221ade11b515f0de9f6ce2`，任务来源 `f62563f4d43c553e20821e9398dac97c275af262`；正式 CI `42959923223` 与开发 CI `42959923167` 均成功。273项适配器、59项协调器恢复、171项构建合同、类型检查以及独立104项渠道核对通过。两端 HEAD／完整 GET、大小与 SHA-256、IPA 实际版本及未签名状态、软件源日志与署名均符合冻结来源；APK 原生 Compose 代码、实际版本及相对0.3.44的签名证书一致性已核对。Android 21项原生仪器及145项业务回归沿用相同运行源码证据，iPhone 17 Pro补验地址明文1项通过。没有创建真实测试会话。

后续不影响 iOS 的改动使用独立 Android 项目，只构建和验收 APK，不访问 iOS 软件源；本次包含 iOS 消费的共享地址表单改动，因此仍按双端交付。新单端入口的契约回归与真实 shell 夹具通过，首次正式单端批次尚待后续纯 Android 发布验收。本次未部署网关，没有发布 LAN 包、签名 IPA、HTTPS OTA 或固定 IPA；历史四文件散列及停用服务状态保持。真机安装、覆盖升级、数据保留和实际手感仍待验收。

完整产物与校验见[公共凭证](evidence/2026-11-11-native-layout-release.json)。
