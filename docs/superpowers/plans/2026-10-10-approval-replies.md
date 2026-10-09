# 审批与问题回复实现计划

> 使用 superpowers:executing-plans 顺序执行，所有行为先写失败测试。

**目标：** 在移动端完整呈现已支持的四种服务器请求，提交准确响应并保持每条请求的状态隔离。

**架构：** ApprovalSheet 展示协议驱动的选择及问题；approval-model 封装协议决策与答案校验；App 按请求 ID 管理草稿、提交状态及 HTTP 最终确认。协议以 protocol/app-server-v2 的本地官方快照为准。

**技术栈：** React、TypeScript、Vitest、Testing Library。

- [x] 添加 tests/ui/approval-sheet.test.tsx：展示命令、原因、目录、可用决策；问题描述、自定义答案、保密输入、非空校验；先运行并确认失败。
- [x] 实现 src/features/approvals/approval-model.ts 与 ApprovalSheet.tsx；用协议 availableDecisions 原样生成响应，权限支持 turn/session，文件修改展示 grantRoot。
- [x] 添加 App 集成测试覆盖 serverRequest/resolved、相同问题 ID 的队列隔离、重复提交防护、提交失败保留及 HTTP pending 最终确认；先运行并确认失败。
- [x] 更新 src/App.tsx 状态与事件处理；只接收现有四种方法，不扩大未知方法支持；HTTP 请求快照仍为对账来源。
- [x] 运行 npm test -- tests/ui/approval-sheet.test.tsx 与集成回归、npm run typecheck 和 git diff --check。
- [x] 按 docs/commit-conventions.md 提交中文 Conventional Commit，交父任务统一推送和发布。

验证限制：本子任务不运行模拟器或真实会话，不改 server、原生或 CI。

## 完成证据

- 表单新增 5 项测试在旧实现全部失败；请求队首竞态测试也先复现错误发送，再修复。
- ApprovalSheet、请求状态、App 初始化、客户端、连接管理和 HTTP 传输共 61 项测试通过。Node 26 执行需 `NODE_OPTIONS=--no-experimental-webstorage`，避免其原生 localStorage 覆盖 jsdom。
- `npm run typecheck` 通过。
- `npx playwright test --config tests/e2e/approvals.config.ts` 通过，真实 App + 模拟 HTTP 覆盖失败重试、相同问题 ID 队列隔离、自定义回答和规则审批的完整响应。
- 已检查 375px 表单截图；本任务没有操作模拟器或真实会话，未改服务端、原生或 CI。
- HTTP 结果待确认期间保持禁止重复提交，直到最终确认或请求快照移除；草稿只在内存保留，不将保密答案写入本地存储。

## 规格审查补充修复

- 保密答案的边界扩展到真实 HTTP 发送链路：所有服务器回复仅将 UUID、RPC 请求 ID 和 epoch 写入本地存储，完整正文仅存在当前页面内存。同页重试保持原 UUID，重启后只查询原操作，不重发删去正文的记录；加载旧记录时迁移清除答案和包含答案的签名。三个行为测试先失败后通过。
- 审批提交将对应 pending operation 的释放回调绑定到提交标识。`serverRequest/resolved`、请求快照移除和最终失败/成功确认都释放该审批关联，不影响其他回合操作；解决通知先于 HTTP 待确认异常时不注册孤立操作。四个回归先失败后通过。
- 补齐 17 项审批表单英文翻译；真实 App HTTP 回归验证审批已消失且操作查询仍 uncertain 时可以直接发送新消息。

## 服务端请求生命周期补充

- 真实 HTTP 网关回归先复现：`serverRequest/resolved` 已出现在事件页，但同一页 `requests` 仍含旧审批。修复 HTTP session 在投影通知前按请求 ID 和线程清理 pending；后续快照不再复活审批，迟到回复返回 409。
- WebSocket 流式保留表采用相同清理；数字/字符串请求 ID 和其他线程相互隔离，最后一个审批解决后恢复空闲释放。
- 此次仅补必要服务端生命周期及回归；网关部署由父任务统一完成。

验证：相关 HTTP session、Bark、WebSocket gateway 三套共 100 项测试串行通过；`npm run typecheck` 和 diff 检查通过。
