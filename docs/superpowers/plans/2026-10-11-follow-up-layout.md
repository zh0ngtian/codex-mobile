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

- [x] 按 `docs/commit-conventions.md` 使用中文 Conventional Commits 提交并推送 main，合并远端增量。
- [x] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，从双端与 OTA 清单分配统一更高版本。
- [x] 依 `mobile/android/build-recipe.yml` 构建发布 APK；执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '修复排队及引导消息遮挡任务状态'` 构建签名并发布 IPA。
- [x] 读取 SignOs 最新软件源发布说明，用同一签名 IPA 发布并保留现有开发者署名及当前 GitHub 登录用户名。
- [x] 核对双端 JSON、HEAD、完整 GET 的版本、大小、SHA-256，核对 HTTPS OTA 与软件源；保存证据至主工作区 `.mobile-build/follow-up-layout-release/`，归档本次 worktree。浏览器使用模拟数据，不创建真实测试会话。

## 修复验证

- 修改前 Chromium 的实际边界断言失败：消息条遮挡任务状态 24px。
- 修改后 Chromium 与 mobile WebKit 两项交互回归通过；覆盖追加队列、编辑、引导、取消、375px 窄屏、横屏、特大字号、减少动态效果、最大化及历史阅读位置。
- 相关 Vitest 66 项通过；前端类型检查与生产构建通过。浏览器全部使用模拟 HTTP 数据，未创建真实会话。

## 固定渠道交付（0.2.146）

- 修复提交 `3743d45` 已推送 main；双端均由该提交构建，版本 0.2.146、构建号 2146。
- APK：4,714,647 字节，SHA-256 `2c23e3733937bcf7dfea8a73f835c030e55289afbe579f85aa47bdfbf301540a`。
- IPA：3,781,983 字节，SHA-256 `32585321903f8ab6e1c93b44e080dc5e4b76b0ce7b29b4406276fc85c88bf0da`；Ad Hoc 已签名，独立资源验签通过，保留既有 Bundle ID、application-identifier 与钥匙串组。
- Android/iOS 固定 JSON、HEAD、完整 GET 和 HTTPS OTA 均通过；双端 64 份 JS/CSS 资源散列完全一致，包内包含动态底部留白和追加消息正常布局修复。
- 原 `cloudflare/app-source/PUBLISH_PROMPT.md` 地址已返回 404；已从 GitHub 获取并遵循最新 `distribution/app-source/PUBLISH_PROMPT.md` 与上传器，按其现役家中 HTTPS 软件源发布同一签名 IPA。当前登录用户名从 GitHub 读取，开发者署名保持 `loock-ai / zh0ngtian`。软件源清单、HEAD、完整 GET、大小与散列回验通过。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)。
- 本机证据保存于主工作区 `.mobile-build/follow-up-layout-release/`，包含浏览器截图，以及 `0.2.146/` 下双端包、构建日志、发布凭证、独立签名检查、包内资源散列和渠道回验。
- 本次修改为网页布局；使用 Chromium 与 mobile WebKit 验证，未进行真机覆盖安装及数据保留验收，未创建真实测试会话。
