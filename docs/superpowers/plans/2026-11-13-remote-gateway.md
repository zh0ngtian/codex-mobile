# 常驻 Remote 网关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有多网关客户端中接入网关持有的官方 Remote 连接，保留本地模式，并实现共享持久队列与离线恢复。

**Architecture:** 设计约束以 [已确认设计](../specs/2026-11-13-remote-gateway.md) 为准。官方 relay 在一个 `RemoteRelay` 中复用，账号认证由独立 provider 提供，逻辑 stream 按目标与客户端会话隔离。服务端入口解析内部请求的模式/目标元数据；用户配置 URL 不变。本地与 Remote 共用目标级持久数据、分离传输。远程文件与命令适配器访问真实目标，绝不将远程路径传给本地文件或 Git API。

**Tech Stack:** Node.js ≥20.9、TypeScript、ws、Vitest、React 19、现有 iOS SwiftUI projection/Android WebView 桥接、CryptoKit Secure Enclave。

源码基线：`7772b28f5e716d8e5e3759fb1e84a089158502ec`。独立 worktree：`/Users/zhongtian/.codex/worktrees/remote-gateway/codex-mobile`。不修改现役 launchd，不注册发布任务，不执行正式打包或部署。

2026-11-13 已快进整合最新远端 `18039476257000573c9014f2dc84ccfa328cb928`。原两项失败已由上游 `ec12e45` 修复；本轮新增错误翻译及项目恢复夹具修复为 `971c1d81a1968ee79c3a90097d5714925d0356ad`，已推送 main。当前完整基线 183 文件、2079 项通过，6 项既有跳过；typecheck 与开发 Web 构建通过。Remote 实现从此提交继续。

## 验证约定

- Node 26 的原生 Web Storage 与现有 jsdom 环境冲突；测试命令设置 `NODE_OPTIONS=--no-experimental-webstorage`，不为环境问题修改产品逻辑。
- 每项行为先写失败测试并实际观察预期失败，再写实现，最后运行对应测试与 `npm run build:server`；必要客户端任务运行 `npm run typecheck`、`npm run build`。
- 实现任务依次执行；每项完成先规格复审，再质量复审。提交使用中文 Conventional Commits，正文含“新增功能”和“主要修改”。
- 官方探针凭据、密钥和原始数据仅存仓库外私有目录；只提交脱敏收据，测试会话完成后及时归档。

## Task 1：官方 relay 协议、复用和安全恢复

文件：新增 `server/remote/relay.ts`、`server/remote/envelope.ts`、`tests/server/remote-relay.test.ts`、`tests/server/remote-envelope.test.ts`。

