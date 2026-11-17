# Remote 列表与会话导航性能修复计划

> **For agentic workers:** 使用 superpowers:executing-plans 与 test-driven-development 逐项执行。按用户规则由主执行者检查，不启动独立 agent。

**Goal:** 已打开的 Remote 列表和会话先显示网关共享快照，后台经唯一队列更新；减少账本与项目目录的重复工作，通过验证后部署网关及网页。

**Architecture:** 快照只保存成功的导航读取结果，以完整授权上下文、方法和参数隔离；新增只读快照入口，不改变原 RPC UUID、耐久队列、停止和审批语义。账本每次仍在跨进程锁内检查权限并读取真实字节，仅复用相同字节的校验结果；项目 worktree 在目标端批量执行固定 git 只读命令。快照不充当发送授权，交付前继续核验当前账户、目标和授权代次。

**Tech Stack:** TypeScript、Node.js、React、Vitest、既有 Remote Commands 与 releasectl。

基线：main / origin/main = e34d8d79b3db05908e64472cabf9eb356e0a2c93。任务 remote-navigation-performance-20261117，scope=gateway-only，webUi=true，不发布客户端安装包。

### 1. 账本重复扫描
- [ ] 在 tests/server/operation-queue-inventory.test.ts 加入重复查询、外部修改及返回副本回归，先运行 RED。
- [ ] 修改 server/operation-queue.ts：保留每次真实读取和文件检查，仅对已验证且字节完全一致的内容跳过完整 schema 扫描，不按 mtime 猜测。
- [ ] 修改 server/operation-scheduler.ts：结果查询复用本次已授权记录，减少重复 locate/read；保留最终同步授权栅栏。
- [ ] 运行队列、scheduler 相关回归，并对隔离副本的真实大小账本测量性能。

### 2. 项目读取合批
- [ ] 在 tests/server/project-git-remote.test.ts 新增多个项目共用一次 Remote Commands 传输的 RED，覆盖真实 git、非仓库和 worktree 归属。
- [ ] 修改 server/codex-projects.ts：固定只读 git 参数在目标 Python 内顺序执行，参数及输出分批有界，异常、取消和默认权限保持原合同。
- [ ] 运行项目解析与真实 Remote 协议回归。

### 3. 共享快照与网页首屏
- [ ] 创建 server/remote-read-snapshots.ts 及 tests/server/remote-read-snapshots.test.ts，先覆盖完整上下文隔离、克隆、过期、容量与写方法拒绝 RED。
- [ ] server/operation-scheduler.ts 保存成功导航结果；server/gateway-rpc.ts 和 server/gateway.ts 新增只读快照入口，后台更新仍调用原 scheduler.hostedRpc。
- [ ] server/thread-observer.ts 在会话业务快照变化后刷新已缓存的对应读取，不按心跳推进业务时间。
- [ ] src/backends/http-transport.ts 先尝试快照；命中时立即交付，独立后台更新结果通知网页；旧网关 404 沿用既有 RPC。
- [ ] src/App.tsx 展示快照时间及更新状态，更新当前列表/会话；项目缓存命中不阻塞列表，桌面置顶与项目读取并行。
- [ ] 加 HTTP 集成和 transport 测试验证跨手机共享、撤销授权拒绝、旧网关兼容、后台成功与失败，并运行 GREEN。

### 4. 验证与部署
- [ ] 更新 docs/interaction-alignment.md 的现行要求、验收点与状态；完成直接代码检查、类型检查、服务端及网页构建。
- [ ] 提交推送固定源码 SHA；按 docs/release-coordination.md 完成四项门禁证据及 ready。停止旧长连采样并保留历史结果。
- [ ] 等待成功部署 receipt，独立核对安装文件、前端、进程、认证及原工作区暂存内容未漂移。
- [ ] 实际 Remote 网页列表刷新和冷热会话打开计时、Local 回归；重启新版本长连采样，不把未满八小时说成通过。
- [ ] 更新部署证据，在共享 main 锁内合入推送文档，提供测试网页与实际性能数据。

### 5. 实际网页验收发现的调度拥塞补修

补修基线：origin/main = 985010f1d700d67848f8f16d93d60268cfb03d7b；任务 remote-navigation-scheduler-performance-20261117，继续 gateway-only / webUi=true。首批部署成功不等于性能验收通过：实际列表和详情仍长时间等待，历史未知只读请求反复对账。

- [ ] 先加 RED：未知只读请求在同一版本内不每轮反复查原 WAL，未知写仍维持原检查和写屏障；新导航正常执行。
- [ ] 对实际授权读取后确认的只读请求，按 UUID / revision 缓存最多 256 个 30 秒检查间隔；到期作为后台任务，原记录、授权和未知状态不变，新 revision 立即重查。
- [ ] 快照状态按列表和当前会话区分，避免列表同步完成误标详情已同步。
- [ ] 完成针对性回归及部署门禁，再部署并以实际网页冷/热导航验收。
