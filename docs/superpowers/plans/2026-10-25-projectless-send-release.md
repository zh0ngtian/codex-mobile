# 无项目会话修复发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验证的无项目发送、待确认恢复及页头修复发布为统一版本的 GitHub APK 与 unsigned IPA，并核对既有 iOS 软件源及成功凭证。

**Architecture:** 复用现役 `releasectl`、`codex-mobile-github-only` 项目和 main 共享锁。当前独立 worktree 保留源码；协调器独立整合、分配版本、冻结和执行 main/build/source/verify 四阶段，以成功 receipt 为交付依据。

**Tech Stack:** TypeScript / React、SwiftUI、Vitest、Python unittest、GitHub Actions、ReleaseCoordinator。

---

开发基线为 main `491aff1a5b5a31dd6cb77993302c8eb75cb29b31`。用户本轮明确授权客户端发布；任务为 `projectless-send-github-only-20261025`。不部署网关，不启动或更新 LAN、签名、OTA、固定 APK/IPA，不读取历史签名材料。

## 任务 1：核对修复与中文发布说明

**文件：** `release/notes.md`、本计划；只读核对 `src/App.tsx`、`src/native-ui/workspace-adapter.ts`、相关测试与 `docs/interaction-alignment.md`。

- [x] 登记现役 GitHub-only 项目任务，确认独立 worktree、main 基线及当前 gh 用户。
- [x] 将本轮中文更新日志改为以下实际用户变化，不追加构建与分发模板：

```markdown
- 修复无项目会话发送结果待确认时误报“消息未发送”的问题，明确失败时显示实际错误。
- 修复无项目首条创建回执迟到后原输入不可见的问题，保留文字、引用和附件，可在同一会话继续发送。
- 修复无项目会话发送后页头变成默认目录的问题，刷新及重启后重新打开仍保持“无项目”。
```

- [x] 保存已有 RED/GREEN 证据：页头测试修复前在 `/` 与主目录上按预期失败，修复后通过；两次修复源码已提交，不重做已通过的开发验证。此次只修改发布说明与记录，不新增生产逻辑。
- [x] 依次完成独立规格审查、质量审查，按中文 Conventional Commits 提交；由 main 共享锁保护推送。

## 任务 2：发布门禁与冻结

**验证文件：** 本机私有目录 `~/Library/Application Support/ReleaseCoordinator/validations/projectless-send-20261025/validation.json`；冻结清单由协调器维护。

- [x] 持续执行 `~/.local/bin/releasectl heartbeat --task projectless-send-github-only-20261025`。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，将退出码、日志路径和 SHA-256 记录为 `adapter-regression`。
- [x] 执行 `PYTHONPATH="/Users/zhongtian/Library/Application Support/ReleaseCoordinator/runtime/c01c1841c46f98e2" python3 -B -m unittest discover -s /Users/zhongtian/WorkSpace/release-coordinator/tests -v`，记录为 `coordinator-recovery`。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录为 `build-contract`。
- [x] 执行 `npm run typecheck`，记录为 `typecheck`。四项都须真实 passed；记录本次已推送完整 SHA 与此前真实模拟器验收边界。
- [x] 核对远端 main 未引入未验证的整合，执行 `~/.local/bin/releasectl ready --task projectless-send-github-only-20261025 --sha "$(git rev-parse HEAD)" --validation "$HOME/Library/Application Support/ReleaseCoordinator/validations/projectless-send-20261025/validation.json"`；当前 HEAD 必须与验证记录及远端已推送 SHA 完全一致，不预填版本或冻结 SHA。

## 任务 3：等待发布并独立回验

**文件：** 协调器 `receipts/<batch>.json`、`artifacts/codex-mobile/<batch>/github-release.json`；成功后同步 `docs/interaction-alignment.md`、`docs/release-coordination.md` 与本计划。

- [x] 用 `~/.local/bin/releasectl wait --task projectless-send-github-only-20261025 --timeout 45` 与 `~/.local/bin/releasectl status --task projectless-send-github-only-20261025` 核对进度，不重复触发工作流或自行执行旧发布阶段。
- [x] 核对成功 receipt 包含本任务 SHA、固定冻结 SHA、唯一正式 CI run/attempt、统一新版本及四阶段成功。
- [x] 核对独立完整下载的 GitHub APK/unsigned IPA 大小及 SHA-256；凭证必须为 `distribution=github-only`、`lanApkPublished=false`，signed IPA、OTA、固定 IPA 均未发布。
- [x] 核对既有 unsigned 软件源对应版本、构建号、GitHub URL、大小、散列、中文更新日志及开发者署名；保留原开发者，缺少当前 gh 用户时追加，不复制上游部署或凭据。
- [x] 已保存脱敏公共成功凭证并同步文档的实际已发布状态；heartbeat 已退出，仅文档收尾不重复构建或部署。
- [x] 已备齐最终交付所需的统一版本、GitHub Release/APK/unsigned IPA/软件源链接、两端大小和 SHA-256，明确 IPA 未签名、由用户自行签名；真机安装和数据保留仍待用户现场验收。

收尾要求：本次文档审查通过后，继续通过 main 共享锁提交并推送文档，再交付最终链接与校验信息。

## 实际结果（2026-10-26）

- 来源 SHA：`1080f7408be6366ad5d4d649eaffa6cfaad6080a`；冻结 SHA：`c5717dbcc8fe98c93efbcc92de5cc6a02693db88`。发布说明已依次通过独立规格与质量审查，未解决问题 0；源码及说明由 main 共享锁保护推送，正式冻结与 main 推进由协调器完成。
- 任务与批次均 complete，版本 0.3.40／3040，批次 `77fbb290-6654-452d-bfba-41208136f42c`；正式 CI `40210296586`、开发 CI `40210296519` 原 attempt 成功，四阶段及成功 receipt 已核对。
- 门禁：261 项适配器回归、59 项协调器恢复回归、21 文件 151 项构建契约和类型检查通过。发布前 main 未引入额外运行代码，不重做已通过的模拟器验收。
- 独立 53 项发布核对通过，完整下载与大小／SHA-256、未签名 IPA、软件源中文日志／开发者署名及禁用渠道保持证据见[公共凭证](evidence/2026-10-25-projectless-send-release.json)。`github-release.json` 与完整成功 receipt 保存在协调器对应批次目录。
- 已有测试会话均归档；iPhone 17 Pro 模拟器真实无项目发送、刷新与冷启动从分组重开通过，冷启动搜索未命中现象仍待定位，真机安装／数据保留／现场视觉待验收。收尾仅文档与脱敏 JSON，不触发客户端构建或网关部署。
