# 视频独立预览与侧栏修复双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已合入 main、已在默认模拟器安装查看的视频独立预览及同期侧栏修复发布到双端固定渠道，取得并独立核对成功发布凭证。

**Architecture:** 复用现役 releasectl、`codex-mobile-lan-production` 目标及 `codex-mobile-main-production` 共享锁。协调器负责正式 main 整合、版本分配、冻结、双端构建、iOS 签名与全部渠道发布；不部署网关。发布负责人只准备已推送的任务 SHA、门禁材料和独立验收。

**Tech Stack:** Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc 签名、固定 LAN／HTTPS OTA 及既有 unsigned 软件源订阅。

---

用户已明确授权“发布”，按仓库默认范围执行双端。开发基线为 `b69802cdf6f90c1a0d72ac77b71c131d280573a5`；上一正式版本0.3.26，冻结 `c9c23eae31b18cbc093a8c29c757f2220aee7419`。任务 `video-image-preview-release-20261021` 已登记，独立工作区为 `/Users/zhongtian/.codex/worktrees/video-preview-release/codex-mobile`，分支 `codex/video-preview-release-20261021`。

发布准备阶段仅修改发布日志和状态文档，本次文档收尾也不改生产代码。若门禁发现需要修复的生产缺陷，先增加真实失败回归并确认失败原因，再做最小修复、验证转绿；不为纯发布文档编造红灯。本次视频组件与先前通过可视检查的版本一致；默认模拟器已用无夹具参数的正常包显示原带录屏对话。复用 `.mobile-build/video-image-preview-20261021/`、`.mobile-build/video-image-preview-default-20261021/`、`.mobile-build/sidebar-floating-controls-20261021/` 和 main 中项目刷新验收记录所指向的真实证据，不重建远程测试会话。

## 任务一：准备固定来源与门禁

**Files:** Modify `release/notes.md`、`docs/interaction-alignment.md`；Create 本计划；Evidence `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-video-preview/`。

- [x] 登记目标任务，使用原生工具建立独立工作区，记录 main 基线并启动30秒heartbeat。
- [x] 先执行 `npm ci`，退出码0后再执行Node门禁；安装日志为 `npm-ci.log`。
- [x] 在发布工作区执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，217项通过，真实结果保存为 `adapter-regression.log`。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，59项通过，保存 `coordinator-recovery.log`。
- [x] 在发布工作区执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，20个文件143项通过，保存 `build-contract.log`。
- [x] 执行 `npm run typecheck`，保存 `typecheck.log`；四项门禁均真实退出码0。
- [x] 更新中文发布日志，仅列实际用户变化：视频画面和文件信息行点击打开与图片一致的独立预览页；移除聊天视频下方黑色独立按钮和留白；侧栏列表可从透明悬浮按钮间隙下方滚动；项目刷新不再重复收起展开。核对实际源码与既有验收，不写分发模板内容。
- [x] 准备阶段的交互约定记录已授权双端发布、等待正式成功凭证，不预填版本；正式结果已在本次收尾就地更新，仍不把模拟器安装当作真机验收。
- [x] 写入 `validation.json`，包含精确检查名 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`，真实命令、退出码、耗时和证据路径；引用既有原生UI证据并保留真机覆盖安装与数据保留待验收限制。九个生产文件与既有证据或编译副本一致，核对结果另存 `source-evidence-comparison.json`。
- [x] 准备任务先完成规格审查，再完成质量审查，均通过；仅提交发布日志、交互记录与本计划，中文提交正文含新增功能和主要修改，准备提交为 `a407680576eb6bba16a0c5f492df3ca8fd9eee3d`。

## 任务二：协调器冻结与双端交付

**Files:** Read `docs/release-coordination.md`、现役上游 SignOs 文档；协调器生成 `.release-batch.json`、progress和receipt。

- [x] 读取当前 GitHub 用户名、固定双端旧清单与 unsigned 软件源，保存本轮更新前基线，保持现有开发者署名。
- [x] 核对最新远端 main、暂存范围及固定SHA，推送开发分支并通过 `git ls-remote` 核对完整SHA。
- [x] 将最终SHA和审查结果写入私有validation，执行 `releasectl ready --task video-image-preview-release-20261021 --sha <实际完整SHA> --validation <实际validation.json路径>`；不手改冻结清单或独立发包。
- [x] 使用单次不超过45秒的 `releasectl wait` 和定向status跟踪正式批次。网络暂时故障保留同一批次等待；永久失败保留原现场，按最新失败叶节点登记关联修复，不resume failed、不借用旧包。
- [x] 核对任务与批次complete或recovered所指成功子批次；成功receipt必须包含本任务SHA、冻结SHA、正式双端CI、iOS设备构建／签名、HTTPS OTA、固定APK／IPA、unsigned软件源及最终verify。

## 任务三：独立验收与收尾

**Files:** Create `docs/superpowers/plans/evidence/2026-10-21-video-preview-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [x] 固定Android／iOS JSON、安装包HEAD和完整GET逐一核对成功receipt中的实际版本、字节数和完整SHA-256。
- [x] 保持TLS校验，核对固定OTA安装页、latest-ios.json、manifest和版本化IPA完整下载；独立验签下载到的IPA，并核对安装身份、完整权限与钥匙串连续性。
- [x] 独立完整下载GitHub APK及unsigned IPA，核对大小和SHA-256；核对GitHub中文日志及软件源unsigned版本、构建号、URL、大小、散列、中文日志、原开发者与当前GitHub用户署名。
- [x] 保存脱敏公开凭证；就地更新现役版本入口及交互发布状态，保持模拟器、渠道验收与真机安装验收的区别。

