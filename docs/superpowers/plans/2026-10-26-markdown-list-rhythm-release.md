# 列表排版统一客户端发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的列表排版统一改动发布为同版本GitHub APK与unsigned IPA，并核对既有iOS软件源和最终成功receipt。

**Architecture:** 复用现役 `releasectl`、`codex-mobile-github-only` 项目与 `codex-mobile-main-production` 共享锁，由协调器整合、分配版本、冻结并执行main/build/source/verify。复用本对话隔离worktree与已通过的9项iPhone 17 Pro排版／选文回归，本轮不新增客户端运行逻辑，不部署网关或启用历史LAN／签名／OTA。

**Tech Stack:** SwiftUI、TextKit、XCTest、TypeScript、Vitest、Python unittest、GitHub Actions、ReleaseCoordinator。

---

发布基线与已验证源码为 `aa6a27d13aae874430f177116129226784f7aafd`。任务 `markdown-list-rhythm-github-only-20261026` 已登记现役客户端项目。私有验证目录为 `~/Library/Application Support/ReleaseCoordinator/validations/markdown-list-rhythm-20261026/`；主工作区原有暂存内容保留。

## 任务1：发布输入、计划与更新日志

**文件：** 修改 `release/notes.md`、本计划及 `docs/interaction-alignment.md` 的发布状态；私有目录新增发布输入审计脚本和证据。

- [x] 记录基线、核对隔离worktree与现役协调器健康，登记任务并启动持续heartbeat。
- [x] 先写发布输入审计，要求更新日志精确包含本次变化、策略为GitHub-only、来源包含上述已验证SHA、原生9项验证证据和两个运行文件散列匹配。对上一版“新会话创建修复”日志运行并记录预期RED，仅失败于本次更新日志尚未准备。
- [x] 更新 `release/notes.md` 为以下用户可感知内容，并运行同一审计记录GREEN：

```markdown
- 优化 iOS 回复中的列表排版：有序、无序、任务和嵌套列表采用一致的紧凑行距。
- 调整列表与正文、独立链接及标题之间的留白，改善长条目和续行的阅读体验。
```

- [x] 核对 `.mobile-build/markdown-list-spacing-20261026/unified-rhythm/` 的原生9项验证、TextKit测量、三段截图及来源散列，将证据完整保存至私有目录。不将既有视觉改动声称为本轮重新TDD实现；本轮RED/GREEN针对发布说明与输入。14个开发证据副本散列一致；RED退出1且仅日志失败，GREEN退出0、8项全部通过。
- [x] 进行独立规格审查，再进行质量审查；`release_spec_review` 与 `release_quality_review` 均通过，P0至P3无未解决问题。
- [x] 来源 `2ad2784c2def46e9f65b7eabb45f08bbe6f597c1` 已推送任务分支，main由协调器推进。

## 任务2：四项发布门禁与ready

**文件：** 私有目录的四项日志与 `validation.json`；不手写 `.release-batch.json` 或正式版本。

- [x] 安装锁定依赖：`npm ci`。
- [x] `adapter-regression`：`/opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s tests/ci -p 'test_*.py'`，261项通过。
- [x] `coordinator-recovery`：使用已安装runtime的 `PYTHONPATH` 执行 `/opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s /Users/zhongtian/WorkSpace/release-coordinator/tests -v`，59项通过。
- [x] `build-contract`：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，21文件151项通过。
- [x] `typecheck`：`npm run typecheck`，退出0。
- [x] 逐项记录命令、真实退出码、日志路径、散列及耗时，连同来源SHA、已验证原生证据和审查结论写入私有 `validation.json`。核对最新远端main；如有新增运行内容，先整合并执行相关回归。
- [x] `releasectl heartbeat --task markdown-list-rhythm-github-only-20261026 --state closing`，随后 `releasectl ready --task markdown-list-rhythm-github-only-20261026 --sha <实际已推送40位SHA> --validation <上述私有validation.json>`。命令中的SHA与路径取实际已核对值，不预填正式版本。

