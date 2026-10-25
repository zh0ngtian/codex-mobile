# 模型总结真实桥接回归

使用独立 iPhone 17 Pro、正常字号、竖屏。夹具由真实网关与隔离 app-server 协议替身组成，不启动模型、不访问生产网关或用户会话，退出时删除临时状态。

1. 运行 `npx tsx tests/fixtures/title-summary/gateway.ts`，保留输出的 `gateway`、`control`。
2. 在隔离生成的 UI 测试宿主中更新内置前端，再运行 `node tests/fixtures/desktop-pins/seed.mjs .mobile-build/ios/pakeplus/PakePlus/index.html '<gateway>'` 预置设备。不得把预置首页用于正式构建。
3. 将两个地址分别通过测试运行器环境 `TEST_RUNNER_CODEX_TEST_GATEWAY`、`TEST_RUNNER_CODEX_TEST_TITLE_CONTROL` 传给 `AgentAppUITests/testModelSummaryThroughLiveWebKitAndGateway`。
4. 用例从真实 App 点开重命名，经过 `AppSession`、JavaScript 运行时、HTTP 网关、WebKit 对象回执和原生解析，核对加载、候选回填、不提前保存及编辑后保存。它不使用 `--agent-conversation-fixture` 或原生总结回执替身。
5. 结束夹具并恢复未预置的生成首页；本地协议替身的状态随临时目录删除，不创建需归档的远端会话。

另有 `tests/ci/native-title-bridge.test.ts` 在 macOS 上将生产 JavaScript 运行时打包到真实 WKWebView，并使用生产 `NativeCommandResult` 解码成功、旧网关报错、非法字段版本和有效字段版本四种回执。禁止在桥接前用 `JSON.stringify` 清洗对象，否则会把导致闪退的 `NaN` 转成 `null`，掩盖回归。

## 新会话自动命名时序

运行 `npx tsx tests/fixtures/title-summary/automatic-gateway.ts`，将输出的 `gateway` 预置到独立生成的测试宿主，将 `gateway` 与 `control` 分别作为 `CODEX_TEST_GATEWAY`、`CODEX_TEST_TITLE_CONTROL` 传给测试运行器，执行 `AgentAppUITests/testAutomaticTitleUpdatesWithoutLeavingConversation`。可通过 `CODEX_TITLE_GATEWAY_PORT`、`CODEX_TITLE_CONTROL_PORT` 固定本任务端口。

夹具先返回没有用户消息的回合受理响应；测试确认标题仍为“新会话”且尚未发起模型总结，再由 `/confirm-user` 将用户消息写入历史并发出确认事件。待独立总结启动后，`/release-summary` 返回候选标题。用例全程不导航离开会话，核对原生导航栏即时更新、名称只保存一次，并保留截图。它使用真实 App → WebKit → HTTP 网关及隔离上游，不调用真实模型，不访问生产会话或手机推送；结束夹具后临时状态删除，无远端会话需要归档。

每次独立用例前重启夹具以清空状态。`AgentAppUITests/testSavedTitleRecoversWithoutNameNotificationOrReentering` 用 `/save-title-without-event` 模拟名称已保存但没有名称通知，仅发回合空闲事件；当前页经正文与名称对账后显示已保存标题，无需退出再进入。首次发送出现系统通知授权时，测试先关闭该弹窗，使 App 保持前台再推进协议事件。
