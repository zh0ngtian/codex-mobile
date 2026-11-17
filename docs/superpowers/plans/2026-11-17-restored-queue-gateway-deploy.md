# 原消息队列恢复后的网关与网页部署计划

> 由当前主执行者使用 superpowers:writing-plans、executing-plans 和 test-driven-development 执行及自查；按仓库要求不使用独立 agent。

**目标：** 将用户选择 B 的消息队列恢复实现及配套网页部署到现役 Mac 网关。

**架构：** 使用既有 `codex-mobile-gateway-production` 目标、共享 main 锁和原 launchd 安装；任务验证记录声明 `scope=gateway-only`、`webUi=true`，保留现有配置、口令与 Remote 身份。部署使用协调器固定 SHA 和成功收据，不发布手机安装包。

**技术栈：** TypeScript、Vitest、Python unittest、Vite、ReleaseCoordinator、launchd。

基线 main：`80d6b68fb7dba45053a79d37dad61af73360e8ba`。任务：`restored-message-queue-web-deploy-20261117`。独立工作区：`codex/local-background-restore-20261117`。用户已明确授权网关与自带网页一起更新。

## 1. 部署前验证

- [x] 登记任务，核对最新 origin/main，保持 heartbeat。
- [x] 使用同一验收探针先检查现役安装是否已启用直接请求及恢复后的 FollowUps，记录部署前预期不通过。
- [x] 本轮不新增产品实现；复用已提交的行为回归，运行 `npm test -- tests/server/follow-ups.test.ts tests/server/gateway-remote-integration.test.ts tests/server/gateway-local-read.test.ts tests/server/gateway-queued-rpc.test.ts tests/server/gateway-scheduler-services.test.ts tests/server/gateway-attachments.test.ts tests/server/thread-observer.test.ts tests/server/remote-read-snapshots.test.ts tests/ui/http-transport.test.ts tests/ui/gateway-follow-ups.test.ts tests/ui/queued-follow-ups.test.ts tests/ui/remote-gateway.test.tsx tests/backends/file-upload.test.ts --maxWorkers=2 --testTimeout=60000`。
- [x] 运行四项真实发布门禁：Python 项目适配器回归、上游协调器恢复回归、`npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`；另运行服务端 strict。
- [ ] 保存命令、退出码和日志；失败不得提交 ready。提交计划并推送固定来源分支；由协调器完成正式 main 整合。

## 2. 协调器部署

- [ ] 私有 `validation.json` 绑定完整 sourceCommit、四项 passed 检查和 `webUi=true`，提交 ready。
- [ ] 等待 main/gateway/verify 成功；构建服务端与网页，核对持久 receipt、冻结来源、实际目录摘要、进程与健康接口。失败现场保留，必要时使用最新失败叶登记修复，不改历史批次。

## 3. 部署后验收

- [ ] 再运行同一部署前探针，确认预期从 RED 变为 GREEN；检查真实网页及入口资产、原配置散列、Local 和 Remote 只读 RPC，确认重启后 Remote 授权与配对仍可用。
- [ ] 保存脱敏证据，同步 README、交互约定及运维文档的部署状态；不把短连接验证写成长时间稳定性验收。
- [ ] 文档收尾在共享 main 锁内提交推送，核对部署代码与来源祖先关系；无运行代码变化时复用本批成功部署。

测试优先只读，不发送模型消息、不创建测试会话；若确需创建，验证后及时归档。

部署前结果：现役冻结 `46e1fd5671ab2a6a723bf5bae261e2009ea46b75`，三个恢复实现检查均按预期未通过；HTTP健康、网页及1个入口资产正常，Remote已授权、已配对且唯一目录目标在线。探针初始化时的路径错误修正后才得到上述预期RED，不将脚本错误作为业务失败证据。12文件117项相关回归、单独2项附件回归，以及2文件58项Remote／传输补核均通过（补核与前组有重叠，不相加为独立覆盖数）；290项适配器、59项协调器、22文件164项构建契约、typecheck和服务端strict通过。完整日志保存在本机私有 `/private/tmp/restored-queue-deploy-20261117`。
