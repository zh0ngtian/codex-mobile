# Remote 恢复批次网页范围修复与部署计划

> 使用 superpowers:writing-plans、executing-plans 与 test-driven-development；按用户要求由主执行者执行、检查，不使用独立 agent。

**目标：** 仅让显式恢复批次继承原已授权的网页更新范围，部署 Remote 在途 RPC 修复及已合入的本地会话读取性能修复。

**架构：** 在既有 Gateway 构造阶段完成范围判定，不改协调器、历史任务或冻结数据。普通混合选择继续失败；恢复链必须有继承的 true，全部新任务必须明确 true，false 只能来自继承项。既有 scope、布尔类型、来源 SHA 检查仍先执行。

**技术：** Python unittest、现役 releasectl、launchd 网关、实际网页与只读 HTTP／WS RPC。

修改前远端 main 基线 `e9ff9a1fd8ee56c7f2f3eb3d199ee9b231aa1f53`；当前分支已合入该冻结提交。用户已确认该恢复规则及合并本地性能修复。新任务 `remote-web-scope-recovery-20261117` 修复最新失败叶 `251876ad-65f8-4389-9650-ea51a45b5f97`，新验证声明 webUi=true；不发布手机包。

## 1. TDD 与范围同步

文件：`tests/ci/test_gateway_release_adapter.py`、`scripts/release_coordination/gateway.py`、`docs/release-coordination.md`、`docs/interaction-alignment.md`。

- [x] 添加真实 Gateway 回归：恢复链 inherited true+false、新任务 true 时构建网页与服务器并生成 webUi=true 回执；普通冲突、没有继承 true、新任务 false／省略、缺失或歧义 newTaskIds、无 recoveryOf、非法 scope／SHA／布尔值仍拒绝。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p test_gateway_release_adapter.py`，保留修复前因范围冲突失败的 RED，确认不是夹具错误。
- [x] 最小修改：先收集所有已校验选择，再只对冲突分支检查恢复身份、明确新任务集合及继承授权；满足时选择 true，否则原错误。保留默认省略及非冲突合同。
- [ ] 同命令验证 GREEN；完整适配器回归、构建契约与类型检查使用固定源码隔离目录。协调器源码未变时复用现有59项成功证据。更新当前范围说明和验收点。

## 2. 协调部署与真实验收

文件：既有私有验证记录、新增 `docs/superpowers/plans/evidence/2026-11-17-remote-production-rpc.json`、现行 README 与 Remote 管理文档。

- [ ] 主执行者核对 diff、来源与本地性能修复祖先关系；按中文提交规范提交。推送完整 SHA，以 scope=gateway-only、sourceCommit=该 SHA、webUi=true 提交 ready。持续 heartbeat 至 batched，不修改旧任务。
- [ ] 等待 main/gateway/verify 成功及持久 receipt；独立核对实际服务端、网页、入口、manifest 摘要，新 PID、监听、认证健康与入口资产，原启动配置、token、Remote 身份、本机配对和原工作区 main/index 保留。
- [ ] 真实网页 Remote“测试并保存”和列表加载、只读 HTTP／WS RPC 重连验证；不创建测试会话。核对本地读取修复已在部署来源内并测实际读取。
- [ ] 稳定部署后重新启动8小时只读监测，核对首轮成功；未结束前只能标记运行中。完整功能、凭据刷新、睡眠唤醒及 P95 不冒充已通过。
- [ ] 更新当前文档、脱敏收据与本计划，在共享 main 租约下整合最终文档并推送 main；无产品新改动不重复测试。

TDD 记录：修复前47项中允许恢复的两条路径报原冲突、末项非法校验被提前冲突遮挡；均保留 RED。第一版 GREEN 后自检补充重复任务 ID 不能覆盖选择，得到 `RuntimeError not raised` 的真实 RED；改为保留逐项选择后48项全部通过。没有改变既有部署目标或历史任务。
