# HTTP 提交与执行状态轮询实施计划

> **执行流程：** 使用 Superpowers planning、TDD、subagent-driven-development 与 verification-before-completion。用户已确认实施与交付；按网关、客户端、端到端验证顺序完成，不重复申请确认。

**目标：** 手机通过 HTTP 提交文字任务、停止与审批，前台定时拉取中间活动与最终回复；断网或后台不关闭网关持有的上游会话，实时语音使用按需通道。

**架构：** 保留 App Server JSON-RPC 契约，由网关 HTTP session 维护上游连接、运行状态、待审批和增量通知。客户端用兼容 socket 接口的 HTTP transport 复用现有会话渲染与 RPC 客户端。写请求用独立 requestId 去重并持久记录结果；重启后无法确认的请求不自动重放。历史继续 summary 分页，不轮询 full 工具结果。

**技术栈：** TypeScript、React、Node HTTP、ws、Vitest、Playwright、现有 Android 构建与固定局域网发布。

## HTTP 契约

- `POST /api/rpc?sessionId=<UUID>&token=...`：`{ requestId: UUID, message: RpcMessage }`，响应原 JSON-RPC result/error（保留输入 id）。初始化在同一网关会话仅向上游执行一次；请求 ID 重复时复用在途操作或结果，同 ID 不同内容返回冲突。
- `GET /api/events?sessionId=...&after=<sequence>&token=...`：`{ epoch, cursor, messages: RpcMessage[], requests: RpcMessage[], active, updatedAt, reset }`。messages 按顺序提供合并后的文字/工具活动变化；requests 是仍待处理的审批快照。截断日志或 epoch 变化时 reset=true 并提供恢复快照。上游失效显式报告，客户端重新 bootstrap。
- `GET /api/operations?sessionId=...&requestId=...&token=...`：查询在途、已完成或结果待确认的操作；缺失请求返回 404。
- `/api/realtime?sessionId=...&token=...`：按需 WebSocket，与同一 HTTP session 的上游共享连接，只传实时语音 RPC 与 `thread/realtime/*` 事件；关闭语音连接不关闭上游文字会话。
- `/api/host` 返回 `httpPolling: true` 能力。新版客户端明确提示旧网关需要升级；不默默回退常驻 WebSocket。
- 同一 gateway session 的待审批保留到上游成功收到回复，返回与上游恢复均携带 epoch，过期审批不发送到新连接。

## 任务 1：网关会话与可靠提交

文件：新增 `server/http-session.ts`、`tests/server/http-session.test.ts`；修改 `server/gateway.ts`。

- [x] 先写真实 HTTP + ws 上游测试：HTTP 初始化、任务请求、重复 requestId 只执行一次、不同内容拒绝、手机断开不关闭上游、认证与 OPTIONS。
- [x] 运行 `npx vitest run tests/server/http-session.test.ts`，确认功能缺失导致失败。
- [x] 实现 session 管理、初始化、请求/响应映射、持久操作记录、在途去重、重启后结果待确认、过期 session 清理。
- [x] 加入状态拉取测试：流式文本合并、命令活动、计划、完成、待审批直到已回复、cursor 缺口恢复、上游重连、语音共享 session。
- [x] 日志与工具输出限量；停止消费巨型工具结果，完整历史/差异按现有接口读取。
- [x] 聚焦测试通过；审查规格，再审查实现质量。

## 任务 2：客户端 HTTP transport 与中间状态

文件：新增 `src/backends/http-transport.ts`、`tests/ui/http-transport.test.ts`；修改 `src/app-server/client.ts`、`src/backends/connection-manager.ts`、`src/backends/probe.ts`、`src/App.tsx`、会话页面与 i18n。

- [x] 先测默认连接没有 WebSocket、HTTP 请求同 ID 重试、轮询每次完成后再调度、后台暂停、前台立即刷新、失败退避、审批去重、reset 对账与实时语音专用通道。
- [x] 运行聚焦测试观察 RED，然后实现传输层，保持现有 JSON-RPC 消费代码。
- [x] 活跃每 3 秒刷新，空闲每 15 秒低频同步；后台暂停。错误保留内容并显示最近同步时间；恢复立即对账。
- [x] 客户端发送 requestId 并在不确定结果时查询同一个操作，不创建第二个请求。
- [x] `respond` 等回复必须等待 HTTP 成功再从页面移除审批；失败保留并显示可重试状态。
- [x] 活动条显示当前执行/等待状态、计划（若有）、最后同步状态，不推测进度百分比。
- [x] 修改设备探测，校验 HTTP 能力并使用一次只读 RPC 验证上游。
- [x] 聚焦测试通过；审查规格，再审查实现质量。

## 任务 3：端到端与交付

文件：新增 HTTP 场景 E2E；修改 README 和固定渠道版本下限（仅必要时）。

- [x] HTTP 模拟上游真实浏览器验收：发送、流式中间状态、审批、断网恢复、后台恢复、停止、历史分页、设备切换。
- [x] `npm test`、`npm run typecheck`、`npm run build:package`、相关 Playwright 测试和 `git diff --check`。
- [x] 更新 README：HTTP 文字交互、网关升级要求、后台暂停的通知限制、请求待确认语义。
- [ ] 提交并推送中文 Conventional Commit；更新手机目前唯一配置的本机网关，并通过只读 RPC 验证。
- [ ] 构建高于固定渠道现有 `0.2.68` 的 APK，沿用签名。
- [ ] `apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>`；通过固定 JSON、HEAD、GET 比对版本、大小和 SHA-256。
- [ ] 清理本次不再使用的临时文件，交付固定 APK 链接、版本、大小和 SHA-256。
