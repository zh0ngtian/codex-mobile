# 常驻 Remote 网关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有多网关客户端中接入网关持有的官方 Remote 连接，保留本地模式，并实现共享持久队列与离线恢复。

**Architecture:** 设计约束以 [已确认设计](../specs/2026-11-13-remote-gateway.md) 为准。官方 relay 在一个 `RemoteRelay` 中复用，账号认证由独立 provider 提供，逻辑 stream 按目标与客户端会话隔离。服务端入口解析内部请求的模式/目标元数据；用户配置 URL 不变。本地与 Remote 共用目标级持久数据、分离传输。远程文件与命令适配器访问真实目标，绝不将远程路径传给本地文件或 Git API。

**Tech Stack:** Node.js ≥20.9、TypeScript、ws、Vitest、React 19、现有 iOS SwiftUI projection/Android WebView 桥接、CryptoKit Secure Enclave。

源码基线：`7772b28f5e716d8e5e3759fb1e84a089158502ec`。独立 worktree：`/Users/zhongtian/.codex/worktrees/remote-gateway/codex-mobile`。不修改现役 launchd，不注册发布任务，不执行正式打包或部署。

2026-11-13 已快进整合最新远端 `18039476257000573c9014f2dc84ccfa328cb928`。原两项失败已由上游 `ec12e45` 修复；本轮新增错误翻译及项目恢复夹具修复为 `971c1d81a1968ee79c3a90097d5714925d0356ad`，已推送 main。当前完整基线 183 文件、2079 项通过，6 项既有跳过；typecheck 与开发 Web 构建通过。Remote 实现从此提交继续。

2026-11-13继续Task2b前记录最新远端main为 `2e0ca6e9f5e78000ad0e6c5c065c6c96a3379722`，包含已完成的Task1/2a与阶段文档。固定统计读取权限例外已获用户批准且隔离验证通过，其他操作继续默认权限。

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

2a 已完成：`1c5351c7a2e2441421449586cfd0d9c6a784915e` 通过174项回归（含临时自有 Secure Enclave 密钥）、服务端构建和严格类型检查，独立规格及质量复审均通过。首次创建身份的跨进程竞争、最终硬件等待后的绑定复核与外部异常脱敏已修复；复核按硬件/密钥记录、普通账号、注册记录的固定有界顺序完成，不宣称独立异步来源的跨源原子快照。隔离实例已用此前授权的网关自有密钥通过正式 provider 的三流 RPC、同流断线恢复和新 provider 的磁盘身份恢复；没有重新授权或修改现役服务。最终源码单次断线至三次顺序模型 RPC 全完成为4535ms，不能作为 P95 或8小时验收；[脱敏收据](evidence/2026-11-13-remote-auth-provider-probe.json)保留历次源提交和验证边界。此处仅记录2a阶段，2b现状以下方分项为准；下列混合清单按整个Task2验收，不将2a完成标为Task2整体完成。

2026-11-13开始2b.2时记录最新远端main为 `47eb43029464d8df19e2a936bbb15a766c7b96cb`，2b.1已在共享main互斥下推送并核对；未更新原工作区本地main引用或暂存内容。2b.2内部将REST目录/配对协议放入`catalog.ts`，控制器生命周期与绑定放入`controller.ts`，分别测试。为满足既有实际密钥变化监控要求，`auth.ts`增加只核验现有登记及硬件公钥的`verifyBinding`接口并扩充原认证测试；不触发登记、Remote REST或独立refresh token刷新。

协议事实补充：2b.2开发前已实测canonical状态为顶层`status/environmentId/installationId`，配对有效期为秒；同一自有client领取同一Mac的配对证明返回HTTP200，响应`claimed_at`为可解析日期字符串，client/env/code精确匹配，目录双ID复核通过。仅作为协议事实，不代表2b.2产品实现验收。见[脱敏协议收据](evidence/2026-11-13-remote-controller-protocol-probe.json)。

2b分项状态：

- [x] 2b.1 有界管理RPC session与canonical受管认证loader。
- [x] 2b.2 账号绑定控制器、client可见目录、本机身份证明与配对。
- [ ] 2b.3 OAuth、Mac CLI及运行配置衔接。
  - [x] 2b.3a 一次性OAuth模块及隔离回调/交换验证。
  - [ ] 2b.3b Mac CLI、唯一控制器运行配置及显式恢复/关联；第44/45项已确认。

