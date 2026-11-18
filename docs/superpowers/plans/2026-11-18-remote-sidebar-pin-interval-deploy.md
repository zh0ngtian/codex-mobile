# 侧栏置顶同步降频部署计划

> 执行按 Superpowers 的 executing-plans 和 test-driven-development 核对每步结果。

**目标** 把前台置顶轮询从 3 秒改为 30 秒的前端提交部署到现有网关，并在线验证定时、手动刷新与项目折叠的请求行为。

**范围** 现有网关及自带网页。沿用协调器的 main／gateway／verify 阶段，任务声明 `scope=gateway-only`、`webUi=true`。沿用原连接、授权配置和客户端渠道。

**技术栈** releasectl、GitHub 开发 CI、Vitest、生产网页网络事件。

## 1. 固定来源和验证变更

- [x] 在独立工作区核对固定来源 `59932f1e0910495917f4c988b4e3281c25e0f424` 已在远端 main。变化位于 `src/App.tsx`、`tests/ui/app-rpc-refresh.test.tsx` 和 `docs/interaction-alignment.md`。
- [x] 复核原 RED。行为测试在旧 3 秒实现中推进 29,999ms，观察到 9 次置顶查询，预期为 0。最小实现将 `setInterval(refreshPins, 30_000)` 接入原前台刷新，保留手动读取。
- [x] 执行 GREEN 和相关回归。用 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/app-rpc-refresh.test.tsx tests/ui/thread-list-loader.test.ts tests/ui/project-collapse.test.ts tests/ui/native-ui-app.test.tsx tests/ui/native-ui-multi-backend-loading.test.tsx tests/server/desktop-thread-pins.test.ts tests/server/desktop-thread-pins-remote.test.ts` 核对 97 项通过。定时测试覆盖 29,999ms 无请求、30,000ms 一次请求、手动刷新立即再查。加载器和应用测试覆盖折叠项目与无项目组跳过首批、展开后按需读取。

## 2. 执行受控部署

- [x] 用 `~/.local/bin/releasectl register --project codex-mobile-gateway-production --task remote-sidebar-pin-interval-deploy-20261118` 登记任务；准备期间维持 heartbeat。
- [x] 从当前网关记录服务 PID、产物摘要、原配置与授权文件的散列、两台接受目标及原工作区 HEAD/index。私有证据保存在忽略的 `.mobile-build/remote-sidebar-pin-interval-deploy-20261118/`。
- [x] 在固定来源运行适配器回归、协调器回归、构建契约、类型检查四项门禁，保留命令、退出码和日志摘要。写入同一 `sourceCommit` 及 `webUi=true` 的验证文件并提交 `releasectl ready`。
- [x] 协调器成功完成 main／gateway／verify。批次 `e8cf46bc-555b-4e98-8e3f-8b6afa13feb9`，冻结 `b0438ba43b306f2d8ac189f316ded154ecf0307b`，开发 CI `44298134282` attempt 1。持久回执、实际服务、线上网页入口文件与产物摘要均核对；原 9 份私有文件、两台接受目标及原工作区保持。

## 3. 线上回验

- [x] Edge 生产网页两台 Remote 设备空闲时，各四次 `threadSection/list` 返回 200。网关 Mac 与配对桌面的周期合计六个间隔，范围为 29,998–30,002ms。
- [x] 在下次定时周期前点击侧栏刷新，观察一台设备约 5ms 派发置顶分组请求并返回 200。按钮在 88,453ms 后结束，期间观察到 53 次有项目范围的列表请求，其中一次返回 503。保留该样本为失败刷新。
- [x] 同轮观察到选中的折叠项目发出 0 次项目页请求。显式展开后 4ms 发出 `limit=5`，首个响应为 503，随后同组首批及补页返回 200。本次确认按需查询，未验证该组内容齐全。测试后恢复项目折叠与设备筛选。
- [x] 单次打开既有对话，从点击到 5 条回合卡片与输入框就绪为 15,105ms；`thread/resume` 用时 15,078ms，返回 200。首次加载窗口另观察到 4 次项目目录 500。浏览器采样未截断。
- [x] 部署回执摘要及验收状态已写入交互约定。本计划与交互约定为收尾提交的全部内容。

部署回执 SHA-256 为 `7b29d25dc7f338887e56eaf2e52982c634f9cb9ea2724d08db7d0c288384be54`，线上进程 PID 81353。部署核验时两台目标均在线，待恢复数为 0。