## 任务3：协调发布、渠道验收与收尾

**文件：** 协调器成功receipt、对应artifacts的 `github-release.json`；成功后新增 `docs/superpowers/plans/evidence/2026-10-26-markdown-list-rhythm-release.json`，同步交互约定、README、文档索引、发布协调说明和本计划。

- [x] 以 `releasectl wait --task markdown-list-rhythm-github-only-20261026 --timeout 45` 等待，按同任务status核对冻结版本、SHA、CI run／attempt及阶段，不额外触发正式工作流。
- [x] 以原任务complete或明确关联修复成功receipt为完成条件。不可变失败保留原现场；仅在有真实故障时按同项目最新失败叶节点登记关联修复，不改旧版本或旧SHA。
- [x] 核对main/build/source/verify、来源祖先、GitHub双端Release和必要开发CI；独立完整下载APK／unsigned IPA，核对实际版本、大小、SHA-256及IPA未签名。
- [x] 读取SignOs软件源最新版说明，再核对既有unsigned订阅的版本、构建号、GitHub URL、大小、散列、上述中文日志及开发者署名；从当前gh登录账号读取用户名并保留原署名。
- [x] 核对 `distribution=github-only`、`lanApkPublished=false`，以及signed IPA／OTA／固定IPA均未发布。历史四个LAN文件散列保持，8765／8766不监听、服务disabled；不读取签名材料或部署网关。
- [x] 保存脱敏公共凭证并同步真实发布状态，独立规格与质量收尾审查均通过；本收尾提交在共享main锁内推送，并以远端main回读确认，不再次构建或发包。
- [x] 任务complete后heartbeat已停止；交付所需的本次GitHub Release、APK、unsigned IPA、iOS软件源链接、统一版本、两端大小与完整SHA-256已核对齐全，IPA未签名及真机验收边界见下方结果与最终回复。


## 实际发布结果

- 任务及批次均complete：`markdown-list-rhythm-github-only-20261026`／`cdf0af2b-8f2d-4bfd-940a-c71e06a6c803`；版本0.3.42（3042）。
- 固定来源 `2ad2784c2def46e9f65b7eabb45f08bbe6f597c1`，冻结 `328023309b482856eacb93e4d0b4e3a93d6317ea`，包含已验证修复 `aa6a27d13aae874430f177116129226784f7aafd`。正式CI `40327681715`、开发CI `40327681710` 均attempt 1成功。
- 发布输入RED／GREEN按预期完成；ready四门禁分别为261项适配器回归、59项协调器回归、21文件151项构建契约及typecheck，均通过。提交ready时远端main仍为记录基线，冻结仅增加批次清单，运行源码与原生9项验证副本散列一致。
- 独立82项验收全部通过；[公共凭证](evidence/2026-10-26-markdown-list-rhythm-release.json)记录成功receipt摘要、双端下载大小与散列、CI及软件源结果。APK为4,754,263字节，unsigned IPA为5,029,378字节；IPA实际版本和构建号一致且无签名资源。
- 既有unsigned软件源订阅、appID和开发者署名保留；GitHub与软件源实际展示本次两行中文更新日志。历史LAN四文件未改写，8765／8766无监听，两服务保持停止和disabled。
- 仅发布GitHub APK／unsigned IPA并核对既有软件源；未发布LAN包、signed IPA、OTA或固定IPA，未部署网关。原生回归沿用已完成的9项模拟器证据，本轮未重跑UI测试；没有真实测试会话，真机安装、数据保留和列表视觉仍待验收。

收尾审查：`release_spec_review` 与 `release_quality_review` 均通过，P0至P3无未解决问题；23份审计文件散列匹配，13个新增文档链接有效。82项独立检查由81项渠道核对和1项公共凭证脱敏检查组成。正式发布后仅提交文档与公共凭证。
