# AgentApp 对话细节修复计划

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent history presentation task and parent-owned scroll/link task, followed by spec and quality review.

**Goal:** 按用户四点验收反馈修复消息末尾空行、链接点虚线、历史过程及二次下拉加载，继续仅模拟器验收，不发布。

**Architecture:** 保留现有真实业务与 thread.older 命令；仅修复原生展示投影和滚动手势门控。真实正文仍用于复制/历史编辑，展示时不保留多余末尾空行。历史过程保留原始条目身份、正文与真实时间/媒体，不使用当前时间补缺。

**Tech Stack:** SwiftUI、Observation、既有 NativeSnapshot / NativeCommand、Vitest 驱动 Swift smoke、XCTest。

## 参考图与归一化

- 折叠图：890 × 130 px；展开图：932 × 352 px，均是裁剪图，未知设备倍率，不能按整屏宽度硬算点值。
- 用户进一步明确以 `/Users/zhongtian/WorkSpace/AgentApp` 代码为首要依据：复用原有 CommentaryHistoryView/MessageView/liveCommentary 组合；截图仅作对照，不另创字体、透明度或分隔线样式。
- 标题文案严格为“之前的 N 条消息”，右侧小 chevron；展开后依次显示正文、HH:mm、浅色分隔线；去掉卡片边框与额外复制行。
- 颜色沿用原型文字与 secondary、浅色分隔线，最终在 iPhone 17 Pro 正常字号竖屏截图核对。

## 任务 1：消息正文与历史真实投影

- [x] 用真实 NativeSnapshot 数据回归复现：消息末尾 LF/CRLF 空行；两条 commentary 的计数、原始时间和媒体；仅显示一次历史过程且不附空复制行。
- [x] 如需扩展快照，只增加显式可选展示字段，不改网关协议；历史过程按独立条目映射到 ProgressEntry。
- [x] UserMessageView 的可见文字及测量文字使用相同 displayText，复制和编辑仍使用 message.text 原文。
- [x] CommentaryHistoryView 直接复用参考代码的计数、chevron、正文、分钟时间和分隔线；折叠媒体随条目一起收起。
- [x] 运行相关 TS/Swift 回归与类型检查并提交本任务拥有路径。

## 任务 2：链接点线

- [x] 修改 NativeInlineMarkdown 的链接断言，先观察 .dash 与 .dot 的真实 Swift 属性差异产生失败。
- [x] 改为 Text.LineStyle(pattern: .dot)，不改链接目的地，普通文本/代码不得出现下划线。
- [x] 执行既有 Markdown/文件引用回归。

## 任务 3：历史二次下拉手势

- [x] 建立小型历史加载状态模型，测试首次到顶不触发、同一拖动越界不触发、松手后下一次向下拉超过阈值才加载。
- [x] 覆盖初始内容就在顶端、程序滚动/首屏布局不加载、单次拖动仅请求一次、加载中和无更多历史禁用、失败后可再拉重试、切换会话清理状态。
- [x] 移除 ConversationScreen 的可点击加载按钮和到顶立即加载逻辑，绑定真实手势阶段/几何数据；保留旧消息插入前的可见锚点，防止跳到底部。
- [x] 仅在请求真实业务完成后释放加载状态，旧上下文完成不得修改新会话滚动位置。

## 任务 4：截图、模拟器与提交

- [x] 准备只用于 DEBUG 的稳定展示夹具，覆盖真实历史投影、长短用户消息、网页与文件链接和分页手势；不把它作为真实网关测试成功证据。
- [x] iPhone 17 Pro 正常字号竖屏截图核对折叠与展开；XCTest 验证首次到顶/第二次拉动以及阅读锚点。
- [x] 核对既有网关连接与基本对话仍可用，测试会话及时归档。
- [x] 审查修复后提交推送当前分支，更新模拟器验收应用，保留连接，不发布。

## 审查补充

- 实时过程以原始 normalized 尾段的显式标记进入 `liveCommentary`，不能被工具汇总在 wire 中的尾置顺序误导；已完成过程按参考 `MessageView.commentary` 组合。
- 历史前插后，等待拖动回到 idle 且加载结束再恢复阅读位置；wire ID 因 continuation 回合归并改变时，使用原始 item 的稳定锚点找回新 UUID，历史/工具聚合行保留成员别名。
- 同一会话重新打开也会改变 contextId，必须重置局部加载与手势状态，不能仅监听 conversationID。
- 两个分页边界已在去除修复的生成工程中运行 XCTest 并观察到实际失败，最终源码的绿色验证另见验收记录。

## 最终验证

- 相关 Vitest / Swift smoke：7 个文件，90 项通过。
- `npm run build`（含 TypeScript 检查）通过。
- iPhone 17 Pro、iOS 26.5、正常字号竖屏：4 项 XCTest 全部通过；覆盖参考历史组件、尾部空行、二次下拉及重归组锚点、同会话重开解锁、真实网关执行进展/只读工具/最终回复与归档。
- 最终应用已无 DEBUG 夹具参数普通启动，继续使用模拟器原有的“验收 Mac”连接；没有发布、合并 main 或部署网关。
- 机器本地日志、截图与 xcresult 位于 `.mobile-build/conversation-polish/`，其中独立夹具证据与真实网关证据分开保存；连接凭证未进入代码或提交。
