# 侧栏与对话页顶部按钮对齐双端发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的顶部按钮对齐修复发布到双端固定渠道，核对成功批次和实际下载包。

**Architecture:** 复用现役 `releasectl` 的 `codex-mobile-lan-production`，协调器持有共享 main 锁、整合源码、分配版本并完成双端构建、Ad Hoc 签名和全部渠道验收。发布负责人准备固定 SHA、真实门禁材料并独立回验；本次不部署网关。

**Tech Stack:** Git、Python unittest、Vitest、TypeScript、GitHub Actions、Xcode、Ad Hoc、HTTPS OTA、固定 LAN 与既有 unsigned 软件源订阅。

---

用户已明确授权“发布”，按仓库默认范围执行双端。基线为 `ce52a9ea7545fcfe8ba1bbc2e8fd16724b2008ee`；任务 `sidebar-header-alignment-release-20261021` 已登记，独立工作区为 `/Users/zhongtian/.codex/worktrees/sidebar-header-alignment-release/codex-mobile`。验证材料保存在 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261021-sidebar-header-alignment/`。

既有 TDD 证据位于长期主工作区 `.mobile-build/sidebar-header-alignment-20261021/`：先加入 `testSidebarControlsAlignWithConversationHeader`，旧版实际中心差8.5pt导致失败；最小修复后对齐、按钮等高、透明间隙滚动三项UI回归通过，中心误差0.167pt。此次发布准备只修改文档和中文日志，逐字节核对这两个生产文件与已验收散列一致，不为文档编造失败测试。若发布前发现必须修复的生产缺陷，先增加真实失败回归再修复并转绿。

## 任务一：准备发布来源与门禁

**Files:** Modify `release/notes.md`、`docs/interaction-alignment.md`；Create 本计划；Evidence 本轮私有验证目录。

- [x] 登记双端任务，使用宿主原生工具建立独立工作区，记录 main 基线并启动30秒heartbeat。
- [x] 执行 `npm ci`，记录真实命令、退出码和耗时；成功后运行Node门禁。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，保存 `adapter-regression.log`。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，保存 `coordinator-recovery.log`。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，保存 `build-contract.log`。
- [x] 执行 `npm run typecheck`，保存 `typecheck.log`；上述四项门禁必须真实退出码0。
- [x] 核对两个生产文件与既有 `validation.json` 的编译散列，记录baseline／fixed xcresult和三项UI结果。
- [x] 中文更新日志仅写“修复 iOS 侧栏展开后顶部按钮与对话页菜单按钮不在同一水平线的问题。”；交互文档记录已授权双端发布、待成功凭证，不提前填写新版本。
- [x] 读取当前GitHub用户名、固定双端清单、GitHub最近Release、软件源及SignOs上游最新文档，保存发布前基线并保留既有开发者署名。
- [x] 写入 `validation.json`，包含 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck` 的真实passed结果和证据路径。
- [x] 先规格审查、再质量审查，均通过后推送准备提交并提交ready；准备提交 `066ffa8d87582bfe0c98445a24ab68a28fdb405d` 仅包含上述三份发布文件，使用中文Conventional Commits正文。

任务一执行记录：`npm ci` 退出码0（3.348秒）；217项适配器回归退出码0（12.656秒）、59项协调器恢复回归退出码0（40.949秒）、20文件143项构建契约退出码0（28.896秒）、类型检查退出码0（4.707秒）。真实命令、cwd、起止时间、耗时与独立日志已保存至本轮私有 `validation.json`。两个Swift生产文件与已验收编译副本逐字节及 `compiledSourceSha256` 一致，核对结果见 `source-evidence-comparison.json`；读取原始结果包确认baseline新增对齐用例因92.5pt与84pt差异失败，fixed三项通过、中心84.167pt与84pt。发布前固定双端、GitHub及unsigned软件源均为0.3.27，基线由主代理采集，本轮已核对文件存在及内容；现有开发者署名已包含运行时GitHub用户名，保持原值。准备阶段的规格与质量审查均已通过，固定准备提交已推送并提交ready；本轮不改生产代码、不重新运行UI。

## 任务二：协调器正式发布

**Files:** Read `docs/release-coordination.md`；协调器生成 `.release-batch.json` 与本批progress／receipt。

- [x] 核对最新远端main、提交范围与完整SHA，将发布分支推送远端并使用 `git ls-remote` 回验；未把主工作区其他暂存修改带入本次提交。
- [x] 将实际完整SHA与审查记录写入私有validation；调用 `~/.local/bin/releasectl ready --task sidebar-header-alignment-release-20261021 --sha "$task_sha" --validation "$validation_file"`，变量从实际提交与本轮验证文件取得。
- [x] 定向status跟踪同一正式批次并核对最终complete；受限等待遵循单次不超过45秒的约束，本轮无失败子批次，未重发独立安装包。暂时网络故障保留冻结身份，永久失败保留现场并按最新失败叶节点关联修复。
- [x] 核对任务与批次complete、error为null，其成功receipt包含本任务SHA、冻结源码、正式双端CI、本机iOS设备构建和签名、HTTPS OTA、固定APK／IPA、unsigned软件源及必要开发CI。

