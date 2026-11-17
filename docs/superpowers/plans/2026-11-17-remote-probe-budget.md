# Remote 实际连通后的保存超时修复与部署

> 使用 Superpowers writing-plans、executing-plans 和 TDD；由主执行者检查，不使用独立 agent。

基线：`4c2ddef508535b09b7bdc62bdcf163bf43a39029`。任务：`remote-probe-budget-20261117`，网关及网页部署沿用既有用户授权，`webUi=true`；不发布手机安装包。

实际现役授权和本机配对已完成。公开 Remote WebSocket 两次 initialize 与 model/list 成功，30秒断开间隔15次状态均 online；但实际网页 HTTP“测试并保存”沿用本地6秒总预算而超时，第一次真实 Remote initialize 已耗时6066ms。

- [ ] TDD：先用超过本地预算的 Remote 初始化复现失败；覆盖无响应仍有限超时、本地6秒及显式预算不变。
- [ ] 最小修复：仅 Remote 业务探测默认总预算60秒，控制面仍6秒；探测内部 RPC 使用该业务预算，避免被10秒内部默认值抢先终止。不改实际操作、重放、模式或身份规则。
- [ ] 运行相关客户端回归、类型检查、服务端与网页验证构建；执行四项协调门禁，持续 heartbeat，固定 SHA 推送后 ready。
- [ ] 核对同一成功 receipt、运行产物和原配置保留；实际网页 Remote 测试保存及只读 HTTP RPC，断开后再次连接；不创建会话。
- [ ] 更新当前文档与脱敏证据，在共享 main 锁下整合推送。完整功能、8小时、跨刷新、睡眠唤醒与 P95 保持待验收。

后续基线 `b2639b303edc1bfa553a14a12ac1804f7afdf8de`：测试保存补修已由成功批次 `a2ecf6fc-328a-47a8-908b-3184559870de` 部署，网页 Remote 保存成功。进一步实际列表验收发现项目接口两次HTTP200耗时50182／50528ms，而正式连接握手与项目读取仍为10秒。登记网关网页任务 `remote-runtime-budget-20261117`，沿同一 TDD／协调器流程补齐 Remote 默认60秒：`connection-manager.ts` 的真实客户端及握手总预算、`probe.ts` 的项目读取；本地和显式握手预算保留。相关回归为真实客户端12秒迟到回复及目录50秒回复，本地对应超时仍须通过。此调整不扩大发布平台。

## 第三轮：在途 RPC 公开状态修复

基线 `433f3d073082eb85194472696096acd5fde59cb2`。第二轮 `56c4c29f-5c53-4b8e-941a-fe2614e8ac8f` 已替换运行产物，但协调器 verify 前遇到 database is locked，保留失败现场；新任务 `remote-rpc-inflight-repair-20261117` 显式修复该批次。

实际网页的 threadSection/list 等 POST 已受理202；底层 markPotentialSend 提前记录 uncertain 以防崩溃后重发，而公开轮询也立即返回 uncertain，手机停止等待。因此在 `server/operation-scheduler.ts` 仅投影仍在本实例执行、匹配原 claimToken 的原项为 pending；耐久 uncertain 记录和真正未知的屏障保持。活动标记在 mark 前设置，execute 的 finally 清除，不增加耐久队列或重试。

- [ ] 在 `tests/server/operation-scheduler.test.ts` 用真实 Local WebSocket／Remote Relay 延迟回复，先断言磁盘 uncertain、公开 pending，再回复得到 completed。覆盖读写及真实超时后 uncertain、不重发；其他项仍在执行也不能遮盖已经结束的未知项。运行新增用例并保存 RED。
- [ ] 在原调度器增加 `Map<id, claimToken>`，execute 入口登记、finally 清理；公开查询仅精确匹配时显示 pending。运行新增及整个调度器回归，保存 GREEN。
- [ ] 同步 `docs/interaction-alignment.md` 当前语义和待验收状态，主执行者检查。固定源码提交并完成服务端相关回归、构建、类型检查、四项协调门禁；复用未变协调器已通过的59项核心回归证据。
- [ ] 推送固定 SHA，恢复任务以 webUi=false ready（复用已部署网页，本轮服务端改动不重新构建 Web）；核对成功 receipt、实际摘要、身份配置、Remote 网页保存与列表、RPC。保留失败批次，不改历史结果，不发布客户端包。
- [ ] 结束旧监测并保留记录，在最终部署后重新启动8小时只读监测；仅标记已完成的短时验收，长期验收仍待完成。更新脱敏凭证，在共享锁下推送 main。

第三轮6项新增用例已通过；首次并行回归出现既有100ms耐久预算与测试5秒总预算失败、新增用例300ms查询预算也被实际本地IO耗尽，保留原日志；只将新增夹具的执行预算设为2／5秒，保留真实超时断言。未修改旧用例或产品预算。最后授权等待期间的在途快照另有真实 RED，修复为与原记录一起冻结活动状态。整合前新 main `dcb493df` 含本地读取路径修复，将纳入整合回归。
