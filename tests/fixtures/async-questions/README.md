# 异步模型问题原生验收

使用独立 iPhone 17 Pro、正常字号、竖屏，运行 `npx tsx tests/fixtures/async-questions/gateway.ts`。夹具通过真实 HTTP 网关提供新版 `agentMessage.delivery=async`、`questions`，不创建模型会话、不访问生产数据；退出后删除隔离状态。

在独立生成的测试宿主中安装当前前端，通过 `tests/fixtures/desktop-pins/seed.mjs` 预置输出的本机网关。将 `gateway`、`control` 分别传入 `TEST_RUNNER_CODEX_TEST_GATEWAY`、`TEST_RUNNER_CODEX_TEST_QUESTION_CONTROL`，运行 `AgentAppUITests/testAsyncQuestionsThroughLiveWebKitAndGateway`。覆盖实际原生选项窗口、稍后恢复、失败保留、运行中引导、结束后新回合、自由回答和草稿不受影响；截图来自真实 WebKit 业务投影与 SwiftUI 窗口。

此宿主仅用于本地验证，不能用于正式发布。结束后终止夹具并恢复未预置的生成首页。
