# 本地打开会话性能修复现役部署计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将已完成 TDD 的本地读取修复部署到现役 Mac 网关，并实测同一会话的本地 HTTP/WS 读取及实际网页打开速度。

**Architecture:** 沿现有 releasectl 的 gateway-only 任务更新唯一 launchd 网关；不改业务源码或部署入口，不更新现役前端资源。直接使用已合入 main 的本地 Session 读取修复，保留共享写队列和 Remote 身份。

**Tech Stack:** Node.js/TypeScript、Vitest、Python 3.11、releasectl、launchd、浏览器。

基线 main：`dcb493df723aa162bd9185c05e02158999cfdbb2`。任务：`local-dialog-performance-deploy-20261117`，项目：`codex-mobile-gateway-production`，`scope=gateway-only`，`webUi=false`。当前独立 worktree 继续复用；由主执行者执行、检查，不使用独立 agent。

## 任务 1：部署前证据与 TDD

文件：复用 `tests/server/gateway-local-read.test.ts` 和 `docs/superpowers/plans/evidence/2026-11-17-local-dialog-performance.json`；仓库外脚本及完整日志存入 `/private/tmp/codex-local-dialog-deploy-20261117`。

- [x] 核对现役 deployment marker、PID、启动配置摘要和网页资源摘要，记录 Remote 已有授权状态，绝不打印 token。
- [x] 对同一既有会话执行只读 initialize、thread/read、thread/turns/list；修复后每个读取重复3次，记录 HTTP/WS 分项毫秒；旧版首次失败或超限即记为 RED 并停止，避免继续增加旧账本压力。验收条件：每次本地读取均低于1000ms；旧代码超过条件记为 RED。原源码已有真实队列锁3项 RED、修复后5项 GREEN 的 TDD 证据继续保留。
- [x] 执行 `npx vitest run tests/server/gateway-local-read.test.ts tests/server/gateway-queued-rpc.test.ts tests/server/gateway-remote-integration.test.ts tests/server/gateway-scheduler-services.test.ts tests/server/thread-observer.test.ts --fileParallelism=false --testTimeout=15000`；要求本次相关回归通过。

## 任务 2：四项部署门禁及固定来源

文件：新增本计划；仓库外 validation JSON 由真实日志生成。

- [x] `adapter-regression`：`/opt/homebrew/opt/python@3.11/bin/python3.11 -B -m unittest discover -s tests/ci -p 'test_*.py'`，要求退出0。
- [x] `coordinator-recovery`：在 `/Users/zhongtian/WorkSpace/release-coordinator`，使用现役 runtime 的 PYTHONPATH 执行 Python 3.11 `-B -m unittest discover -s tests -p 'test_*.py'`，要求退出0。
- [x] `build-contract`：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，要求退出0。
- [x] `typecheck`：`npm run typecheck`，要求退出0。保存每项命令、退出码、日志路径及SHA-256。
- [ ] 依提交约定提交部署计划并推送任务分支固定SHA；不直接推进 main。保存 sourceCommit 与 gateway-only/webUi=false 的 validation，持续 heartbeat 后提交 ready。

## 任务 3：协调器部署与生产验收

文件：新增脱敏部署证据 `docs/superpowers/plans/evidence/2026-11-17-local-dialog-deployment.json`。

- [ ] 等待当前任务对应批次真实成功 receipt；核对任务包含、冻结SHA、服务端构建/部署/verify成功、现役marker、PID和文件摘要。
- [ ] 原脚本对同一会话复测 HTTP/WS 各3次，要求所有本地读取小于1000ms，并对比旧版本。响应错误单列，不把失败当快速成功。
- [ ] 浏览器打开现役网页，选择本地模式，打开已有会话，记录点击至内容/错误状态稳定的毫秒；同时观察正确内容和会话加载结果，不发推理消息。
- [ ] 核对启动配置、token和原网页资源摘要未变，Remote授权/配对保留；不发布客户端或触碰旧LAN/IPA渠道。不创建测试会话；若实际新增测试会话，结束后立即归档。

## 任务 4：交付记录

文件：修改 `README.md`、`docs/interaction-alignment.md`、本计划和上述部署证据。

- [ ] 将本地性能修复状态从未部署改为已部署并记录实测边界、成功批次和冻结SHA；独立长测及Remote全功能不扩张结论。
- [ ] 对比完成后 main；仅文档/证据变更按现行部署复用规则检查服务端运行源码摘要和祖先关系，不重复部署。持共享 main 锁整合并推送记录。
- [ ] 最终回复现役部署结果、本地打开对话实测耗时和可测试网页入口；不提供含token的公开链接。
