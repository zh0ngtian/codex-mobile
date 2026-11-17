# Remote 网关与测试网页部署计划

> 使用 Superpowers writing-plans、executing-plans 和 test-driven-development；由主执行者直接核对，不使用独立 agent 复审。

**目标：** 将已经完成开发的网关及配套 WebUI 部署到现有 Mac，交付用户可打开的测试网页。

**架构：** 复用现役 `codex-mobile-gateway-production` 协调目标及原 launchd 服务；任务级 `scope=gateway-only`、`webUi=true` 更新服务端和网页。保留现有启动配置、口令和身份；手机安装包不在本次范围。

**技术栈：** ReleaseCoordinator、Python、TypeScript、Vite、launchd。

基线及待部署来源：`302f66c07e6075a997b538abddc19bbaccc5190f`。任务：`remote-gateway-web-test-20261117`。已在独立 worktree `codex/remote-gateway-20261113`；不更改原工作区 main 或暂存区。

## 1. 部署前验证

- [x] 登记网关任务，使用既有状态库；持续 heartbeat。
- [x] 先执行部署验收探针：现役 `/api/host` 缺少 Remote v1 能力，认证状态和网页均返回 200，记录预期失败。
- [x] 复用既有功能 TDD 证据，本轮不新增产品代码；执行四项真实门禁：Python `tests/ci/test_*.py`、协调器恢复测试、Vitest `tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`。测试在私有 HOME／CODEX_HOME 和固定来源快照中执行。
- [x] 核对来源已推送及最新 main；有新增提交时由协调器在整合结果执行相关门禁。

## 2. 协调器部署

- [x] 私有 validation JSON 绑定完整来源 SHA、四项通过证据、`scope=gateway-only`、`webUi=true`，提交 ready。
- [x] 等待 main/gateway/verify 三阶段完成；核对同一成功 receipt 的任务、冻结 SHA、WebUI 标记、产物摘要及运行 PID。
- [x] 不绕过协调入口，不修改历史失败批次；失败时按最新失败叶节点登记修复任务。

## 3. 部署后验收与交付

- [x] 用同一部署验收探针确认 Remote v1、认证健康、实际网页和 JS 可访问，核对管理 CLI 状态。未授权时如实告知，不自动执行 OAuth 或替换身份。
- [x] 保存脱敏公共收据，同步 README、Remote 管理及交互约定的实际部署状态；完整功能、8 小时和 P95 验收保持待验收。
- [x] 按提交约定提交文档，在共享 main 锁下整合推送；核对原工作区暂存区保持。
- [x] 向用户交付已验证网页链接及模式选择步骤。

测试会话：优先只读探针，不创建会话；若验收确需创建，完成后及时归档。

门禁补修：两次隔离构建契约均在 `agent-session-smoke.swift` 保存 ACK 场景失败。该旧表单夹具只提供名称和地址，缺少产品现行必填 `gatewayMode`，因此产品正确拒绝不完整表单并未发送保存请求。仅补齐夹具中的默认本地模式和同一 draft，并断言三个字段及模式值；不修改原生或服务端产品代码。保留两次 RED，补修后重新运行完整构建契约。

最终部署：来源 `1e9917729082e1b1f6755335988f8375a4314613`，冻结 `1fd52ff969d373dbdba281bcff41eb3bc6c69a6b`，成功批次 `48f7578a-d8f4-407e-9d24-4820c08336f1`；开发 CI `44000253551` attempt 1 成功。284项适配器（1项既有跳过）、59项协调器、164项构建契约和类型检查通过。现役文件树、启动配置、PID／监听和网页、本地连接、Remote v1 能力已核对，原工作区 main 与暂存区未变；常驻实例当前 `unconfigured`，首次 Remote 授权／本机配对与官方长期验收待完成。[脱敏收据](evidence/2026-11-17-remote-gateway-deploy.json)。本次没有创建测试会话。