2b.3继续按内部依赖顺序拆为两项：先完成有界、一次性的PKCE/state OAuth流程及其隔离回调/交换测试，再接入Mac CLI、唯一控制器的运行配置与显式恢复/重新关联。每项均先红绿验证，再规格和质量复审；OAuth子项只返回已核验的短期step-up结果，不自行登记、迁移既有身份或创建Remote主连接，CLI子项完成前不将2b.3或Task2整体标为完成。

2026-11-13开始2b.3a时记录已推送并核对的最新main为 `b78bd619456aa0c07d6049df4880ecb942bd6b22`。本子项仅新增`oauth.ts`与隔离测试；使用固定localhost回调、PKCE/state和当前canonical受管身份，不触发真实重新授权或创建第二条Remote主连接。2b.3b再接入命令行、运行配置和显式恢复/关联。

2b.3a完成记录：最终源码 `2262a93427e967ef3d2f1aaa9b3fd3c09ab3d868`，97项OAuth专项测试及全部11个Remote测试文件375项通过，1项既有硬件opt-in跳过；严格服务端类型检查、服务端构建及独立规格/质量复审通过。固定回调仅在端口占用时使用指定备用端口；独立state和PKCE、短期令牌核验、共享取消及资源回收均有界。实际失败回归修复了响应收尾期间身份变化、同步阻塞后越过绝对期限仍成功以及最后异步复核期间令牌过期/新鲜度失效；最终返回前重新证明完整受管身份并同步复验令牌。所有网络交换和浏览器均为测试替身，HTTP回调使用隔离临时端口；没有读取真实凭据、占用实际授权端口、重新授权或登记。见[隔离验收记录](evidence/2026-11-13-remote-oauth-isolated-validation.json)。该子项未接入运行网关，不代表2b.3或Task2整体完成。

2b.3b开始前的两个架构点已整理为[Mac管理与身份恢复补充方案](../specs/2026-11-13-remote-gateway-cli-proposal.md)：第44项确定CLI只管理已运行网关的进程归属，第45项确定撤销后的新身份先验证再原子切换并保留旧绑定。用户已明确全部按推荐，状态为**已确认、待实现验收**，不允许离线写入或原地覆盖登记。

2026-11-13开始2b.3b时记录最新远端main为 `a9d5f34442f810df88c2dc699cf1eb63dd626f48`，工作区干净。继续复用子代理实现、TDD与规格/质量两阶段审查。为分别验证崩溃、生命周期和进程归属，内部拆为以下依赖项，不改变已确认架构：

- [x] 2b.3b.1 `server/remote/identity-registry.ts`及测试：独立私有候选记录、完整绑定校验、活动身份指针CAS和崩溃后只采用已提交身份，保留旧身份。
- [x] 2b.3b.2 `server/remote/runtime.ts`、`server/remote/runtime-state.ts`、`server/remote/runtime-lifecycle.ts`、`server/remote/login.ts`及测试，必要时扩充controller的显式重新关联/目标预绑定接口：同一网关串行管理canonical登录、首次授权/配对/恢复、停止旧主连接后准备新身份，原身份与目标复核及暂停保留。暂停名单单独持久化，以完整tuple保留旧installation，不因配对或重启清除；取消、绝对期限与资源清理边界独立为内部助手，不增加产品API。
- [ ] 2b.3b.3 `server/remote/admin.ts`、`bin/remote.mjs`及测试，修改`server/index.ts`、`bin/codex-mobile.mjs`等入口：当前用户私有有界管理通道、单网关进程归属、CLI仅连接已运行实例，使用实际canonical地址；Local启动与既有URL不受授权状态影响。

各项独立红绿、规格与质量审查；只有运行入口、CLI及隔离生命周期全部通过后才标记2b.3b完成。不启动现役服务、不执行真实授权撤销或登记、不构建客户端。

2b.3b.1完成记录：最终源码 `ca370fe75cef837674baa6908ab1a284b91b970b`，55项身份存储测试和全部12个Remote文件430项通过，1项既有硬件opt-in跳过；严格服务端类型检查、服务端构建及独立规格/质量审查通过。候选handle、基线和路径隔离，完整key/enrollment/controller记录核验后在跨进程锁下CAS切换单一活动指针；普通授权保留完整managed/local，独立显式本机重新关联只允许保留managed/enrollment并确认新local。真实子进程竞争、提交前后终止、rename后fsync故障及首次指针读取竞态均有验证；旧身份和未完成候选保留。合法targets增长不改变稳定身份，缺失userId变为新增也被拒绝。见[隔离验收记录](evidence/2026-11-13-remote-identity-registry-validation.json)。本项只完成持久层，运行管理、真实证明、私有管理通道和CLI继续后续开发，不能据此标记2b.3b或Task2完成。

