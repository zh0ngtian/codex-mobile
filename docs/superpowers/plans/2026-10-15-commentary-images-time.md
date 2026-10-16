# Commentary 图片位置与分钟时间实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 分任务执行，先规格审查再质量审查；各项遵循 TDD。

**Goal:** 会话图片按原始顺序显示在对应 commentary 下方，Web 与 iOS 原生均显示每条 commentary 的真实时间，精确到分钟，并放在所属图片下方（无图时位于正文之后）。

**Architecture:** 保留现有历史详情及运行 commentary 接口；网关只读本机 rollout，以消息 ID 提取时间，不创建历史数据库、不返回原始记录正文。详情保留媒体 ID 在 messageOrder 中；客户端合并后统一按顺序投影，过程图片跟随过程折叠，生成结果保持原位置并去重。

**Tech Stack:** Node.js、TypeScript、React、SwiftUI、Vitest、Playwright、现有 releasectl。

用户已批准网关只读提取消息 ID 对应的时间，明确显示到分钟。目标会话 `01a138df-ddd9-7051-b23e-f43193fdeec0` 仅只读检查。用户随后明确本次只修改、验证并提交代码，不发布；两个已登记任务已撤回，不提交 ready。

## 任务 1：网关补全权威时间与媒体顺序

文件：新增 `server/message-timestamps.ts` 及对应测试；修改 `server/turn-details.ts`、`server/http-session.ts`、`server/gateway.ts` 及对应测试。

- [x] RED：真实临时 rollout fixture，断言消息 ID 精确匹配、活动与归档文件、无效时间/跨会话/损坏行过滤、增量追加后时间可见、原文件不变；详情保留图片在文字之间的 ID 顺序，时间保留且大工具正文不进入压缩响应。
- [x] GREEN：流式只读扫描，经 session_meta 核对线程，返回有限的 ID→Unix 秒映射；仅给匹配的 assistant 消息加 `timestamp`。接入 HTTP details/commentary 和流式 full/commentary，验证实时 completed 消息与后续历史一致；缺失原记录保持时间未知。
- [x] 运行 `npx vitest run tests/server/message-timestamps.test.ts tests/server/turn-details.test.ts tests/server/http-session.test.ts tests/server/gateway.test.ts --maxWorkers=2`，记录先失败后通过。先规格审查后质量审查。

## 任务 2：客户端恢复顺序与两种界面投影

文件：`src/app-server/thread-session.ts`、`src/features/conversation/Timeline.tsx`、`src/native-ui/projection.ts`，必要的原生展示模型和视图，以及 `tests/ui/thread-session.test.ts`、`tests/ui/conversation.test.tsx`、`tests/ui/native-ui-projection.test.ts`、图片回归。

- [x] RED：摘要回填 c1→image1→c2→image2→final，重复回填保持原顺序、时间和较长实时文本；运行中/完成折叠展开/插话/多 final 均匹配位置，生成图与同源截图不重复；具体时间为 YYYY-MM-DD HH:mm。
- [x] GREEN：先合并 commentary 与媒体再按 messageOrder 排序，顺序锚点覆盖媒体；保留 timestamp。媒体在所在 segment 就地展示，过程历史计数只统计 commentary，去重与缩略图延迟加载保留。原生 disclosure 内各 commentary 保留自己的时间与对应图片。用户随后明确时间移至图片下方，Web wrapper 与原生 blocks/children 均按正文→图片→时间排列；无图时为正文→时间。
- [x] 运行 `npx vitest run tests/ui/thread-session.test.ts tests/ui/conversation.test.tsx tests/ui/native-ui-projection.test.ts tests/ui/image-loading.test.tsx --maxWorkers=2`，先失败再通过。规格与质量分别审查。

## 任务 3：集成验证与提交

- [x] 浏览器 fixture 验证图片 DOM 顺序、两条不同时间、默认折叠与展开；真实目标会话只读核对消息 ID 和时间，不创建真实测试会话。
- [x] 执行 `npm run typecheck`、聚焦 UI/服务端及原生数据契约测试、客户端/服务端构建。不运行发布适配器、不构建安装包；验证只覆盖本次代码。

交付约束：按中文 Conventional Commits 提交推送独立分支 `codex/commentary-images-time-20261015`，不提交 ready，不发布、不部署、不触发安装包构建。本次没有创建真实测试会话；保留独立 worktree 供后续查看代码。

## 验证证据与边界

- 时间读取、接口与顺序回归均先确认失败再实现；补充跨日期/续写/非 v7 文件、对象原型同名 ID 和损坏/追加行验证。
- 客户端回归先确认时间与顺序缺失，再修复；额外覆盖迟到快照吞掉不同用户、未定义项、前后锚点与新插话顺序。
- 真实目标最近回合只读取得 9 条 commentary、21 条图片记录，去重为 18 张。所有 commentary 均匹配真实时间，详情回填与运行 commentary 回填后，图片归属与时间保持一致；原生时间均在对应图片块之后。私有原始数据仅用于本机验证，不提交仓库。
- Chromium 与 iPhone WebKit 的历史重新打开、刷新、分页及图片/分钟时间位置 6 项通过；fixture 缩略图真实解码，DOM 断言顺序为正文、图片、时间。
- 最终扩展回归为 15 套仓库测试共 359 项，另有 1 项本机目标会话只读验证；合计 16 套、360 项通过，覆盖 UI、实时对账、分页、原生投影/宿主与网关接口。
- Node 26 实验性全局 Web Storage 会遮蔽 jsdom localStorage，扩展 UI 测试以 `NODE_OPTIONS=--no-experimental-webstorage` 运行；未为此修改产品代码。
- 媒体协议边界保持既有范围：压缩详情接口仍只补图片引用，未增加视频或无路径失败生成项的网关恢复协议；客户端保留完整历史或已有摘要中的这些项及展示能力。
- 已完成本地 Web 与服务端编译，保留既有 Vite 大 chunk 提示；未构建 Android/iOS 安装包，未发布或部署。

规格与质量独立审查均已通过。网关与客户端的修复和新增回归均已提交，最后提交补充浏览器验收与本文档；交付只推送独立分支。
