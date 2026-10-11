# 排队与引导消息布局修复实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 按步骤执行，遵循 TDD，完成提交推送与双端固定渠道交付。

**Goal:** 排队／引导消息出现、编辑或消失时，底部任务状态与正文均不被输入区遮挡。

**Architecture:** 追加消息列表参与输入区正常文档流，保持靠右与限高滚动。使用 ResizeObserver 读取整个输入区实际高度，通过滚动容器局部 CSS 变量为时间线保留底部空间，复用现有自动跟随与历史阅读位置逻辑。

**Tech Stack:** React、CSS、Playwright、Vitest、PakePlus、Ad Hoc OTA。

## 任务 1：复现与修复

- [x] 在 `tests/e2e/follow-up-layout.spec.ts` 使用 HTTP 协议 fixture 打开运行中的长会话，排队消息后测量 `.run-progress` 底边不超过 `.composer-follow-up-stack` 顶边；修改前执行并确认重叠失败。
- [x] `src/styles.css` 将 `.composer-follow-up-stack` 改为 `position: relative; margin: 0 0 8px auto;`，去除 absolute 的 right/bottom，保留 430px 宽度与 176px 限高；最大化时列表 `flex: 0 0 auto`。
- [x] `src/features/conversation/ConversationPage.tsx` 为 form 添加 ref，在 useLayoutEffect 中测量高度并设置 scroll 容器 `--composer-height`；观察尺寸变化，卸载时 disconnect。时间线底部 padding 使用 `max(105px, var(--composer-height, 105px)) + var(--input-bar-bottom-offset)`。
- [x] Chromium 与 mobile WebKit 验证单条／多条队列、编辑、引导、取消、最大化／还原、375px、横屏、特大字号；历史阅读期间队列变化不跳到底部。
- [x] 更新现有 `tests/ui/layout-css.test.ts` 的旧悬浮约定；运行相关 Vitest、`npm run build` 与 `git diff --check`。

## 任务 2：交付

- [ ] 按 `docs/commit-conventions.md` 使用中文 Conventional Commits 提交并推送 main，合并远端增量。
- [ ] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，从双端与 OTA 清单分配统一更高版本。
- [ ] 依 `mobile/android/build-recipe.yml` 构建发布 APK；执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '修复排队及引导消息遮挡任务状态'` 构建签名并发布 IPA。
- [ ] 读取 SignOs 最新软件源发布说明，用同一签名 IPA 发布并保留现有开发者署名及当前 GitHub 登录用户名。
- [ ] 核对双端 JSON、HEAD、完整 GET 的版本、大小、SHA-256，核对 HTTPS OTA 与软件源；保存证据至主工作区 `.mobile-build/follow-up-layout-release/`，归档本次 worktree。浏览器使用模拟数据，不创建真实测试会话。

## 修复验证

- 修改前 Chromium 的实际边界断言失败：消息条遮挡任务状态 24px。
- 修改后 Chromium 与 mobile WebKit 两项交互回归通过；覆盖追加队列、编辑、引导、取消、375px 窄屏、横屏、特大字号、减少动态效果、最大化及历史阅读位置。
- 相关 Vitest 66 项通过；前端类型检查与生产构建通过。浏览器全部使用模拟 HTTP 数据，未创建真实会话。
