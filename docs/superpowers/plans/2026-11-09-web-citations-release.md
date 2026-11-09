# 网页来源引用修复发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的网页引用编号修复发布为 GitHub APK 和未签名 IPA，同步既有 iOS 软件源并部署配套网关。

**Architecture:** 复用隔离 worktree、现役 releasectl 与同一个状态库；客户端 `codex-mobile-github-only` 和网关 `codex-mobile-gateway-production` 登记独立任务并 ready 同一已推送来源 SHA，共用 `codex-mobile-main-production` 锁。版本、冻结、main 推进及渠道验收由协调器处理；两个成功 receipt 均核对后交付。本轮不修改运行代码，不启用 LAN、签名或 OTA。

**Tech Stack:** TypeScript、Vitest、SwiftUI、XCTest、Python unittest、GitHub Actions、ReleaseCoordinator。

---

发布 main 基线及已验证修复为 `bc853fbe5877029b8bb54fa35b6aa3449e258bdd`。用户选择现行 GitHub 双端渠道并授权同步网关部署；任务分别为 `web-citations-github-only-20261109`、`web-citations-gateway-20261109`。复用开发 worktree `/Users/zhongtian/.codex/worktrees/web-citations/codex-mobile`，保留主工作区已有暂存修改。私有证据位于 `~/Library/Application Support/ReleaseCoordinator/validations/web-citations-20261109/`。

## 任务一：输入与 TDD 审计

**文件：** `release/notes.md`、本计划、`docs/interaction-alignment.md`；私有证据目录的 `audit-input.py` 与日志。

- [x] 登记两个发布目标，核对远端 main 与修复 SHA 一致，持续 heartbeat。
- [x] 先写输入审计，核对 GitHub-only 策略、修复祖先、运行源码未变、现有两项 iPhone 17 Pro XCTest 和本版中文日志。对旧日志运行 `python3 "$HOME/Library/Application Support/ReleaseCoordinator/validations/web-citations-20261109/audit-input.py"`，退出 1 且仅 `release-notes` 失败（RED）。
- [x] 将 `release/notes.md` 更新为以下真实用户变化，再运行同一审计，预期五项全通过（GREEN）：

```markdown
- 修复回答中网页来源引用显示异常的问题，将内部标记显示为可点击的来源编号。
- 同一回答重复引用同一网页时沿用编号，历史加载、重连和新回复保持一致。
```

- [x] 以 `git diff --check`、运行代码差异、中文日志与 GitHub-only 四阶段合同核对规格和质量。源码已完成，不将发布输入的 RED/GREEN 声称为重新实现运行代码。

## 任务二：门禁与固定来源

**文件：** 私有证据目录的 `run-gates.py`、各项日志、`gates.json`、`validation.json`。不手写正式版本或 `.release-batch.json`。

- [x] 执行 `python3 "$HOME/Library/Application Support/ReleaseCoordinator/validations/web-citations-20261109/run-gates.py"`；记录真实命令、退出码、耗时、日志和散列。
- [x] 必需门禁：Python `tests/ci/test_*.py` 发布回归、已安装 runtime 的协调器恢复回归、`npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`；追加引用范围 13 文件回归与 `npm run build:server`。
- [x] 已有 iPhone 17 Pro／iOS 27 正常字号竖屏两项 XCTest 的 xcresult 摘要核对 passed=2、failed=0，截图及源文件关联保留；本轮运行源码无变化，复用既有验收。
- [ ] 提交计划和发布说明，推送任务分支；ready 前再次核对最新远端 main。如出现新运行代码，先整合并运行相关回归。
- [ ] 将同一已推送 40 位 SHA 及含四项 passed checks 的私有验证文件提交两个目标的 ready；主分支由协调器整合。

## 任务三：发布、部署与回验

**文件：** 两个目标成功 receipt、各自 artifacts，客户端 `github-release.json`；成功后新增 `docs/superpowers/plans/evidence/2026-11-09-web-citations-release.json` 并同步 README、文档索引、交互约定和发布协调说明。

- [ ] 以 `releasectl wait --task web-citations-github-only-20261109 --timeout 45` 和对应 gateway task 等待，不额外触发正式工作流。不可变失败按现有合同登记关联修复，不修改旧批次。
- [ ] 客户端核对 main/build/source/verify、来源 SHA 包含关系、正式和开发 CI、同版本 APK／未签名 IPA 的独立完整下载大小与 SHA-256、实际 IPA 版本与无签名资源。
- [ ] 读取 SignOs 软件源现行上游说明，核对既有 unsigned 订阅、当前 gh 用户、原署名保留、版本、URL、大小、散列和上述中文更新日志。
- [ ] 网关核对 main/gateway/verify、server/bin 实际文件摘要、launchd PID／命令、监听和认证健康接口；以部署后的目标会话只读数据核对来源网址，不发送消息或归档用户原会话。
- [ ] 核对 GitHub-only、LAN 未发布、signed IPA／OTA／固定 IPA 均未发布、历史文件未改及 8765／8766 停止状态；不读取签名材料。
- [ ] 两个成功 receipt 核对后，更新交付文档、保存公共脱敏凭证。在共享 main 锁下合入文档并推送，文档收尾不再构建发布或部署。
- [ ] 最终回复提供版本、GitHub Release、APK、未签名 IPA 和软件源链接，以及两端大小和 SHA-256；明确真机安装及数据保留尚未验收。

本轮门禁实测：发布回归261项、协调器恢复59项、构建契约21文件151项、引用范围13文件262项全通过，类型检查及服务端构建退出0。发布输入RED仅旧更新日志失败，GREEN五项全通过。规格与质量自审确认仅修改计划、状态和发布日志，无新运行代码、版本手填或历史渠道操作。
