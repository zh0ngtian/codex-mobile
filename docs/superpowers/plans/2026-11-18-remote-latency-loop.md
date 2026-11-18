# 远程工作区延迟排查与部署计划

> 执行使用 Superpowers 的 executing-plans、test-driven-development 和 verification-before-completion。

**目标** 在现有网关网页上反复验证侧栏刷新与打开现有对话的实际耗时，以同网关、同目标、相同操作的 Local 数据作为对照。

**现状** 基线 main 为 `6070c8454f6513a73f38ff251e336004f6e2aac8`。线上观测到网页在摘要超时时关闭健康逻辑连接。摘要发出前已用去约 35.7 秒的 60 秒预算。上轮手动刷新 88.453 秒，打开对话 15.105 秒。

**范围** 工作区初始化、现有侧栏 RPC 调度及经实测定位到的网关读路径。用既有生产网关及其网页的协调发布流程验收。后续轮次依据线上分段数据修订本计划。

## 第一轮隔离侧栏读失败

- [x] 在 `tests/ui/workspace-bootstrap.test.ts` 用暂未完成的列表 Promise 和会失败的列表 Promise 验证基础设置独立完成。运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/workspace-bootstrap.test.ts`，旧实现在列表未结束或失败时不能完成。
- [x] 在 `tests/ui/app-rpc-refresh.test.tsx` 复现摘要失败，验证当前网页保留成功加载的项目会话、显示错误并不关闭已连接传输，后续手动刷新可恢复。先确认旧实现调用 close。
- [x] 将 `src/backends/workspace-bootstrap.ts` 中的列表启动改为与额度读取一样独立完成。继续由 `src/App.tsx` 的 `loadThreads` 管理列表加载态、失败提示与手动刷新收尾。
- [x] 在 `tests/ui/thread-list-loader.test.ts` 验证工作区刷新时摘要和展开项目使用同一可见后台档，项目多时摘要能够进入首批并发。先确认测试在旧实现中失败，再调整 `src/app-server/thread-list-loader.ts` 的派发顺序和优先级，保留四并发、60 秒总预算、手动刷新收尾和项目折叠语义。
- [x] 运行前端关联回归、网关适配器／协调器／构建合同门禁和类型检查；更新交互现行要求、验收要点和变更记录。推送已验证源 SHA，使用 `remote-latency-loop-r1-20261118` 任务的 `gateway-only` 和 `webUi=true` 验证记录提交 ready，读成功回执和生产产物。
- [ ] 网页端实测同目标的刷新开始、状态就绪、侧栏结束、对话打开到回合显示，分别记录目标、接口与异常。复测第二台远程设备是否主动重连，记录实际连接状态与请求数。达标前从实测主耗时继续下一轮。

## 第二轮定位项目目录早失败

第一轮成功批次 `09d0ee14-46ae-4172-bb8d-96558578fb81`，冻结 `64267ea2`，网页已更新。浏览器仍有项目目录 500。单机同一会话的顺序 RPC 对照，生产 Local 恢复 7–9ms，Remote 6ms；同一目标目录 Local 230ms/200，Remote 257ms/500。用实际项目文件在网关本机执行相同数据提取及 Git 脚本，两步均成功。浏览器满载时另有单目标设置 RPC 约 37 秒的样本。

- [x] 在 `tests/server/gateway-remote-services.test.ts` 注入目录阶段的已分类错误，确认后台刷新只记录固定阶段、错误分类和耗时，不记录错误正文或目录；运行同文件确认旧实现无相应记录。
- [x] 在 `server/codex-projects.ts` 保留目标文件和 worktree 两阶段的失败分类，`server/gateway-remote-services.ts` 在每轮共同读取失败处写一条脱敏诊断，包含后置授权阶段。保留原 500、已授权快照及读取失败边界。
- [ ] 通过目录、网关集成、Remote 命令及协调门禁并部署服务端。抓取生产分类后继续修复真实触发原因。

- [x] 对比 `server/operation-scheduler.ts` 的 Local 与 Remote 导航分支。使用真实 Remote fixture 和暂不放行的观察登记，在 `tests/server/gateway-remote-integration.test.ts` 证明当前 Remote 的只读 `thread/resume` 被登记任务阻塞。修复采用与 Local 相同的异步持有方式，关闭时等待既有任务，其他写请求继续原时序。相关回归及服务端构建通过后与第二轮同批部署。
