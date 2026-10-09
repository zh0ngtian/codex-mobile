# iOS 点击对号收起键盘的动画同步实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 连续执行；原生复现、布局决策与测试共享模拟器，由当前 Agent 完成。

**Goal:** 保留未发送草稿、点击键盘对号后，输入框不因 WKWebView 布局高度和屏幕动画层高度不一致而闪烁跳动。

**Architecture:** 保留 SwiftUI 键盘避让与 DOM 失焦处理。WKWebView 子类在原生重排后移除主图层 position / bounds 几何动画，保证 WebKit 布局与原生呈现同步。模拟器 UI 测试工程额外安装逐帧高度探针，正式发布工程不包含探针。

**Tech Stack:** SwiftUI、WKWebView、Core Animation、XCTest、Vitest、PakePlus。

## 任务 1：让旧实现失败

- [x] 创建 `mobile/ios/KeyboardLayoutProbe.swift`，从 `keyboardWillHideNotification` 到 `keyboardDidHideNotification`，用 CADisplayLink 逐帧计算布局层与呈现层的高度差，并提供测试专用辅助功能标签。
- [x] 修改 `scripts/configure-ios-tests.rb`，显式配置 UI 测试工程时安装探针；连续两次配置保持幂等，普通 `ios:prepare` 不安装探针。
- [x] XCTest 点击 `Done / 完成`，断言动画期最大高度差不超过 1px，并检查草稿、位置和重新编辑。
- [x] iPhone 17 Pro / iOS 26.5 上旧实现失败：实际绘制帧最大高度差 371.94px。早期 layoutSubviews 内采样的 403px 包含布局中间态，改用 CADisplayLink 后仍能复现。

## 任务 2：同步原生布局

- [x] 实验验证 SwiftUI 禁用布局事务动画无法消除 WKWebView 主图层的显式动画。
- [x] 在 `.github/workflows/build-ios.yml` 的原生硬化步骤加入 `CodexMobileWebView`，在 `super.layoutSubviews()` 后，仅移除主图层 position / bounds 几何动画。
- [x] 增加原生构造入口与几何动画处理的打包回归检查。
- [x] 相关 Vitest 30 项及 TypeScript 检查通过。
- [x] 短文本、多行中文、长草稿的对号收起原生回归及录屏检查通过。

## 任务 3：交付

- [x] 更新 `docs/ios-simulator-verification.md`，记录旧测试只在动画结束后采样的局限及新增逐帧验证。
- [ ] 只提交本任务文件，按 `docs/commit-conventions.md` 提交并推送主分支。
- [ ] 推送后从该提交构建统一版本号 APK / IPA，版本高于两个固定渠道。
- [ ] 发布两个固定渠道；分别核对 JSON、HEAD、完整 GET 的版本、大小和 SHA-256。
- [ ] 清理本次临时诊断源码与不再需要的生成工程，保留最终安装包、校验和 XCTest 证据。

## 已记录的证据

旧实现点击对号时，DOM 焦点已回到 BODY，网页没有滚动偏移，但主图层仍带 position 和 bounds.size 动画。网页按新的 bounds 重排，原生呈现高度仍接近键盘弹出状态，固定输入栏因此被裁剪。动画结束后的旧 XCTest 全部通过，不能覆盖这个中间过程。
