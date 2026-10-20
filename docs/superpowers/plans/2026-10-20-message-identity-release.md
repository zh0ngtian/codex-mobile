# 消息身份修复双端发布与网关升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已通过模拟器验收的用户消息去重修复随最新 main 发布至双端固定渠道，并部署配套生产网关。

**Architecture:** 复用现役 releasectl，分别登记客户端与网关目标，ready 同一已推送的确定源码提交。协调器独占共享 main 锁，负责整合、版本分配、冻结、构建、签名和渠道部署；两个目标均取得成功 receipt 后交付。

**Tech Stack:** TypeScript、Swift、Vitest、Python unittest、GitHub Actions、Xcode、现役 ReleaseCoordinator 0.1.7。

---

开发基线：`dba4a9a716e21501fecf652c6fee192243d72e78`。用户已明确授权双端发布及网关升级；沿用附加的独立 worktree，不改写正式版本或绕过协调入口。

### Task 1：登记与准备

**Files:** 修改 `release/notes.md`；创建本计划；更新 `docs/interaction-alignment.md` 的发布状态。

- [x] 确认消息身份源码已在 main，读取最新 main 后将独立分支 fast-forward 至基线。
- [x] 登记 `message-identity-client-20261020` 与 `message-identity-gateway-20261020`，分别使用 `codex-mobile-lan-production` 和 `codex-mobile-gateway-production`。
- [x] 持续 heartbeat；更新日志仅描述用户可见变化，记录发布待验收状态。

### Task 2：回归与固定源码

**Tests:** `tests/ui/user-message-identity.test.ts`、其余消息对账相关测试、`tests/ci` 以及协调器源码仓库测试（已安装runtime仅包含运行代码，不含tests）。

- [x] 沿用前轮 TDD 红绿证据 `docs/plans/2026-10-20-user-message-identity-reconciliation.md`，本轮不新增生产逻辑；出现问题时先补失败回归再修复。
- [x] 运行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'` 和 `/Users/zhongtian/WorkSpace/release-coordinator` 中的 `python3 -B -m unittest discover -s tests`，212项与59项全部通过。
- [x] 使用 `NODE_OPTIONS=--no-experimental-webstorage` 运行消息身份范围与 `tests/ci` 的 Vitest，35文件535项全部通过。
- [x] 运行 `npm run typecheck` 与 `npm run build:server`，退出 0；复用前轮当前 iPhone 17 Pro 的四项 UI 验收及代码块增量已有验收记录。
- [ ] 核对 `git diff --check`，按中文 Conventional Commits 提交更新说明和计划，推送独立分支，将可定位日志写入仓库外 validation.json。

### Task 3：协调发布与部署

**Files:** `.release-batch.json` 和正式版本由协调器生成；不手写。

- [ ] 两个任务 ready 同一已推送完整 SHA；使用 `releasectl status/wait/batch` 跟踪。
- [ ] 等待客户端 `main/build/iosbuild/sign/ota/apk/ipa/source/verify` 和网关 `main/gateway/verify` 阶段完成。
- [ ] 失败保持原批次不可变；查明原因并通过必要 TDD 修复后，显式关联最新失败叶节点创建修复任务。

### Task 4：最终回验与记录

**Files:** 本计划和 `docs/interaction-alignment.md` 在成功凭证后同步实际状态。

- [ ] 读取两个成功 receipt，核对任务源码包含关系、实际冻结 SHA、渠道文件大小与 SHA-256、签名身份、软件源版本及中文更新日志。
- [ ] 核对生产网关文件摘要、launchd PID、监听端口和认证状态接口。
- [ ] 确认无遗留测试会话；交付固定 OTA 安装页、APK 与已签名 IPA 的链接、版本、大小、SHA-256；不将模拟器验收描述为真机覆盖安装验证。

状态：本地发布检查通过，待固定提交及协调器发布。本轮初始协调器测试命令误指向不含tests的已安装runtime，仅发现阶段报错，改用源码仓库后59项通过；保留两次日志，不修改协调器运行代码。完整检查日志保存在本机 `~/Library/Application Support/ReleaseCoordinator/validations/message-identity-release-20261020/`。
