# 消息日期时间与真机安装实施计划

> 使用 superpowers:executing-plans 在当前会话逐项执行；沿用现有隔离 worktree，不并行修改共享文件。

**Goal:** 消息时间显示为 `10月17日 10:43`，用户时间位于气泡内右下角；验证后将整条 AgentApp 集成分支合入 main 并安装至已配对的 iPhone。

**Architecture:** 共享纯 Foundation 格式化逻辑；用户时间占用气泡末行并右对齐，回复及 commentary 保留现有位置。真实时间缺失时继续隐藏，不改业务时间来源。用户已确认仅合并并安装真机，不发布固定渠道。

**Tech Stack:** SwiftUI、Foundation、Vitest 驱动的 Swift smoke、XCUITest、现有 iOS 签名工具和 Apple devicectl。

### 1. 日期时间与气泡排版（先红后绿）

- [x] 在 `tests/ci/agent-session-smoke.swift` 将 commentary 时间期望更新为 `10月17日 10:44`；新增双方消息真实日期、未知日期及秒/毫秒映射断言。
- [x] 在 `mobile/ios/AgentAppUITests.swift` 将用户时间位置断言改为气泡范围内且右下角，并核对回复时间为 `10月17日 10:46`；fixture 补充真实固定回复时间。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci/agent-session.test.ts`，确认旧实现因只显示时分而失败；运行对应 UI 用例，确认旧布局位于气泡外而失败。
- [x] 新建 `MessageTimeFormatting.swift`，使用 `M月d日 HH:mm`、POSIX locale、设备本地时区；ChatMessage 暴露 displayTimestamp，ProgressEntry 使用同一格式。
- [x] 修改 `UserMessageView.swift`：气泡内增加时间占位末行，实际时间 overlay 到末行右侧，背景包含时间，保留隐藏全文测量与展开宽度稳定逻辑。
- [x] 修改 `MessageActions.swift`：只替换时间文案格式，保留回复尾部原位置与耗时；增加时间 accessibilityIdentifier。
- [x] 重跑会话 smoke 与三个 UI 用例：历史时间与用户气泡位置、长消息展开宽度、文字选择。

### 2. 文档与提交

- [ ] 原位更新 `docs/interaction-alignment.md` 的时间格式、用户气泡位置及本轮验证记录，覆盖气泡外旧要求。
- [ ] 读取 `docs/commit-conventions.md`，完成 diff check，提交并推送集成分支。

### 3. 合并与真机安装

- [x] 用户已选择仅合并并安装真机，不发布固定渠道；不登记会触发发包的发布任务。
- [ ] 更新远端 main，在不覆盖他人改动的前提下整合集成分支并运行冲突涉及的回归；发布范围若包含渠道，由 releasectl 处理 main、版本、签名和渠道回验。
- [ ] 通过仓库外既有授权签名配置保留 Bundle ID、application-identifier、Team 和钥匙串组；构建并验签指定真机安装包。
- [ ] 使用 `xcrun devicectl device install app --device <已确认设备标识> <已签名 .app>` 安装，查询安装版本并启动；系统认证或设备解锁由用户完成。
- [ ] 验证安装、启动、网关连接，测试会话若有则归档；交付时区分已安装、已启动与尚需用户验收的界面行为。
