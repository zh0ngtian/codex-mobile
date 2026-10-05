# 弱网长会话与请求确认修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 真机弱网下能够打开长会话，每页只加载 5 个回合；响应丢失后自动确认原请求，不重复发送或把已接受消息恢复成待发送草稿。

**Architecture:** 保留普通文字 HTTP 轮询。初始化握手与事件同步分离；事件消息按 64 KiB 预算分页，单个较大事件仍能推进游标，审批保持完整。网关提供只读 `mobile/turns/details`，在局域网上游读取完整页后，只返回修改统计和图片引用；客户端 HTTP 传输将补齐请求映射到该方法，旧 WebSocket 仍使用原协议。未确认写入以原 UUID 查询 `/api/operations`，通过结构化通知与发送 UI 对账。

**Tech Stack:** TypeScript、React、Vitest、Playwright、Android WebView、ADB/CDP。

---

## Task 1：网关精简补齐与小页事件

Files: `server/http-session.ts`、`server/turn-details.ts`、`tests/server/http-session.test.ts`。

- [x] RED：真实网关测试覆盖大工具输出被移除、diff 统计正确、图片路径保留、只读不落盘、每页预算和大单事件游标推进、完整审批。8 项预期失败。
- [x] GREEN：增加 `mobile/turns/details`，参数 `{threadId,cursor?,limit:5,sortDirection:"desc"}`；上游调用 `thread/turns/list` 的 full 页；结果 `{data:[{id,loadedChangeStats:{additions,deletions},items:[image references]}],nextCursor}`。有 savedPath 时不重复返回 base64；没有文件引用时保持已有内联图片兼容。
- [x] GREEN：事件消息预算从 512 KiB 改为 64 KiB；空页允许一个较大事件，避免无限空分页。审批不是文本摘要，不能截断或丢失。
- [x] VERIFY：`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/server/http-session.test.ts`，39/39 通过；服务端类型检查通过。
- [x] 独立规格审查和质量审查通过。质量复核发现固定 60 秒 TTL 导致弱网积极翻页过期；追加 RED→GREEN 真实网关测试与成功 continuation 续期，闲置仍过期、过期不复活、容量限制不变。

## Task 2：客户端初始化、五回合和自动对账

Files: `src/backends/http-transport.ts`、`src/app-server/client.ts`、`src/app-server/thread-session.ts`、`src/App.tsx`、`src/i18n.tsx`、`tests/ui/http-transport.test.ts`、`tests/ui/thread-session.test.ts`、`tests/e2e/http-fixture.ts`、`tests/e2e/http-polling.spec.ts`。

- [x] RED：首轮 events 挂起不阻塞 initialize；首次、历史、最近页均为 5；HTTP full 补齐走轻量方法；丢失 ACK 后在线/前台和定时恢复自动查询同 UUID；completed.error 是失败；关闭后不通知；新输入不被清空。
- [x] GREEN：initialized 仅启动后台 poll，不 await 首轮事件；初始精简读和事件同步可并行。
- [x] GREEN：所有页大小改为 5；HTTP transport 内部将 full 补齐变为 `mobile/turns/details`，对调用者保留结果结构。仅明确 `-32601` 时回退旧只读协议并缓存能力，新只读 UUID 用于后续 POST/GET，写入 UUID 不变。
- [x] GREEN：增加 `HttpOperationPendingError(requestId,message)` 和 `mobile/operation/confirmed` 通知 `{requestId,request,response}`。后台只查询，未知结果保留，明确完成才删除持久化项；失败操作同样传递真实 RPC error。网络/前台恢复及定时触发串行、有界对账，防止与 send 在途操作竞态；持续读取不延期已有对账期限。
- [x] GREEN：App 按 requestId 记录本次发送上下文与失败恢复回调。待确认不删除乐观消息、不恢复可重复发送草稿；显示“发送状态确认中”。确认成功仅清除此操作状态并读取当前精简状态，不重放过期的 inProgress ACK；明确失败恢复原输入，保留后续新输入，必要时进入现有手动失败队列。thread/start 确认恢复已创建线程、服务端设置和未发送正文；历史编辑未知写入保持提交锁，已确认回退先解锁本地编辑草稿，再异步校正，禁止自动重发。
- [x] VERIFY：43 项定向 Vitest、13 项 HTTP Playwright 测试通过；规格审查与质量复核通过。审查发现的新会话失败原输入丢失、配置未同步、历史编辑未知写入重复提交、持续读取导致对账饥饿和旧网关回退缺失均完成真实 RED→GREEN。

## Task 3：集成、真机验收与固定渠道交付

Files: 本计划、必要的验收记录；真机证据保存到仓库外 `../codex-mobile-proof/weak-network-v0.2.74-five-turns`，避免 Playwright 重跑清理。

