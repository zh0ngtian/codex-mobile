# Remote 实际连通后的保存超时修复与部署

> 使用 Superpowers writing-plans、executing-plans 和 TDD；由主执行者检查，不使用独立 agent。

基线：`4c2ddef508535b09b7bdc62bdcf163bf43a39029`。任务：`remote-probe-budget-20261117`，网关及网页部署沿用既有用户授权，`webUi=true`；不发布手机安装包。

实际现役授权和本机配对已完成。公开 Remote WebSocket 两次 initialize 与 model/list 成功，30秒断开间隔15次状态均 online；但实际网页 HTTP“测试并保存”沿用本地6秒总预算而超时，第一次真实 Remote initialize 已耗时6066ms。

- [ ] TDD：先用超过本地预算的 Remote 初始化复现失败；覆盖无响应仍有限超时、本地6秒及显式预算不变。
- [ ] 最小修复：仅 Remote 业务探测默认总预算60秒，控制面仍6秒；探测内部 RPC 使用该业务预算，避免被10秒内部默认值抢先终止。不改实际操作、重放、模式或身份规则。
- [ ] 运行相关客户端回归、类型检查、服务端与网页验证构建；执行四项协调门禁，持续 heartbeat，固定 SHA 推送后 ready。
- [ ] 核对同一成功 receipt、运行产物和原配置保留；实际网页 Remote 测试保存及只读 HTTP RPC，断开后再次连接；不创建会话。
- [ ] 更新当前文档与脱敏证据，在共享 main 锁下整合推送。完整功能、8小时、跨刷新、睡眠唤醒与 P95 保持待验收。