2b.3b.2开始时记录已推送main为 `0bc1d65c0f7520c3bf9bec3a7509ddba02273e10`。运行管理、普通canonical登录和逐目标暂停存储按独立职责实现；先使用临时私有目录、测试工厂及隔离HTTP/WS验证生命周期，完成独立规格及质量复审后再接入CLI。本子项尚未执行新的真实OAuth、登记或身份撤销操作。

2b.3b.2完成记录：最终源码 `335ed58f1e3bea240299dcaccf6a74e4dbecd487`，全部16个Remote文件492项通过，1项既有硬件opt-in跳过；严格服务端类型检查、服务端构建和独立规格/质量复审通过。运行层串行管理普通canonical登录、首次授权、独立候选恢复与显式重新关联；完整tuple暂停持久保留，旧主连接停止及存储收尾前不准备新身份。审查复现并修复恢复取消后迟到启动、离线目标误清暂停、本机重新关联冲突、登录最终清理取消、健康目标被其他目标拒绝关闭及已兑现未交付资源回收，磁盘reason严格要求白名单字符串。见[运行层隔离验收记录](evidence/2026-11-13-remote-runtime-validation.json)。

同一最终源码的正式Remote隔离探针复用此前已授权的网关自有身份，禁止新密钥、OAuth和登记：5次并发start只准备1条主连接，3条管理流RPC通过；主动断线至原3流顺序model/list全部完成4380ms；关闭逻辑流后35秒主连接保留，prepare次数不增加。仅隔离登记变化触发暂停，恢复记录并重建runtime仍不自动连接；显式恢复原完整tuple至RPC完成7938ms，无新登记。首次启动至3流RPC全完成12980ms。见[脱敏运行层收据](evidence/2026-11-13-remote-runtime-product-probe.json)。实例重建不是OS进程重启，这些单次耗时和短时保活不代表P95或8小时验收；未创建聊天、执行模型推理、修改现役服务或构建客户端。私有管理通道、Mac CLI与入口继续2b.3b.3，不能标记整个Task2完成。

2b.1完成记录：最终源码 `797fef5d21eeb026d40334b535e5f713c3dc2cc9`，38项新增专项测试、9文件211项相关回归通过，1项既有硬件opt-in跳过；严格服务端TypeScript检查、服务端构建和独立规格/质量复审通过。RPC使用已核验JSON快照，canonical待写字节与数量独立有界，未完成写入超时关闭并清理；loader按连接隔离refresh/singleflight，文件读取超时关闭关联会话，保留原绑定，旧结果不得污染新连接。最终隔离实测39次loader加载保持账号绑定，三条管理流复用一条官方物理连接，同流主动断线至三次顺序模型RPC全部完成5015ms，新provider恢复磁盘身份的RPC为1224ms，无重新授权或生产改动。首次实际验证曾在初始化前发生连接离线，旧session按设计终止；探针改为online后新建初始逻辑流，失败记录一并保留，未重放请求。见[脱敏受管认证/RPC收据](evidence/2026-11-13-remote-managed-auth-rpc-probe.json)。该阶段未覆盖controller/目录与产品路径，不代表P95、真实网关进程重启或8小时验收。

2b.2完成记录：最终源码 `00dd49b6e1ac719adad027b301e4892996e78bc2`，目录28项、控制器46项专项测试及全部10个Remote测试文件278项通过，另1项既有硬件opt-in跳过；严格服务端类型检查、服务端构建和独立规格/质量复审通过。绑定与暂停私有持久化，账号/本机/实际硬件身份变化不会自动覆盖；原始流unknown pong、配对目录发现重装、同步关闭异常及管理工厂构造失败均已补充红绿回归并修复。

正式controller/catalog隔离实测通过：未start时只用canonical及REST证明当前client可见目录和本机双ID，三条管理流仅一条官方物理连接；主动断线至原流三次顺序模型RPC全完成4917ms；关闭全部逻辑流后35秒内物理连接与认证准备次数均未增加。仅修改隔离登记记录触发暂停，恢复原记录并重建实例后仍暂停，Mac显式resume才重新连通且原完整绑定不变。见[脱敏控制器收据](evidence/2026-11-13-remote-controller-catalog-probe.json)。本次没有重新授权、模型推理、测试聊天或现役网关改动；实例重建不是OS进程重启，单次恢复与35秒保活不代表P95或8小时验收。本次首次启动到模型列表完成14209ms，显式resume到模型列表完成25735ms，包含身份/会话准备；性能目标仍待专项验收；OAuth/CLI、目标业务、共享队列及手机入口继续后续任务。

