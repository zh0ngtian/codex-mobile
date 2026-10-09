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