- [x] 测试两个目标、三个 stream 仅建立一条物理连接，消息不能串流；未知 client/target/stream 丢弃。
- [x] 测试正常与分块服务端消息、重复段、乱序、非法 base64、超额内存、超时清理；测试出站大消息每段上限。
- [x] 测试断线恢复沿用 cursor/stream/seq，不重放任何已发送业务消息；未发送时明确报离线。
- [x] 测试同流服务端序列缺口与前置分块阻止后续通知/响应越过；仅恢复接收历史，不重发业务消息。主连接 cursor 同时受所有流未交付缺口和分块约束，不能只以最近收到的帧推进。
- [x] 测试独立 stream ping/pong、无手机连接仍维持主连接、显式关闭才发送 client_closed。
- [x] 实现 `RemoteRelay`：认证 provider 返回 URL/headers/signChallenge；连接状态明确区分 connecting/online/offline/auth-required/closed。一次只进行一个连接/刷新流程；有界指数退避，认证错误停住，网络错误重试；关闭取消所有计时器。
- [x] 实现每 stream 单调序号、路由校验、有界分段缓冲和背压。断线通知待处理调用结果未知，禁止自动 replay。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/remote-{relay,envelope}.test.ts`；规格/质量复审并提交。

完成记录：`2116448cfd60225f4b6a5d68dae00e5862b1d1c3`，51项协议测试、严格服务端TypeScript检查和服务端构建通过；独立规格与质量复审均通过。正式relay已在官方Remote验证三stream单物理连接RPC和心跳。100MiB上传目标端大小/散列已通过；首次回读断线后，新连接完成100MiB全量回读、总散列及非整块范围校验，临时文件已清理。原断线原因及产品自动恢复仍待验证，属于Task3集成范围；不将此结果扩展为产品完整附件或8小时稳定性通过。

## Task 2：网关自身身份、授权管理和目标目录

文件：新增 `server/remote/auth.ts`、`server/remote/controller.ts`、`server/remote/device-key.swift`、`server/remote/cli.ts` 及对应 `tests/server/remote-auth.test.ts`、`tests/server/remote-controller.test.ts`；修改 `bin/codex-mobile.mjs`、`package.json` 的源码打包清单。

本任务依次拆为2a（私有存储、网关密钥、认证协议与 provider）和2b（控制器、目标目录、OAuth 与 Mac CLI），各自完成红绿验证和两轮审查。2b 按依赖顺序细分为2b.1（有界 RPC session 与 canonical 受管认证 loader）、2b.2（账号绑定控制器、client 可见目录、本机身份证明与配对）、2b.3（OAuth、Mac CLI 及运行配置衔接）；各子项单独红绿验证和两轮审查，避免授权、目录与命令行混在同一模块。新增 `rpc-session.ts`、`managed-auth.ts`、`oauth.ts` 均为本任务内部职责拆分，不改变已确认的连接和授权架构。

密钥执行与私有存储分别使用 `device-key.ts`、`private-store.ts`；Swift 源必须进入 npm 服务端产物，不能只依赖开发源码路径。普通账号令牌复用 canonical app-server 的受管认证及 `account/read {refreshToken:true}`，读取最新凭据并持续核对既有绑定，不由网关另行竞争官方 refresh token；独立控制端身份和密钥仍由网关持有。受管 loader 的每次绑定读取检查本地凭据；首次加载和临近过期时才 singleflight 调用 canonical 刷新，不能在每个签名检查点都触发网络刷新。Remote 会话的刷新使用自己已登记的密钥证明。

2a 已完成：`1c5351c7a2e2441421449586cfd0d9c6a784915e` 通过174项回归（含临时自有 Secure Enclave 密钥）、服务端构建和严格类型检查，独立规格及质量复审均通过。首次创建身份的跨进程竞争、最终硬件等待后的绑定复核与外部异常脱敏已修复；复核按硬件/密钥记录、普通账号、注册记录的固定有界顺序完成，不宣称独立异步来源的跨源原子快照。隔离实例已用此前授权的网关自有密钥通过正式 provider 的三流 RPC、同流断线恢复和新 provider 的磁盘身份恢复；没有重新授权或修改现役服务。最终源码单次断线至三次顺序模型 RPC 全完成为4535ms，不能作为 P95 或8小时验收；[脱敏收据](evidence/2026-11-13-remote-auth-provider-probe.json)保留历次源提交和验证边界。2b 控制器、目录与 CLI 尚未实现，下列混合清单按整个 Task2 验收，不将2a完成标为Task2整体完成。

- [ ] 测试严格绑定账号、工作区、client、密钥 hash、挑战目的/域名/路径/有效期；错误身份/过期/撤销均阻止签名和执行。
- [ ] 测试私有目录 700/文件 600、原子持久化、账号变化暂停且不迁移队列；测试可刷新的会话过期与不可恢复认证错误。
- [ ] 从失败测试实现自己的 Secure Enclave 密钥 helper，复用已验证的公开协议，不读取官方 App 密钥。
- [ ] 实现 Mac CLI 登录、授权、配对、目录、状态与 URL 导出；OAuth 使用 PKCE/state、固定回调 localhost、账号核验；凭据不进入 URL/日志。
- [ ] 实现当前 client 可见目标目录，绑定 env+installation，canonical `remoteControl/status/read` 证明本机身份；不按名字/IP 合并。
- [ ] 控制器设置恢复退避上限并核对实际耗时，以满足已确认的上游恢复后首个轻量 RPC P95≤10秒目标；库的可配置上限不作为已达标证据。
- [ ] 在隔离实例使用用户已授权的网关身份验证 RPC、会话刷新及同 stream 恢复；不重启生产服务。
- [ ] 运行对应 Vitest 与服务端构建；规格/质量复审并提交。

## Task 3：目标权限内的文件与 Git 适配

文件：新增 `server/remote/files.ts`、`server/remote/commands.ts`、`tests/server/remote-files.test.ts`；修改 `server/file-download.ts`、`server/image-preview.ts`、`server/inline-images.ts`、`server/message-timestamps.ts`、`server/image-generation-error.ts`、`server/turn-change-history.ts`、`server/codex-projects.ts`、`server/desktop-thread-pins.ts`、`server/title-summaries.ts` 及模型上传计量的目标接入以注入目标访问能力。

前置探针：官方 `initialize` 直接返回 `codexHome/platformFamily/platformOs`，当前目标目录与 `command/exec` 环境一致，无需猜路径。目标全局状态和 sessions 目录可读取；目标现有计量 socket 权限700/600且归当前用户，但默认 `command/exec` 在 socket connect 阶段返回 EPERM。[能力收据](evidence/2026-11-13-remote-target-capabilities-probe.json)记录此限制；尚未扩大目标权限、借用网关计量或批准功能降级。Task3 接入前须解决该能力约束，必要产品/权限变更须由用户确认。

待用户确认的建议：仅计量读取的固定命令使用官方 `sandboxPolicy: { type: "readOnly", networkAccess: true }`，先在隔离实例验证 socket 连接及来源绑定，成功后才接入该读取路径；其余文件、Git 与业务操作继续默认权限。该例外会开放此命令的网络/socket 连接能力，因此不能视为既有“默认权限”决定已授权。对应探针已在仓库外准备并加未授权执行保护，尚未运行；本条不变更设计现行要求，也不保证该权限组合一定可用。

- [ ] 先在临时目录真实验证 `fs/readFile`、`fs/writeFile`、`command/exec` 和 stdin/stdout 分块；100MiB 文件校验 SHA-256，视频范围读取核对长度与内容，失败恢复不提交半文件。
- [ ] 测试目标路径只交给目标适配器，远程读写/Git 绝不能调用网关同路径本地 fs/exec。
- [ ] 实现有界、带背压、临时文件+校验+原子提交的上传下载和范围读；目标执行使用默认配置权限，不扩大沙箱。
- [ ] 实现项目/rollout 元数据与 Git 统计的目标读取，保留现有时间戳、生成图错误与临时 index 语义。最新 main 的桌面项目归属、置顶、项目 worktree、独立标题总结、网页引用与模型上传计量也纳入目标隔离与功能验收；读取目标元数据，不借用网关本机的对应缓存或 IPC。
- [ ] 测试附件上限、引用文件保留、断线中断、输出截断、路径特殊字符和临时文件清理。
- [ ] 运行相关服务端回归、真实 Remote 文件验收及服务端构建；规格/质量复审并提交。

## Task 4：目标路由、持久队列和会话观察

文件：新增 `server/targets.ts`、`server/operation-queue.ts`、`server/thread-observer.ts` 及相应测试；修改 `server/gateway.ts`、`server/http-session.ts`、`server/follow-ups.ts`、`server/followed-thread-notifications.ts`、`server/index.ts`。

- [ ] 测试本地保持旧 API，内部 Remote 请求携带模式和目标；无效目标、账号改变、未授权均显式拒绝，网关 Mac 的 Remote 路径同样走 relay。
- [ ] `/api/host` 报告版本化能力/授权/配对/临时离线状态，目录仅列有权限目标；CORS 与所有文件/事件/WS 路由一致。
- [ ] 测试 fsync 后才 ACK、固定 UUID 幂等/冲突、共享队列 CAS、每会话顺序、停止/审批优先、绑定原 turn/request、失败/待确认阻塞；已发送写入绝不自动重发。
- [ ] 测试网关重启恢复、元数据和条数容量、控制预留、附件引用、离线新会话占位、读合并/导航取消。
- [ ] 将所有需要上游的操作接入同一目标级 durable ledger，读取可合并或取消过时导航，写入逐条保留；HTTP/WS 与 hosted/Bark/关注共享目标身份而隔离会话；不破坏 Sidechat 私有临时生命周期。
- [ ] 测试已打开会话空闲 60 秒/活跃 3 秒、并发最多 4、前台优先、离线不清理、实际内容指纹时钟跨重启、24 小时释放但主连接保留。
- [ ] 运行所有服务端回归与构建；规格/质量复审并提交。

## Task 5：客户端多网关模式、机器和离线 outbox

文件：修改 `src/backends/types.ts`、`registry.ts`、`probe.ts`、`connection-manager.ts`、`http-transport.ts`、`file-upload.ts`、`follow-ups.ts`、`src/features/backends/BackendManagerSheet.tsx`、`src/App.tsx`、`src/native-ui/device-panel.ts`、`src/native-ui/protocol.ts`、`mobile/ios/AgentUI/Devices/DeviceConnectionForm.swift` 和当前机器菜单；新增目标路由/outbox 模块与对应测试。

- [ ] 测试旧配置迁移默认本地，保留多网关与各自模式；URL 格式、token 规则不变。
- [ ] 测试选模式不生效，“测试并保存”先验证后提交；旧网关/未配对/未授权报错不破坏原状态，已配置 Remote 临时离线可保存。
- [ ] 测试目录和按网关分组机器、同物理机不同来源不合并、同网关本地/Remote 本机共用草稿关注、跨网关独立、目标消失不替换。
- [ ] 实现全部 RPC、事件、文件、图片、视频、通知 URL 的统一内部路由；持久 session/operation namespace 防止模式串线。
- [ ] 实现手机 outbox 字节和冻结上下文持久化，交接 ACK 丢失查收据不重发；所有手机看到共享排队内容，CAS 编辑取消冲突有提示。
- [ ] 模式成功切换回列表并保留草稿/阅读位置；删除配置仅暂停该手机 outbox，不取消网关队列。
- [ ] 同步中文/现有多语言文本与原生桥接，保持单一 Web 业务连接；iOS picker 同表单，Android 使用共用界面逻辑。
- [ ] 运行相关 UI/桥接/outbox 回归、typecheck 和开发 Web 构建；iPhone 17 Pro 竖屏正常字号验收；规格/质量复审并提交。

## Task 6：集成验收、文档和源码交付

- [ ] 更新 `docs/interaction-alignment.md` 现行条款、验收和变更记录；更新 README/文档索引与 Mac 授权运维文档，各阶段状态准确区分待实现/待验收/已验证。
- [ ] 运行完整相关回归和服务端/客户端开发构建；全量功能以官方 Remote 真实目标核验，无能力降级。
- [ ] 隔离网关完成 8 小时、跨凭据刷新、手机重入、网络断开、网关重启；Mac 睡眠唤醒在可控时段实施，不干扰现役工作。保存脱敏延迟分位数和收据，及时归档测试会话。
- [ ] 规格审查后进行全量质量审查，修复后复审；未达到验收目标不得标成通过。
- [ ] 遵守 `codex-mobile-main-production` 互斥，fetch 最新 main；变化时对整合结果相关回归，无变化复用已完成验证。保护主工作区已有暂存改动。
- [ ] `git diff --check`、准确提交并推送 main；核对远端包含本次 SHA。只交付源码，不触发发布协调批次、APK/IPA 或生产部署。
