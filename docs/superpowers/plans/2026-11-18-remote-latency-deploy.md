# Remote 延迟修复部署计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 逐项执行；按仓库要求由主执行者验证，不使用独立 agent。

**Goal:** 将已验证的 Remote 延迟修复部署到现有网关与自带网页，并实测刷新完成和进入会话的耗时。

**Architecture:** 继续现有唯一 Runtime／Relay 和私有身份目录，通过既有 releasectl 的 main／gateway／verify 阶段更新 server 与 dist。使用已有独立工作区，保留原配置、token、授权、双机配对和其他工作区改动，不发布手机包。

**Tech Stack:** TypeScript、Vitest、Python unittest、releasectl、launchd、浏览器实际 UI。

---

基线：本地 main `7772b28f5e716d8e5e3759fb1e84a089158502ec`；部署起点 origin/main／HEAD `7583b90053a63390370cb46d8772332119146133`。已登记 `remote-latency-deploy-20261118`，项目 `codex-mobile-gateway-production`，明确 `webUi=true`。

### 任务 1：复核隔离和修复证据

文件：`docs/superpowers/plans/evidence/2026-11-18-remote-latency-fix.json`；已有 `tests/server/http-session-remote.test.ts`、`tests/server/gateway-remote-integration.test.ts` 与 `tests/ui/http-transport.test.ts`。

- [x] `git rev-parse --git-dir --git-common-dir --show-superproject-working-tree`：确认已有命名分支的 linked worktree，不新建嵌套工作区。
- [x] `git fetch origin main`：确认部署起点和已验证源码相同。
- [x] 保留 TDD 的真实 RED：读取 20 次校验而期望 5 次、快照 7 次而期望 4 次、新能力／失败／预算测试失败；修复后的 367 项回归及受控前后比较已在前述证据记录。不改写或重新制造历史失败。
- [x] `npm ci`：按锁文件恢复部署验证依赖。
- [x] 保存部署前现役 PID、原配置和有效身份／接受目标文件摘要，以及原工作区 HEAD 和 index 摘要；私有值只存在仓库外或忽略目录。

### 任务 2：运行部署门禁并提交固定来源

文件：`.mobile-build/remote-latency-deploy-20261118/` 中私有日志与验证 JSON；本计划与 `docs/interaction-alignment.md` 的部署进度。

- [x] `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`：适配器回归通过。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 运行 `python3 -B -m unittest discover -s tests`：协调器恢复回归通过。
- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`：构建契约通过。
- [x] `npm run typecheck`：类型检查通过；检查命令、日志 SHA-256、退出码均写入验证 JSON。
- [ ] `git diff --check`、`git diff --cached --check`，提交中文 Conventional Commit；更新仅计划／状态文档不触发额外客户端构建。
- [ ] 推送来源分支固定 SHA；`releasectl ready --task remote-latency-deploy-20261118 --sha <实际完整SHA> --validation <实际私有验证文件>`。来源 SHA 必须取本次提交实际输出，不能硬编码预测值。

### 任务 3：协调部署和实际验收

文件：协调器共同 receipt、`.mobile-build/remote-latency-deploy-20261118/` 实测，以及公开脱敏部署证据。

- [ ] 等待协调器 main／gateway／verify 成功；核对持久 receipt、冻结 SHA、包含来源、实际 server／dist／bin／manifest 摘要和 launchd PID。
- [ ] 比较原配置、token、有效身份及配对摘要；检查原工作区 HEAD／index 未变，Remote online，无新增 pendingResume。
- [ ] 浏览器重载现役网页，确认声明的新能力已生效；对两台已授权 Remote 测侧栏手动刷新结束及原有会话正文可见。记录成功或失败、完整耗时与缓存状态，不把按钮停止或旧正文可见当成上游成功刷新。
- [ ] 无推理、新建测试会话；如为排错确有测试会话，验证后及时归档。
- [ ] 将 receipt 与真实计时的脱敏结果写入 `docs/superpowers/plans/evidence/2026-11-18-remote-latency-deploy.json`；更新 `docs/interaction-alignment.md` 和 `docs/remote-gateway-management.md` 实际状态。
- [ ] 持共享 main 写入租约、核对最新远端后提交推送文档。只有成功 receipt 和实际核对完成后报告部署成功；性能改善单独据实报告，不报告未经验证的 P95。

部署前 9 份私有配置／身份文件及原工作区 HEAD／index 摘要已保存；Remote online、两台已接受目标在线、pendingResume 为空。四项部署门禁实际通过，日志、退出码及摘要保存在忽略的部署验证目录。
