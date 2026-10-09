# 键盘收起时底栏安全区实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话执行，遵循 superpowers:test-driven-development；根据用户授权完成提交、推送和双平台发布。

**Goal:** 键盘收起时，下边栏和对话输入框位于底部安全区上方，并保留 8px 间距。

**Architecture:** 修复 `src/styles.css` 的共享底部偏移，使用底部安全区加现有边缘间距；iOS 模板额外注入的 viewport 必须保留 `viewport-fit=cover`，避免覆盖网页设置后安全区变为 0；列表、消息底部留白沿用共享变量。使用真实 iOS 模拟器的按钮位置验证首次打开和键盘收起，复用既有键盘稳定性回归。

**Tech Stack:** CSS、XCTest、Vitest、Gradle、Xcode。

---

### Task 1：真实布局回归与修复

**Files:** `mobile/ios/CodexMobileUITests.swift`、`src/styles.css`、`tests/ui/layout-css.test.ts`、`.github/workflows/build-ios.yml`

- [x] 添加 `testBottomBarsClearHomeIndicatorWithoutKeyboard`：启动后打开新聊天，检查输入框距离屏幕底部至少 42pt；输入草稿并点击 Done 后重复检查；打开会话列表，检查聊天按钮距底部至少 42pt。
- [x] 运行该 XCTest，确认当前 8px 底部偏移导致位置断言失败。
- [x] 将共享偏移改为 `--input-bar-bottom-offset: calc(env(safe-area-inset-bottom, 0px) + max(var(--browser-edge-bottom), 8px))`；更新既有 CSS 契约预期。修复 iOS 模板注入的 viewport，加入 `viewport-fit=cover`；重新从当前源码生成测试容器。
- [x] 运行新增 XCTest 和既有 `testRepeatedKeyboardDismissalPreservesUrlDraft`，确认安全距离、草稿和键盘收起稳定性通过。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/layout-css.test.ts tests/ui/runtime-environment.test.ts tests/ci`、`npm run typecheck` 与 `git diff --check`。

### Task 2：提交与双平台交付

- [ ] 按 `docs/commit-conventions.md` 提交并推送修复。
- [ ] 读取两个固定清单，使用高于两者的统一版本（当前 0.2.115，下一版 0.2.116），从推送源码构建 APK 和未签名 IPA。
- [ ] 分别执行 `apk-server.py publish-channel codex-mobile <安装包> --version 0.2.116 --notes '修复键盘收起时下边栏和对话输入框过低，补齐底部安全区。'`。
- [ ] 验证两个包内版本、固定清单、HEAD、完整 GET 的大小和 SHA-256，交付固定链接并注明 IPA 未签名，清理本次临时文件。

## 验证证据

- 当前容器重建后的 iPhone 17 Pro / iOS 26.5：底栏安全区和同一 URL 草稿三次收起均通过，2 项 XCTest 无失败。位置回归首次失败时，键盘收起后的输入框距屏幕底部仅 15pt；修复后满足至少 42pt 的安全距离。
- 修复了模板追加 viewport 时遗漏 `viewport-fit=cover` 的根因；只有 CSS 加入安全区仍无法通过原生位置断言。
- 相关 Vitest 共 56 项通过，TypeScript 和 diff 检查通过。运行 Vitest 时排除 `.mobile-build/**`，避免其他任务的构建副本被误发现。
- 本机结果：`.mobile-build/bottom-safe-area-release/current-green.xcresult`、截图及测试日志。
