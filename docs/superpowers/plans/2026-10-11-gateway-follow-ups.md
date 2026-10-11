# 网关托管排队消息实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 排队消息离开客户端内存，手机断开、切换会话后仍由网关顺序发送，并在重启后恢复。

**Architecture:** 增加网关全局持久化队列，使用专属 HTTP session 的持久请求记录对接 app-server。每个会话串行调度，发送前 resume/read 核对运行状态。客户端通过独立 HTTP API 同步队列，因此 HTTP 与 WebSocket 模式共享同一队列。发送前落盘，发送结果不明确时停留待确认，禁止自动重复提交。

**Tech Stack:** TypeScript、Node fs、现有 HttpSessions、React、Vitest、Playwright。

## 接口与状态

`/api/follow-ups` GET 返回 `{items: FollowUpPreview[]}`，POST 使用 action 操作。

```ts
type FollowUpPreview = {
  id: string; threadId: string; inputText: string; text: string;
  attachmentCount: number; state: 'queued'|'sending'|'failed'|'uncertain';
  revision: number; error?: string;
};
type Enqueue = { action: 'enqueue'; id: string; threadId: string;
  inputText: string; text: string; attachmentCount: number;
  extraInput: Record<string, unknown>[]; settings: Record<string, unknown> };
type Edit = { action: 'edit'; id: string; revision: number;
  inputText: string; text: string; mentions: Record<string, unknown>[] };
type Action = { action: 'cancel'|'retry'|'steer'; id: string; revision: number };
```

新增消息 UUID 同时用于幂等提交；内容冲突返回 409。列表不返回图片 base64、完整附件输入或运行设置。编辑只替换正文与 skill/plugin mention，保留图片和文件。steer 返回 `{turnId}`，成功后移除队列，失败保留。sending 状态拒绝操作；uncertain 仅允许明确确认后的取消记录，不允许编辑或重试。HTTP 401/404/409 等由客户端明确显示，不回退为本地自动队列。

## Task 1：网关持久化与调度

**Files:** 新增 `server/follow-ups.ts`、`tests/server/follow-ups.test.ts`；修改 `server/http-session.ts`、`server/gateway.ts`。

- [x] 先写真实 mock upstream + gateway 测试并观察失败：当前 turn 运行时不发送；完成后无需客户端轮询即可发送；不同会话互不阻塞；同一会话 FIFO；重启恢复；相同 UUID 不重复；编辑/取消/引导与调度互斥；未知结果不自动重发；鉴权及尺寸限制。
- [x] 运行 `npm test -- tests/server/follow-ups.test.ts`，确认因缺少 API 而失败。
- [x] 新增 `HttpSessions.hostedRpc`：专属稳定 session 自动 initialize/initialized，调用现有持久化 rpc；恢复时按原操作 UUID 查询结果。队列存到 codexHome 私有目录，原子写入与 fsync 后才确认入队。启动恢复并启动后台 timer；close 停止调度并等待落盘。
- [x] 每个 thread 独立检查状态，运行时等待；idle 时将队首置 sending 后落盘，再用固定操作 UUID 执行 turn/start；明确失败置 failed，不明结果置 uncertain；后续同会话停止，其他会话继续。
- [x] 实现 GET/POST API 与输入校验、并发版本检查、幂等记录及容量限制；网关鉴权/CORS 与能力声明接入。
- [x] 同时运行新测试及 `tests/server/http-session.test.ts`；由独立 reviewer 先核对规格，再核对代码质量。

## Task 2：客户端迁移

**Files:** 新增 `src/backends/follow-ups.ts`、`tests/ui/gateway-follow-ups.test.ts`；修改 `src/App.tsx`、`src/features/conversation/ConversationPage.tsx` 及相关 e2e。

- [x] 先写请求契约测试，检查请求含 token、幂等 UUID、revision；旧网关 404 明确报错；HTTP 与 WebSocket 后端配置使用同一 HTTP API。运行 `npm test -- tests/ui/gateway-follow-ups.test.ts` 观察失败。
- [x] 入队时先上传文件，把图片与 mention 转为 extraInput，冻结 model/effort/serviceTier/permissions/approvalPolicy/approvalsReviewer。网关确认后清空原草稿，失败或断开仍保留草稿。
- [x] 删除客户端自动发送 effect 与 beforeunload 内存队列保护；按设备同步网关 previews，前台恢复立即刷新；编辑、取消、引导、重试转发到网关。
- [x] 用状态禁用发送中与待确认项的操作；展示发送失败或待确认原因；保留历史编辑/归档队列限制，归档时先取消网关队列。
- [x] 浏览器验证关闭并重开恢复队列、切换会话自动发送、引导保持当前 turn；归档测试会话。
- [x] 独立 reviewer 核对规格，然后核对代码质量；`npm run typecheck` 与相关测试通过。

## Task 3：文档、提交和正式交付

**Files:** `README.md`、本计划实施记录。

- [x] README 记录托管、持久化、顺序、失败/待确认边界和旧网关升级要求。
- [ ] 运行相关服务端/UI/e2e 测试、build 与 diff check，按中文 Conventional Commits 提交并推送。
- [ ] 排队取得部署锁，网关部署到长期目录并回验能力/API。
- [ ] 从双端现有渠道及 CI 版本分配更高统一版本；构建并发布 APK、已签名 IPA、HTTPS OTA、Cloudflare 软件源。
- [ ] JSON、HEAD、完整 GET 核对双端版本、大小、SHA-256；交付展示固定 OTA/APK/IPA 链接；清理本次临时文件与 worktree。

## 实施验证记录

- 最终相关服务端/UI/HTTP 传输单元与集成测试 7 组、192 项通过；TypeScript 检查、前端 build、服务端 build 与 diff check 通过。

- 服务端和客户端分别完成规格审查与独立代码质量审查，发现的持久化、审批、UUID、上传/归档与系统通知问题均已修复。
- 使用真实 WebSocket 协议模拟上游，验证无需客户端在线的后台发送、FIFO、跨线程独立、重启与未知结果恢复、审批桥接及通知授权；未创建真实测试会话或发送真实测试推送。
- 相关浏览器回归 6 项通过，覆盖丢 ACK、取消后的新 UUID、上传期间切换与归档、附件、刷新、编辑、引导和原有队列布局。另有直接发送失败保留草稿的 HTTP 场景通过。
- 扩展 HTTP 浏览器回归中的 result.png 展示和审批失败后按钮恢复两项失败，已在原始 HEAD `5a4f1cb` 的隔离基线重现同一错误，属于现有问题；本次未修改相关实现。
- iOS 0.2.151 发布预检通过：保留 Bundle ID、application-identifier、Team 和兼容基准完整权限，无一次性身份恢复。
- 上游原 `cloudflare/app-source/PUBLISH_PROMPT.md` 已删除；最新版 SignOs `00aeea2` 的现役说明为 `distribution/source-aggregator/README.md` 与 `hosting/home-source/README.md`。签名包继续沿用既有 `codex-mobile-signed/` GitHub 归档订阅，通过现役 Cloudflare 管理 API 同步、元数据与完整散列核验；开发者署名保留原值（已含当前 GitHub 用户）。
