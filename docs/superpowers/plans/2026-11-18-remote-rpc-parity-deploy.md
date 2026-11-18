# Remote 直接读取部署计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 逐项执行；本任务由主执行者完成，不派生 agent。

**Goal:** 将已合入 main 的 Remote 前端直接 RPC 读取部署至现有网关与自带网页，核对运行版本并实测刷新、进入对话耗时。

**Architecture:** 沿用现有网关、Remote Runtime／Relay 与私有身份目录。既有 releasectl 执行 main／gateway／verify，冻结任务显式 `scope=gateway-only`、`webUi=true`；不发布手机安装包。

**Tech Stack:** TypeScript、Vitest、Python unittest、releasectl、launchd、浏览器实际 UI。

---

开始修改时 main／origin/main／HEAD 基线均为 `2521274cdd03fbcc2043105186ba89c945110034`。用户已明确要求“部署”。任务 `remote-rpc-parity-deploy-20261118` 已登记到 `codex-mobile-gateway-production`；复用现有命名分支的 linked worktree，不更改原工作区 HEAD 或 index。

### 任务 1：核对隔离与 TDD 证据

文件：已有 `tests/ui/http-transport.test.ts`、`tests/ui/app-rpc-refresh.test.tsx`、`tests/server/gateway-remote-integration.test.ts`；私有证据目录 `.mobile-build/remote-rpc-parity-20261118/` 和 `.mobile-build/remote-rpc-parity-deploy-20261118/`。

- [x] `git rev-parse HEAD origin/main --git-dir --git-common-dir --show-superproject-working-tree`：确认既有独立工作区、非子模块，已验证来源与远端 main 相同。
- [x] 复用源码阶段真实 RED→GREEN：Remote 快照探测／重投影被直接 RPC 预期拒绝，旧记录恢复耗尽原请求期限的用例先失败后修复。证据为 `parity-red.log`、`restore-budget-real-red.log`、`integrated-tests.log`；不制造部署专用生产代码或改写历史失败。
- [x] 已在最终整合来源运行 17 文件 252 项相关回归和 `npm run build`，均通过。本次仅增加计划与部署状态文档，运行代码不变。
- [x] 保存部署前现役版本、PID、9 份配置／身份文件摘要、接受目标、原工作区 HEAD／index；持续 `releasectl heartbeat --task remote-rpc-parity-deploy-20261118`。

### 任务 2：发布门禁与固定来源

文件：本计划；忽略目录中的 `checks-input.json`、检查日志、`validation.json`。

- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`：adapter-regression 通过。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 运行 `python3 -B -m unittest discover -s tests`：coordinator-recovery 通过。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`：build-contract 通过。
- [x] `npm run typecheck`：typecheck 通过；保存每项真实退出码、命令与日志 SHA-256。
- [ ] 阅读并遵守 `docs/commit-conventions.md`；`git diff --check`、`git diff --cached --check` 后提交中文说明，推送来源分支。
- [ ] 取实际完整提交 SHA 写入 `validation.json` 的 `sourceCommit`，明确 `scope=gateway-only`、`webUi=true` 与用户授权；提交同一 SHA 的 `releasectl ready`。

### 任务 3：协调部署与上线核对

文件：协调器持久 receipt、`docs/superpowers/plans/evidence/2026-11-18-remote-rpc-parity-deploy.json`、`README.md`、`docs/interaction-alignment.md`、`docs/remote-gateway-management.md`。

- [ ] 等待 main／gateway／verify 成功，核对共同 receipt、冻结提交包含本次来源、开发 CI、Web／服务端构建日志和实际安装 server／dist／bin／manifest 摘要。
- [ ] 核对 launchd 新 PID、监听与授权健康状态；比较原配置、身份、接受目标及原工作区 HEAD／index，确认 Remote online、无 pendingResume。
- [ ] 重载实际网页，确认新资源；测手动刷新至本轮读取成功结束、两台已授权 Remote 原有对话至可见正文和输入区。只观察尺寸非零的可见页面，记录失败、样本和范围；不将保留旧行或按钮停止视为成功读取。
- [ ] 核对新网页不请求 `/api/read-snapshot`；不新建会话或发送消息。如确实创建测试会话，验证完成立即归档；清理临时探针。
- [ ] 写入脱敏 receipt 与真实测量结果，按实况修订现行要求、验收状态和变更记录。成功批次完成后持共享 main 租约合入文档，核对最新远端；仅文档收尾不重复部署。

验收口径：部署成功与性能结果分别记录。单次 UI 测量不代表冷启动或 P95；本批不发布 APK／IPA，不更新软件源、LAN、签名或 OTA。
