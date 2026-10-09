# iOS 收起键盘后输入框稳定性实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐步执行；键盘复现、布局决策和构建共享状态，由当前 Agent 连续完成。

**Goal:** 新对话输入内容后不发送，收起键盘时输入框正常回到底部，草稿保留，且不反复闪烁跳动。

**Architecture:** 先在真实 WKWebView 容器复现并记录输入框坐标与键盘状态。修复原生容器的键盘布局与网页视口定位冲突，沿用项目的固定 PakePlus 构建来源，避免直接维护生成目录。

**Tech Stack:** React、WKWebView、SwiftUI、XCTest、Vitest、PakePlus。

## 任务 1：复现并建立回归

- [x] 在 `mobile/ios/CodexMobileUITests.swift` 新增独立键盘收起测试：新建对话、输入未发送草稿、收起键盘、采样输入框位置、再次输入。
- [x] 用 `ruby scripts/configure-ios-tests.rb` 生成测试 target；在 iPhone 17 Pro / iOS 26.5 执行该单项 XCTest，记录旧实现结果。
- [x] 根据真实行为定位冲突，并在 `tests/ci/ios-local-build.test.ts` 增加构建配置回归；先运行 `npm test -- tests/ci/ios-local-build.test.ts` 确认新增断言失败。

## 任务 2：最小修复与验证

- [x] 修改 `.github/workflows/build-ios.yml` 的原生硬化步骤，修复已确认的滚动或键盘布局冲突；保持 `scripts/prepare-ios.mjs` 与 CI 共用实现。
- [x] 运行上述 Vitest 回归及 `npm run typecheck`。
- [x] 执行 `npm run ios:prepare -- --version <高于现有渠道的版本>`，重新运行原生键盘测试；验证草稿、键盘开关和发送按钮。

## 任务 3：提交与固定渠道交付

- [ ] 阅读 `docs/commit-conventions.md`，仅暂存本任务文件，执行 diff 检查，按中文 Conventional Commits 提交并推送。
- [ ] 推送后构建 IPA 和高于现有 Android 渠道的 APK；版本发布前重新查询，避免并行发布覆盖更新版本。
- [ ] 用 `apk-server.py publish-channel codex-mobile` 发布两个固定渠道；分别通过 JSON、HEAD 和完整 GET 核对版本、大小及 SHA-256。
- [ ] 清理本次无用临时文件，交付固定 IPA/APK 链接及实际校验信息，注明 IPA 签名状态。

## 复现证据与实现

系统键盘“Done”收起后，旧实现保留网页输入焦点。构建回归新增键盘失焦处理断言后，旧实现 Vitest 失败。XCTest 的辅助功能 `Focused` 标记与 DOM 焦点不同，不作为网页焦点的断言。临时逐帧探针记录到键盘动画期间 `scrollY=34` 后回到 `0`，说明 WKWebView 在恢复布局时仍定位输入光标。修复通过 `UIResponder.keyboardWillHideNotification` 调用 DOM `blur()`，仅处理 input、textarea 和可编辑元素，不修改草稿或重新挂载输入框。

相关 Vitest 19 项通过。工作区同时有其他任务修改，完整 typecheck 被其他未完成测试阻断，因此用 HEAD 加本次修复的独立源码快照继续验证和构建，不包含其他任务的未提交修改。

原生验证：iPhone 17 Pro / iOS 26.5 中，修复后收起键盘的采样为 `scrollY=0`、`visualViewport.offsetTop=0`、`document.activeElement.tagName=BODY`；草稿完整保留，输入框 12 次坐标采样稳定，再次输入和发送按钮可操作。临时原生探针只用于诊断，不进入源码和发布产物。独立快照完整 typecheck 通过。
