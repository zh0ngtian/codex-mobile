# iOS 同一草稿反复收起键盘修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 原样保留 URL 草稿，连续进入输入并点击对号收起时输入框稳定。

**Architecture:** 在模拟器中按用户四步流程复现，以测试探针同时记录原生滚动与网页视口；定位动画期间的变化后最小修复容器或输入框布局。构建使用隔离源码快照，验证完成后提交主分支并发布同版本双端包。

**Tech Stack:** Swift / WKWebView / XCTest / React / TypeScript / Vite。

### 任务 1：复现与测量
- [x] 在 `mobile/ios/CodexMobileUITests.swift` 增加原文 `nsk-sign://addsource?url=%E6%BA%90%E5%9C%B0%E5%9D%80`，保留草稿连续三轮点击输入框、对号收起；检查草稿与最终位置。
- [x] 在 `mobile/ios/KeyboardLayoutProbe.swift` 记录收起期间 scrollView 偏移与 DOM 视口、输入框坐标，并录制视频。
- [x] 使用 `xcodebuild test -only-testing:CodexMobileUITests/CodexMobileUITests/testRepeatedKeyboardDismissalPreservesUrlDraft` 在已启动 iPhone 17 Pro 上复现，记录闪烁阶段并加入能够捕获该变化的断言。

### 任务 2：修复与回归
- [x] 在 `.github/workflows/build-ios.yml` 的 `CodexMobileWebView` 覆写 `frame` / `bounds` setter：`set { UIView.performWithoutAnimation { super.frame = newValue } }`（bounds 对应同样写入）；内部 UIScrollView 与网页尺寸同步，保留网页动画。
- [x] 重跑原文反复收起、原有中文草稿与发送后收起的 XCTest，检查视频、草稿保留与下一次输入。
- [x] 执行 `npm run typecheck`、相关 Vitest（排除 `.mobile-build/**`）与 `git diff --check`。

### 任务 3：交付
- [ ] 按 `docs/commit-conventions.md` 提交并推送 main。
- [ ] 读取固定双端清单，构建统一且高于现有版本的 APK / 未签名 IPA。
- [ ] `apk-server.py publish-channel codex-mobile` 分别发布 APK / IPA；通过 JSON、HEAD、完整 GET 验证版本、大小、SHA-256。
- [ ] 清理本次临时工程、停止网关与录像，保留复现证据及安装包，回复主分支提交与双端下载信息。

## 复现证据

旧版主图层动画数为 0，但内部 scrollView 高度正在从约 475 点插值到 874 点，网页视口已经恢复到 812 点；重复收起时叠加 position / bounds.size 动画。新增 UI 断言实际失败，`SCROLL_GEOMETRY_ANIMATIONS maximum=2`；只包裹 `layoutSubviews` 无效。在 frame / bounds 写入入口退出动画上下文后，三轮原文草稿动画数均为 0。完整日志、结果与录像保存在 `.mobile-build/repeated-draft-*`。

## 验证结果

原文反复收起 3 轮、三种未发送草稿、普通短消息 / 长中文 / 最大化长中文发送均通过。主图层及 scrollView 几何动画数均为 0，草稿不丢失、发送后下次输入正常。相关 Vitest 38 项通过，typecheck 与 diff 检查通过。发布执行结果保存在 `.mobile-build/repeated-draft-release/channel-verification.json`。