- [x] `NODE_OPTIONS=--no-experimental-webstorage npm test`；`npm run build:package`；定向 HTTP E2E。
- [x] 复核已有图片预览、审批和排队流程未退化；已合并 origin/main 的已发布等价统计修复，保留其他会话的提交。
- [x] 使用 finishing-a-development-branch 技能按仓库已明确要求提交、推送，不重复询问发布方式；中文 Conventional Commit 正文包含新增功能和主要修改。已集成到 main 并推送，真机发现的布局追加修复仍需推送后重新构建。
- [ ] 推送后构建高于固定渠道的新 APK，同时升级实际使用的网关；版本选择以发布前固定清单为准。
- [ ] 真机 WebView 注入弱网：400 ms/128000 B/s/32000 B/s 与 1200 ms/32000 B/s/8000 B/s；只读原始长会话，发送用专用可归档测试会话。测量列表、首次五回合、历史五回合、输入与发送确认；模拟已执行但 ACK 丢失，验证恢复后没有重复 turn、残留错误或恢复草稿。
- [ ] 归档自建测试会话、恢复网络条件、清理本次无用临时文件。
- [ ] 固定渠道 publish-channel 后通过 JSON、HEAD、GET 核对版本、字节数、SHA-256；交付固定下载地址与这些实测值。

## 已有证据与边界

- 基线 74 个文件、515 项测试通过。真机上一轮重度弱网无法完成首轮初始化；统计 full 响应达到 8,051,910 字节。
- 上一轮 ACK 丢失后服务端仅执行一次，但客户端遗留待确认错误、恢复的草稿和未清理写入记录。
- 集成验证：74 个测试文件、539 项测试及 `VITE_APP_VERSION=0.2.74 npm run build:package` 通过。旧 `mobile.spec.ts:1173` 的图片数量断言在基线 `19844cc` 同样失败，未混入本次修复；本次聚焦图片补齐测试验证显示、不重复和预览。
- 本计划提交时真机验收与固定渠道发布尚待执行；实际交付以最终发布结果和真机证据为准。
- 不向用户原始长会话发送消息。WebView 网络限速不冒充蜂窝 RF/TCP 丢包；加载是原生进程内页面重载，不冒充进程冷启动。

## 首个候选包真机证据

- 源码 `99f1bfc`，未发布的候选 APK 0.2.74；实际网关已升级到 0.2.74。原始长会话有 582 个回合，加载只读，不向原会话发送。
- LGE_AN10 / Android 12 原生 WebView。正常、中度、重度网络各 3 次，所有首次加载均为 5 个回合，历史补页后为 10 个；网络记录只有 summary 和轻量 details，没有 HTTP full 回合或应用 WebSocket。
- 中位数（秒）：正常列表 0.542 / 打开五回合 0.800 / 历史五回合 0.607 / 输入 0.193；中度 2.629 / 1.087 / 1.059 / 0.225；重度 8.102 / 2.833 / 3.328 / 0.223。重度从页面重载到打开长会话共 11.416 秒，基线 60 秒内未完成初始化。
- 相同五回合 details：最近 full 84,149 字节、历史 full 7,967,776 字节，精简结果均为 728 字节。重度网络下统计最终全部补齐。
- 正常发送确认 58 ms；重度发送确认 1.231 秒，sleep 5 执行状态约 7.004 秒显示。模型完成耗时不作为纯网络指标。
- 服务端执行后丢弃 ACK、断网 8 秒：恢复后 0.492 秒完成对账，后续新草稿保留，没有错误；原 UUID operation completed，匹配发送只有 1 个回合，pending 存储为空。
- 同时发现根页面的待确认提示破坏真机安全区和键盘布局；`fbe181bf` 已迁入 ConversationPage 既有 RunProgress 区域，3 项新增测试完成 RED→GREEN，31 项相关单元测试、13 项 HTTP E2E、package build 通过，独立规格审查通过。重新构建、安装和复测最终候选包后才发布。
- 第二个候选包 `34c1d0f` 重度复测：首次仍为 5、补页后 10；列表 7.462 秒 / 五回合 3.006 秒 / 历史五回合 3.350 秒 / 输入 0.273 秒。ACK 丢失后恢复 0.560 秒，原请求 completed、服务端仅一个匹配回合、没有残留 pending、新草稿保留。
- 追加原生键盘适配：真机确认根提示不再侵入状态栏，但 edge-to-edge 的原有 Android insets listener 仅处理 systemBars.bottom，忽略 IME，WebView 仍按全屏高度布局，输入栏被键盘遮挡。Android 打包生成的 MainActivity 应在底部使用 `maxOf(systemBar.bottom, ime.bottom)`，保持原顶部安全区和无键盘布局；增加现有 CI 打包测试及生成源码硬化断言。修复后再次从已推送源码构建未发布的 0.2.74，并以真实 IME 截图、输入栏和提示位置验证后发布。
- `14f758f` 已实现原生 IME 底部适配；已有 packaging 测试真实 RED→GREEN，8 项通过，YAML/Bash/Python 语法与 diff 检查通过。该修改不影响网关或已验证的 WebView 资源，最终 APK 真机检查仍待完成。