收尾约束：文档收尾仍待主代理在共享main租约下整合、提交推送，随后使用宿主工具归档本任务工作区；实际完成情况记录于仓库外本次长期证据目录的 `closeout.json`。不清理用户仍在查看的默认模拟器。

最终交付正文必须展示固定OTA安装页 `https://192.168.123.79:8766/channels/codex-mobile/current/install.html`、固定APK与已签名IPA链接、实际版本、各自字节数及完整SHA-256。只有对应成功批次验收完成后，才宣告发布完成。

## 发布与独立回验结果

0.3.27（3027）已完成双端发布。成功批次 `ef4c6b02-7d97-4846-ba7a-64bd2b4d28d4`，冻结提交 `654b8a86a9f03e4a99b2c43e4f0012a61e1a651c`，任务来源 `a407680576eb6bba16a0c5f492df3ca8fd9eee3d`；正式双端CI `39604003362` 及开发CI `39604003447` 均成功。任务与批次均complete，无失败子批次；成功receipt的SHA-256为 `3b230e8184e7f5055410563f7fffcba064d964bfc26a57bf74fff620debfaf0b`。

独立回验九项全部通过：成功receipt及任务来源、冻结源码、LAN APK、LAN IPA、HTTPS OTA、签名连续性、GitHub Release、CI及unsigned软件源。固定双端渠道与GitHub两端安装包均完成实际完整下载，版本、字节数和SHA-256与receipt一致；HTTPS安装页、JSON、manifest及版本化IPA保持TLS校验并通过。实际下载的已签名IPA独立验签及真实兼容基准的完整权限／钥匙串连续性核对通过；unsigned软件源的0.3.27（3027）、中文日志及运行时读取的GitHub用户名署名通过，既有开发者署名保留。公开数据见[发布凭证](evidence/2026-10-21-video-preview-release.json)。

本次文档收尾复用已通过的217项适配器、59项协调器、20文件143项构建契约及类型检查；生产代码未变，不重跑客户端构建或全量测试。未部署网关，没有新建真实测试会话；人工现场、真机覆盖安装与数据保留仍待验收。main文档整合及工作区归档未在此提前记为完成。