## 任务三：独立回验与交付

**Files:** Create `docs/superpowers/plans/evidence/2026-10-21-sidebar-header-alignment-release.json`；Modify 本计划、`docs/interaction-alignment.md`、`README.md`、`docs/README.md`。

- [x] 固定Android／iOS JSON、安装包HEAD和完整GET核对实际版本、字节数和完整SHA-256。
- [x] 保持TLS校验核对固定OTA安装页、iOS JSON、manifest、版本化IPA完整下载；实际下载IPA独立验签，与真实基准核对Bundle ID、Team、application-identifier及完整权限／钥匙串连续性。
- [x] 独立完整下载GitHub APK和unsigned IPA，核对receipt的大小与SHA-256；核对GitHub及软件源的中文日志、unsigned版本／构建号／URL／散列，保留原开发者并包含当前GitHub用户名。
- [x] 保存脱敏公开凭证，更新交互文档与现役版本入口；生产源码未变化，复用同源码已通过的四项门禁和三项UI证据。
- [ ] 主代理完成文档收尾的规格、质量及最终凭证审查，在共享main租约下整合文档并推送。
- [x] 本任务heartbeat已由主代理停止；本轮没有新建远程测试会话，未把渠道回验或模拟器结果描述为真机覆盖安装与数据保留验收。
- [ ] 主代理使用宿主工具归档工作区。

交付正文必须展示固定OTA安装页 `https://192.168.123.79:8766/channels/codex-mobile/current/install.html`，以及固定APK、已签名IPA、实际版本、各自字节数和完整SHA-256。成功receipt和独立回验完成前不宣告发布完成。


## 发布与独立回验结果

任务始于2026-10-21，已于2026-10-22（Asia/Shanghai）跨日完成0.3.28（3028）双端发布。成功批次 `d37656b1-07e2-4a58-a38c-d11ae18036f3`，冻结提交 `c4d1ea4688ae51a25bf3ce101d67529b1f637dde`，任务来源 `066ffa8d87582bfe0c98445a24ab68a28fdb405d`；任务与批次均complete、error为null，无失败子批次。正式双端CI `39629454348` 和同冻结提交的开发CI `39629454335` 均成功，成功receipt的SHA-256为 `7587b7a5a9629df1cb25d669a33ae5f8730599a934c054abff5c571fc7333b1a`。

独立回验脚本真实退出码0，九项全部通过：成功receipt及任务来源、冻结源码、LAN APK、LAN IPA、HTTPS OTA、签名连续性、GitHub Release、CI及unsigned软件源。固定双端JSON、HEAD及完整GET、HTTPS安装页／JSON／manifest／版本化IPA、GitHub APK及unsigned IPA的实际完整下载均已核对；项目CA的TLS校验保持开启。真实下载的已签名IPA与真实兼容基准的身份、完整entitlements及钥匙串连续性通过；unsigned软件源保持原订阅，0.3.28（3028）、URL、大小、散列、单条中文日志及运行时GitHub用户名署名均匹配，原开发者完整保留，未订阅Ad Hoc已签名包。公开数据见[发布凭证](evidence/2026-10-21-sidebar-header-alignment-release.json)。

实际固定APK为4,748,911字节，SHA-256 `ad1e8c9b6484b3fe3a39c9c654f641fea7e13efc6919774eebb1a32f43438a52`；固定IPA为Ad Hoc已签名包，4,850,163字节，SHA-256 `6ca05dabac809969bf7371e6d713ffef0d7bbe009d825ec32ef432d7121791c7`。

独立回验通过后，发布工作区fetch确认远端main正好是本批冻结提交，无新增其他提交，并将工作分支fast-forward至该提交再开始五份文档收尾。仅修改README、文档索引、交互约定、本计划及公开凭证；不改发布日志或生产源码，不重新构建或发包。复用217项适配器、59项协调器、20文件143项构建契约及类型检查的真实成功结果；同生产源码UI证据复用顶部按钮对齐、按钮等高、透明间隙滚动三项，旧版中心差8.5pt的真实失败与修复后0.167pt的通过结果均保留。

本轮未部署网关，没有新建远程测试会话；人工现场、真机覆盖安装和数据保留仍待验收。文档收尾的最终规格／质量与凭证审查、共享main租约整合推送及工作区归档仍交由主代理完成；heartbeat已由主代理停止，此处不提前标记。
