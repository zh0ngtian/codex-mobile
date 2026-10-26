# 新会话创建待确认修复发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的新会话创建修复发布为同一版本的 GitHub APK 与 unsigned IPA，并核对既有 iOS 软件源和成功 receipt。

**Architecture:** 复用现役 `releasectl`、`codex-mobile-github-only` 项目及 `codex-mobile-main-production` 共享锁；协调器负责整合、版本分配、冻结和 main/build/source/verify 四阶段。只发布客户端，不部署网关，不启用 LAN、签名、OTA 或固定 IPA。

**Tech Stack:** TypeScript、React、Vitest、Playwright、iOS Simulator、Python unittest、GitHub Actions、ReleaseCoordinator。

---

开始修改的 main 基线为 `ae57f0f4c76ad09f4718de72b09822802a9c3ee3`，已核对远端一致；修复源码及[验收证据](evidence/2026-10-26-new-thread-creation-recovery.json)已推送。发布任务为 `new-thread-creation-github-only-20261026`，项目 `codex-mobile-github-only`。复用当前隔离 worktree，主工作区原暂存内容不动。

## 任务 1：发布说明与已有 TDD 证据

**文件：** 修改 `release/notes.md` 和本计划；只读核对 `src/App.tsx`、`src/app-server/client.ts`、`src/backends/http-transport.ts`、`tests/ui/http-transport.test.ts`、`tests/e2e/http-polling.spec.ts` 及交互约定。

- [x] 登记现役客户端项目任务，核对 main 基线与现有协调器健康状态。
- [x] 将 `release/notes.md` 精确更新为本次用户可感知的修复，不沿用上一版本变化或追加构建模板：

```markdown
- 修复新建会话一直停在“待确认”、无法发送首条消息的问题，有项目和无项目会话均可正常创建。
```

- [x] 将 `.mobile-build/new-thread-uncertain-20261026/` 的 `regression-red.log`、`regression-green.log`、`client-regression.log`、`new-chat-regression.log`、`reconnect-regression.log`、`e2e.log`、`typecheck.log`、`build.log`、`archive-confirmation.json` 及 `native-test-summary.json` 逐字节复制至本机私有验证目录并核对 SHA-256。复用新增 3 项先失败后通过、167 项相关回归、2 项页面回归和模拟器真实发送验收，不为仅发布说明新增生产代码。
- [x] 独立规格审查 `new_thread_release_spec` 与质量审查 `new_thread_release_quality` 通过，未解决问题为 0；修复来源 `ae57f0f4c76ad09f4718de72b09822802a9c3ee3` 已包含于推送来源 SHA。
- [x] 按中文 Conventional Commits 提交并使用共享 main 锁推送固定来源 SHA；来源为 `d1ecf0796377950aac76b2faf2c6b665f4af8fb6`，冻结提交为 `85d9ad4f6e64b9d3bf46ecc264ec82959751f059`。

## 任务 2：门禁与冻结

**私有验证目录：** `~/Library/Application Support/ReleaseCoordinator/validations/new-thread-creation-20261026/`。冻结清单只由协调器维护，不预填版本。

- [x] 持续 heartbeat：`~/.local/bin/releasectl heartbeat --task new-thread-creation-github-only-20261026`。
- [x] `adapter-regression`：执行 `/opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录真实退出码、日志位置及 SHA-256。
- [x] `coordinator-recovery`：执行 `PYTHONPATH="/Users/zhongtian/Library/Application Support/ReleaseCoordinator/runtime/c01c1841c46f98e2" /opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s /Users/zhongtian/WorkSpace/release-coordinator/tests -v`。
- [x] `build-contract`：执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`。
- [x] `typecheck`：执行 `npm run typecheck`。
- [x] 将四项 passed 记录、已有 TDD 与模拟器证据、审查结论及已推送来源 SHA 写入私有 `validation.json`。核对最新远端 main；有额外运行代码时先整合并做相关回归，再固定提交。
- [x] 执行 `~/.local/bin/releasectl ready --task new-thread-creation-github-only-20261026 --sha "$(git rev-parse HEAD)" --validation "$HOME/Library/Application Support/ReleaseCoordinator/validations/new-thread-creation-20261026/validation.json"`，由协调器分配版本、冻结和推进 main。

## 任务 3：渠道回验与交付

**文件：** 成功 receipt、对应 artifacts 的 `github-release.json`；成功后同步 README、文档索引、`docs/interaction-alignment.md`、`docs/release-coordination.md` 和本计划，并新增脱敏公共证据。

- [x] 使用 `~/.local/bin/releasectl wait --task new-thread-creation-github-only-20261026 --timeout 45` 和同任务 `status` 等待，不重复触发正式工作流；失败批次保留不可变现场，必要时按同项目关联修复处理。
- [x] 核对任务与批次均 complete，receipt 的来源 SHA、冻结 SHA、任务、正式 CI run/attempt、开发 CI、统一版本及四阶段一致。
- [x] 核对独立完整下载的 GitHub 两端文件大小与 SHA-256，检查 IPA 实际版本及未签名状态；保存 `distribution=github-only`、`lanApkPublished=false`，同时核对 signed IPA／OTA／固定 IPA 均未发布。
- [x] 读取既有软件源最新公开内容，核对 App 身份、版本、构建号、GitHub URL、大小、散列与上述中文更新日志；从当前 gh 登录账号读取用户名，保留原开发者，已有则保持原值，缺少时追加。
- [x] 核对历史四个 LAN 文件散列未变，8765／8766 无监听且 launchd disabled；不读取签名材料，不部署网关，不启动历史分发服务。
- [x] 保存脱敏公共证据并同步真实发布状态；仅文档收尾不重复构建或部署。成功后停止 heartbeat。
- [x] 文档收尾独立规格审查 `new_thread_closeout_spec` 与质量审查 `new_thread_closeout_quality` 均通过，未解决问题为 0。
- [x] 已将统一版本、GitHub Release／APK／unsigned IPA／软件源链接及两端大小与完整 SHA-256写入公共凭证；明确 IPA 未签名、用户自行签名，真机交互、安装与数据保留仍待现场验收，不把模拟器或下载校验当作真机覆盖安装证明。

## 收尾要求（非检查项）

根代理完成独立审查后，须在 `codex-mobile-main-production` 共享锁内提交并推送文档收尾，再完成最终交付回复。
