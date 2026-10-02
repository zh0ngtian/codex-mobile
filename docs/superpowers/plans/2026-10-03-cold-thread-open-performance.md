# 冷启动进入长会话性能优化实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、systematic-debugging、verification-before-completion 流程逐项执行。

**目标：** 缩短 Android 冷启动后进入长会话的等待时间，消除重复恢复和旧版 WebView 的全量页面布局，并交付固定渠道 APK。

**真机证据：** 在测试机 LGE-AN10、Huawei WebView 12.0.0.324 上，以会话 `019e9d61-f87e-7951-ab67-925f3970ceea` 连续执行 5 次进程冷启动。启动到目标会话行出现的中位数为 1,563 ms，点击到最近 10 个 turn 可见为 494 ms，端到端为 2,056 ms。`thread/resume` 中位数只有 68 ms、响应 25,143 bytes；真正的关键路径是约 1,002 ms 的 `account/rateLimits/read` 被串行等待，以及用户点击后初始化收尾再次调用 `thread/resume`。将额度查询临时移出关键路径后，端到端中位数降至 851 ms。测试机还不支持 `100dvh`，导致 `.conversation-scroll` 被撑到 10,179 px，无法形成视口内滚动。

**修复策略：** 工作区连接就绪后立即并行加载会话列表和必要设置，额度查询独立后台更新；初始化开始时捕获当前会话和打开序列，仅在用户没有主动切换会话时执行断线恢复；Skill/插件目录按设备与工作目录缓存，并推迟到会话首屏 ready 后的空闲任务；CSS 以 `100vh` 为旧 WebView 回退、`100dvh` 为新浏览器覆盖。

## 任务 1：先写失败回归测试

**文件：**
- 新增 `tests/ui/workspace-bootstrap.test.ts`
- 新增 `tests/ui/async-value-cache.test.ts`
- 修改 `tests/ui/layout-css.test.ts`

1. 断言会话列表任务在额度查询未完成时仍能开始并完成关键初始化。
2. 断言初始化期间用户主动打开会话后，不再执行初始化末尾的重复恢复。
3. 断言目录缓存会合并同 key 并发请求、复用已完成结果，并支持强制刷新。
4. 断言主壳、会话列表和会话详情都按 `100vh`、`100dvh` 顺序提供回退。
5. 运行聚焦测试，确认测试因实现尚不存在或样式缺少回退而失败。

## 任务 2：最小实现冷启动调度

**文件：**
- 新增 `src/backends/workspace-bootstrap.ts`
- 修改 `src/App.tsx`

1. 连接 ready 后立即启动 `loadThreads`，同时读取模型、权限和配置。
2. 将 `account/rateLimits/read` 改为独立后台请求，不再阻塞会话列表和基础设置。
3. 捕获初始化开始时的 active thread 与 `openSequence`；初始化期间发生用户打开操作时跳过自动恢复。
4. 保留真正断线重连时对原 active thread 的恢复行为。
5. 运行工作区初始化聚焦测试并确认通过。

## 任务 3：降低目录加载与消息重排干扰

**文件：**
- 新增 `src/lib/async-value-cache.ts`
- 修改 `src/App.tsx`
- 修改 `src/features/conversation/ConversationPage.tsx`

1. Skill 和插件结果按 backend + cwd 缓存，并合并同 key 的并发请求。
2. 首次连接不再加载无 cwd 的全量目录；会话 ready 后再通过空闲任务预热当前 cwd。
3. `skills/changed` 使当前缓存失效并按需重载。
4. 缓存会话 turn 分组结果，避免目录状态更新时重复执行分组。
5. 运行目录缓存、Skill、插件和会话组件测试。

## 任务 4：修复旧版 WebView 视口回退

**文件：**
- 修改 `src/styles.css`

1. `.app-shell`、`.thread-list-page`、`.conversation` 先声明 `100vh`，再声明 `100dvh`。
2. 运行布局聚焦测试并确认规则顺序正确。

## 任务 5：完整验证与真机复测

1. 运行聚焦测试、完整 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。
2. 构建同签名测试 APK，在目标真机对指定会话重复执行至少 5 次进程冷启动。
3. 对比启动到目标行、点击到 10 个 turn、重复 `thread/resume` 次数以及滚动容器高度。
4. 验证分页、Skill/插件提及、额度展示和断线恢复没有回归。

## 任务 6：提交、推送与固定渠道发布

1. 按提交规范提交计划、测试和实现并推送 `main`。
2. 读取固定渠道当前版本，构建版本号更高的新 APK。
3. 使用 `apk-server.py publish-channel codex-mobile` 发布固定渠道。
4. 通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
5. 恢复测试机正式构建并清理临时构建、分析文件。
