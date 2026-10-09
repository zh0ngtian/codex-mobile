# 移动端强制竖屏实施计划

> **For agentic workers:** 在当前会话按 superpowers:executing-plans 逐项执行，采用 superpowers:test-driven-development；按用户授权完成提交、推送及双平台发布。

**Goal:** Android 和 iOS 只支持正向竖屏，转动设备不再切换横屏。

**Architecture:** 修改固定原生容器的构建硬化步骤，Android 主 Activity 与内置浏览器设置 `android:screenOrientation="portrait"`；iOS Debug/Release 的 iPhone/iPad 方向均设为 `UIInterfaceOrientationPortrait`，并设置 `UIRequiresFullScreen`。检查最终安装包，避免项目生成或清单合并覆盖方向限制。

**Tech Stack:** Python、Android Manifest、Xcode project/Info.plist、Vitest、Gradle、Xcode。

---

### Task 1：方向契约与原生配置

**Files:** `tests/ci/portrait-orientation.test.ts`、`.github/workflows/build-android.yml`、`.github/workflows/build-ios.yml`、`README.md`

- [x] 添加执行真实硬化脚本的回归测试：Android 从 sensor/landscape 清单生成仅竖屏主 Activity 与内置浏览器；iOS 两个配置的手机/平板方向仅竖屏且要求全屏。
- [x] RED：运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ci/portrait-orientation.test.ts`，确认当前 Android 仍为 sensor，iOS 仍包含横屏。
- [ ] GREEN：在 Android 注册内置浏览器之后，对 application 下所有 Activity 设置 `activity.set(f"{android}screenOrientation", "portrait")`（使用 XML 命名空间格式）；iOS 用正则将两个 `INFOPLIST_KEY_UISupportedInterfaceOrientations` 及两个 `_iPad` 设置替换为 `UIInterfaceOrientationPortrait`，用 plistlib 写入 `UIRequiresFullScreen = True`。
- [x] 在最终 APK 的解析清单与 IPA 的编译后 plist 中校验上述方向限制；README 写明两个平台只支持竖屏。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ci`、`npm run typecheck`、`git diff --check`，要求全部通过。
- [x] 最终 APK 的 apkanalyzer 会将 portrait 输出为枚举值 1；先补充数字枚举失败测试，再兼容 `portrait`、`1`、`0x1`，仍拒绝横屏、sensor 和缺失方向。

### Task 2：提交与固定渠道交付

- [ ] 遵守 `docs/commit-conventions.md`，中文 Conventional Commit 提交后推送当前分支。
- [ ] 读取 Android/iOS 固定清单最大版本，当前均为 0.2.106；使用更高统一版本 0.2.107 从已推送源码构建 APK 与未签名 IPA。
- [ ] 用 `apkanalyzer manifest print` 检查 APK 主 Activity 和内置浏览器方向为 portrait；读取 IPA 的 `Info.plist`，确认手机和平板方向数组都只有 `UIInterfaceOrientationPortrait` 且 `UIRequiresFullScreen` 为 true；核对两个包版本和签名状态。
- [ ] 对两个安装包分别运行 `python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <安装包> --version 0.2.107 --notes 'Android 和 iOS 强制竖屏，关闭设备旋转时的横屏切换。'`。
- [ ] 通过两个固定清单、HEAD 和完整 GET 校验版本、大小与 SHA-256，记录 `.mobile-build/portrait-release/delivery.json`。
- [ ] 清理本次临时构建辅助文件，交付固定 APK/IPA 链接、统一版本、各自大小和 SHA-256，并注明 IPA 未签名。
