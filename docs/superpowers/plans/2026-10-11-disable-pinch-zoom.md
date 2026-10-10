# 禁用应用内双指缩放实现计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 逐项执行；本任务共享构建及发布状态，不委派子任务。

**Goal:** 应用界面及图片预览不响应双指缩放，独立网页浏览器继续支持双指缩放。

**Architecture:** 复用现有 viewport 与 CSS 约束；iOS 主 WKWebView 不再忽略 viewport，并禁用其 UIScrollView 捏合识别器；Android 主 WebView 关闭原生缩放机制。网页使用各自独立浏览器，保留现有缩放配置。图片预览删除双指距离缩放，保留按钮、双击、滚轮及放大后的单指拖动。

**Tech Stack:** React、TypeScript、Vitest、Kotlin WebView、Swift WKWebView、本机双端构建与 Ad Hoc OTA。

---

### 任务 1：回归验证与修复

文件：`tests/ci/mobile-packaging-recipes.test.ts`、`tests/ui/image-preview.test.tsx`、`mobile/ios/build-recipe.yml`、`mobile/android/build-recipe.yml`、`src/features/conversation/sheets/ImagePreviewSheet.tsx`。

- [x] 添加回归用例：iOS 主容器禁止忽略 viewport、禁用捏合识别器，独立网页仍用普通 WKWebView；Android 主容器关闭缩放、独立网页仍开启缩放；图片的两触点距离变化不改变百分比、单指拖动继续生效。
- [x] 执行 `npm test -- tests/ci/mobile-packaging-recipes.test.ts tests/ui/image-preview.test.tsx`，确认新增用例因当前行为失败。
- [x] iOS 修改生成配置：`webConfiguration.ignoresViewportScaleLimits = false`，在 `CodexMobileWebView.didMoveToWindow` 中执行 `scrollView.pinchGestureRecognizer?.isEnabled = false`。
- [x] Android 在主 WebView 完成初始化后执行 `webView.settings.setSupportZoom(false)`、`webView.settings.builtInZoomControls = false`、`webView.settings.displayZoomControls = false`；生成补丁须校验固定入口唯一。
- [x] 图片预览删除 `pointerDistance`、`pinchOrigin` 与两触点 `applyScale` 分支；多触点时将 `dragOrigin.current = null`，保持单触点拖动及其余显式缩放入口。
- [ ] 运行上述用例及 viewport、布局回归，再执行 `npm run build` 和移动端生成检查。

### 任务 2：提交与双端发布

- [ ] 阅读 `docs/commit-conventions.md`，执行 `git diff --check`、暂存检查，使用中文 Conventional Commit 正文提交并推送。
- [ ] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock` 排队发布；从 Android/iOS LAN 及 HTTPS OTA 清单分配更高统一版本。
- [ ] 按 `mobile/android/build-recipe.yml` 在本 worktree 的独立构建目录生成、编译、验证 APK。
- [ ] 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一新版本> --notes '禁用应用内双指缩放，保留网页缩放'`，完成签名与 OTA/LAN 回验。
- [ ] 使用规定 `apk-server.py publish-channel codex-mobile` 发布同版本 APK；固定双端清单、HEAD、完整 GET 大小与 SHA-256 均须一致。
- [ ] 读取 SignOs 最新 `PUBLISH_PROMPT.md`，用同一签名 IPA 发布软件源，保留原开发者并按当前 GitHub 用户名补充署名。
- [ ] 保存可复核凭证；清理本次无用临时文件；交付 OTA、APK、IPA、版本、大小、SHA-256 和签名状态。
