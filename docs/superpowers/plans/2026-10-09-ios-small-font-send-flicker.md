# iOS 小字体发送闪烁修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 在当前会话执行，并遵循 superpowers:test-driven-development。

**Goal:** 小字体下点击发送、收起键盘时不再触发页面缩放和输入框闪烁。

**Architecture:** 在实际 iOS 设置界面选择小字体，测量聚焦与发送时 visualViewport.scale、原生 zoomScale 和几何动画。用失败的运行时回归定位原因；最小修复键盘收起桥接，保留字号设置和网页交互。

**Tech Stack:** Swift / WKWebView / XCTest / React / CSS。

### 任务 1：复现
- [x] 在 `mobile/ios/SmallFontKeyboardUITests.swift` 增加 `testSmallFontSendingKeepsComposerVisibleDuringDismissal`，通过“管理设备→小”选择字号，输入、发送并收起键盘；检查聚焦及收起时缩放比例均为 1、输入框稳定、消息可发送。
- [x] 在 `mobile/ios/KeyboardLayoutProbe.swift` 的测试专用类记录 `scrollView.zoomScale` 与 `visualViewport.scale`，仅测试工程启用。
- [x] 在已启动的 iPhone 17 Pro 执行 `xcodebuild test -only-testing:CodexMobileUITests/SmallFontKeyboardUITests/testSmallFontSendingKeepsComposerVisibleDuringDismissal` 并录制过程，确认真实失败原因。

### 任务 2：最小修复
- [x] 硬化 `.github/workflows/build-ios.yml` 的键盘收起桥接：失焦前固定输入栏 top，视口恢复时通过 `composer.animate` 移动至新的底部位置，避免 resize 回调之前已经绘制到键盘背后；使用键盘通知的动画时长，通知时长为 0 时沿用 250ms 收起过渡，并合并重复通知、恢复原始样式。
- [x] 重跑小字体发送、反复收起草稿及标准字号发送回归；检查小字体实际显示、发送按钮可操作与草稿完整。
- [x] 执行 `npm run typecheck`、相关 Vitest（排除 `.mobile-build/**`）和 `git diff --check`。

### 任务 3：双端交付
- [ ] 按 `docs/commit-conventions.md` 提交并推送本次变更。
- [ ] 读取固定双端清单，构建统一且高于两个现有版本的 APK / IPA，使用推送后的源码快照。
- [ ] 使用 `apk-server.py publish-channel codex-mobile` 发布两端，通过 JSON、HEAD、完整 GET 核对版本、大小与 SHA-256；注明 IPA 签名状态。
- [ ] 清理本次临时工程，停止测试网关与录像，保留安装包及验证证据。

## 定位证据

小字体实际为 14px，聚焦和发送后网页及原生缩放均为 1，排除自动缩放。新增逐帧回归失败，`SMALL_FONT_COMPOSER_FRAME_STEP 403`，说明输入栏一帧下跳 403pt；而主图层与 scrollView 动画数量仍为 0。仅检查最终位置无法捕获该闪烁。

原生通知进入后网页已经先提交视口恢复布局，单纯监听 resize 再补 transform 仍产生 403pt 跳动。提前固定 top 的运行时回归通过，最大单帧位移 45.47pt，缩放比例保持 1，消息送达，下一条草稿完整。

最终回归：小字体连续发送 3 次（最大单帧位移 47.41 / 44.70 / 47.78pt）、标准字号连续发送 3 次、URL 草稿连续收起 3 次、小字体草稿收起均通过。XCTest 共 3 项通过；相关 Vitest 11 项通过；typecheck 与 diff 检查通过。复现阶段 8 个测试会话已归档，最终回归会话在完成后单独归档。
