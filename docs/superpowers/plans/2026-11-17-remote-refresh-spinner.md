# 首页手动刷新状态修复计划

> 主执行者使用 Superpowers writing-plans、test-driven-development、executing-plans 与 verification-before-completion 流程逐步完成，不使用独立 agent。

目标：自动后台同步不再触发首页刷新按钮；点击刷新后仍等待本轮列表更新完成，后续定时任务不能无限延长它。

架构：保持现有共享快照和后台同步。按钮只绑定手动 refreshing；HTTP 传输提供当前列表快照任务的有限等待，调用时固定 Promise 集合，忽略对话详情和之后加入的任务。AppServerClient 透传此内部能力；本地 WebSocket 按既有 RPC 结束，不修改公开协议或接口。

技术栈：React、TypeScript、Vitest、HTTP Remote 传输。

基线 HEAD / origin/main：b3c57687f03eede037f8eced092fc11d3fd30e71；本地 main 保持7772b28f。部署任务remote-refresh-spinner-20261117，继续已授权网关及网页更新，不发布客户端安装包。

- [x] 记录基线、登记任务，核对真实网页未点击刷新时按钮 aria-busy=true 且后台同步中。
- [x] 在 tests/ui/app-snapshot-refresh.test.tsx 先补自动同步按钮空闲、手动有限等待、失败结束回归；在 tests/ui/http-transport.test.ts 覆盖当前列表任务等待、后续任务及详情不延长。运行并保存预期RED。
- [x] 最小修改 src/App.tsx、src/app-server/client.ts、src/backends/http-transport.ts；绿色后直接自查，同步 docs/interaction-alignment.md 现行要求及验收。
- [x] 必要UI回归、typecheck、Web与服务端构建、部署门禁通过，复核最新main后提交推送固定SHA并ready。
- [x] 等待协调器部署成功receipt，核对实际摘要及原配置身份；在Remote网页验证自动同步按钮空闲、手动刷新有始有终、后续周期保持空闲并保存截图。
- [x] 更新实际验收和部署证据，提交推送main完成交付。

不创建推理测试会话，不增加其他产品行为或身份恢复流程。

定向RED已实际观察4项预期失败：自动状态点亮按钮、两个手动等待未调用、传输缺少有限等待能力；最小修改后2文件46项GREEN。详情已在捕获前启动，继续核对后续定时任务隔离。

期间main新增0979efa3远程设备说明与e544c702首次侧栏折叠规则，已按原文保留并整合；刷新夹具显式声明已有展开偏好，避免依赖首次默认展开。整合后重跑相关回归和类型、构建。

首次整合回归232通过、3失败，均为既有原生完成刷新夹具依赖初次默认展开、未能进入目标会话；仅将该夹具明确设为已有展开偏好后重跑，保留原失败证据，不修改生产折叠规则。

整合后13文件235项相关回归通过；290项适配器、164项构建契约、59项协调器恢复通过；整合后typecheck、服务端strict、Web和服务端构建均通过。生产部署前复核Remote online，6份私有文件记录最新摘要；与任务起点相比仅controller-binding由并行已授权新增Mac配对改变，使用部署前最新记录验收，不覆盖原授权变更。

成功部署批次f9a86e54-a0a3-434c-a197-53d2e45dfa53，来源8f2f0fca、冻结de86215c。持久receipt、实际server/frontend/bin/manifest摘要、原6份私有配置与当前授权记录均核对；Remote online且pendingResume为空。整合冻结后的235项相关回归与typecheck复验通过。网页当前连接两台Remote，不操作时后台同步不点亮按钮，点击时aria-busy=true，后续观察到false且后台仍更新。第一轮97.1秒是观察上界，未连续捕获停止时刻，不作为精确耗时或性能改善；多设备手动刷新仍偏慢，保持待验收。

网页后续86.5秒三次采样按钮均为空闲，截断的网络缓冲中至少11次后台刷新200，不能当作完整计数或逐帧持续监测。1280×720网页截图已保存，未宣称iPhone原生验收。公开脱敏证据已更新；收尾仅文档，代码与本批冻结一致，持共享main写入租约提交推送。