后续只读分段测量以源码`b78bd619456aa0c07d6049df4880ecb942bd6b22`在新的隔离目录完成：首次受管认证读取4761ms、初始helper准备569ms，硬件公钥复核每次7–25ms、签名21–35ms，Remote会话prepare为2862ms；controller.start返回1768ms后继续等待online10952ms，管理流初始化1274ms、模型列表600ms。嵌套计时不能重复相加；本样本不支持移除身份复核以优化延迟。第二次只读握手样本的socket创建到升级2288ms、挑战核验及签名97ms，controller开始到模型列表9621ms，首次受管认证读取3768ms仍在其前；两次样本存在网络波动，不能只选择更快的一次宣称达标。DNS/TLS/HTTP升级仍待分别细分，见[分段耗时收据](evidence/2026-11-13-remote-controller-stage-timing-probe.json)，不代表P95已达标。

- [ ] 测试严格绑定账号、工作区、client、密钥 hash、挑战目的/域名/路径/有效期；错误身份/过期/撤销均阻止签名和执行。
- [ ] 测试私有目录 700/文件 600、原子持久化、账号变化暂停且不迁移队列；测试可刷新的会话过期与不可恢复认证错误。
- [ ] 从失败测试实现自己的 Secure Enclave 密钥 helper，复用已验证的公开协议，不读取官方 App 密钥。
- [ ] 实现 Mac CLI 登录、授权、配对、目录、状态与 URL 导出；OAuth 使用 PKCE/state、固定回调 localhost、账号核验；凭据不进入 URL/日志。
- [ ] 实现当前 client 可见目标目录，绑定 env+installation，canonical `remoteControl/status/read` 证明本机身份；不按名字/IP 合并。
- [ ] 控制器设置恢复退避上限并核对实际耗时，以满足已确认的上游恢复后首个轻量 RPC P95≤10秒目标；库的可配置上限不作为已达标证据。
- [ ] 在隔离实例使用用户已授权的网关身份验证 RPC、会话刷新及同 stream 恢复；不重启生产服务。
- [ ] 运行对应 Vitest 与服务端构建；规格/质量复审并提交。

## Task 3：目标权限内的文件与 Git 适配

文件：新增 `server/remote/files.ts`、`server/remote/commands.ts`、`tests/server/remote-files.test.ts`；修改 `server/file-download.ts`、`server/image-preview.ts`、`server/inline-images.ts`、`server/message-rollout-files.ts`、`server/message-timestamps.ts`、`server/web-citations.ts`、`server/local-thread-metadata.ts`、`server/image-generation-error.ts`、`server/turn-change-history.ts`、`server/codex-projects.ts`、`server/desktop-thread-pins.ts`、`server/title-summaries.ts`、`server/sidechat-replay.ts` 及模型上传计量的目标接入以注入目标访问能力。Bark完成通知的rollout分类补查同样使用目标读取能力；网关自己的队列、通知订阅和附件缓存仍按已确认来源范围持久化，不能把目标路径交给本地fs。

前置探针：官方 `initialize` 直接返回 `codexHome/platformFamily/platformOs`，当前目标目录与 `command/exec` 环境一致，无需猜路径。目标全局状态和 sessions 目录可读取；目标现有计量 socket 权限700/600且归当前用户，但默认 `command/exec` 在 socket connect 阶段返回 EPERM。[默认权限能力收据](evidence/2026-11-13-remote-target-capabilities-probe.json)保留原结果。

2026-11-13用户已批准的例外：仅固定计量读取命令使用官方 `sandboxPolicy: { type: "readOnly", networkAccess: true }`，其余文件、Git与业务操作继续默认权限。隔离实例已通过socket连接、目标codexHome归属、私有权限/owner/inode及精确canonical来源hash校验；未重新授权、未修改现役服务、未发送模型请求。见[脱敏例外验证收据](evidence/2026-11-13-remote-meter-readonly-network-probe.json)。此验证仅证明当前Mac的hello/来源读取能力，统计快照、持续更新与产品接入仍待Task3实现验收；不得将例外开放为客户端任意脚本或沙箱参数入口。

- [ ] 先在临时目录真实验证 `fs/readFile`、`fs/writeFile`、`command/exec` 和 stdin/stdout 分块；100MiB 文件校验 SHA-256，视频范围读取核对长度与内容，失败恢复不提交半文件。
- [ ] 测试目标路径只交给目标适配器，远程读写/Git 绝不能调用网关同路径本地 fs/exec。
- [ ] 实现有界、带背压、临时文件+校验+原子提交的上传下载和范围读；目标执行使用默认配置权限；只有用户已批准的固定统计读取命令可使用上述只读加网络例外。
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
