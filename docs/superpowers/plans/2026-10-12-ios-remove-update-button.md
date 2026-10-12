# iOS 移除检查更新按钮实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在独立 worktree 内逐项执行；本任务直接执行，固定渠道发布串行持锁。

**Goal:** iOS 的“管理设备”保留当前版本号，移除“检查更新”按钮。

**Architecture:** 更新控制器分别提供自动更新能力与手动检查入口能力，iOS 继续自动检查与使用原有 OTA 安装流程。设备管理的两处调用传递手动检查能力，Android 保持现有入口。

**Tech Stack:** React、TypeScript、Vitest、XCTest、PakePlus、本机 Ad Hoc 签名、GitHub Actions。

---

### Task 1: 验证并修改平台入口

**Files:** `tests/ui/app-update-hook.test.tsx`、`tests/ui/backend-components.test.tsx`、`src/features/update/useAppUpdate.ts`、`src/features/backends/BackendManagerSheet.tsx`、`src/App.tsx`。

- [x] 执行现有两个测试文件，确认基线 17 个测试通过。
- [x] 在现有 iOS 控制器测试加入 `expect(result.current.manualCheckSupported).toBe(false)`，Android 测试加入对应 `true` 断言；设备管理的 iOS fixture 使用 `supported: true, manualCheckSupported: false` 并断言没有检查更新按钮。运行两个测试文件，确认新断言失败。
- [x] 为 `AppUpdateController` 与设备管理的 `appUpdate` 参数增加 `manualCheckSupported: boolean`；控制器返回 `manualCheckSupported: bridge !== null && iosBridge === null`；两处设备管理调用传递 `appUpdate.manualCheckSupported`，按钮条件改为 `appUpdate.manualCheckSupported`。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/backend-components.test.tsx tests/ui/app-update-hook.test.tsx tests/ui/app-update-sheet.test.tsx tests/ui/app-update-release.test.ts tests/ci/ios-update-bridge.test.ts` 与 `npm run typecheck`，确认全部通过。

### Task 2: 同步现役文档与原生验收用例

**Files:** `README.md`、`mobile/ios/AppUpdateUITests.swift`。

- [x] README 明确 iOS 仅保留版本信息和自动更新，手动安装使用固定 OTA 页。
- [x] 原生用例改为进入“管理设备”，滚动到 Codex Mobile 信息，执行 `XCTAssertFalse(app.webViews.buttons["检查更新"].exists)`，保留截图附件。
- [ ] 完成 `git diff --check` 并按中文 Conventional Commits 提交，推送到 `main` 触发双端构建。

### Task 3: 同版本双端交付

**Files:** 本机 `.mobile-build/ios-remove-update-release/` 保留正式包与回执；本计划记录完成证据。

- [ ] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，核对 Android、iOS、HTTPS OTA 与 GitHub 版本，分配统一更高版本。
- [ ] 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <实际分配版本> --notes 'iOS 移除检查更新按钮，保留版本信息与自动更新' --plan`；预检通过后去掉 `--plan` 构建签名并发布。
- [ ] 等待当前提交的 GitHub Actions 双端构建通过，下载该版本 APK 并使用 `apk-server.py publish-channel codex-mobile <实际APK> --version <实际版本> --notes 'iOS 移除检查更新按钮'` 发布。
- [ ] 通过两个固定清单、HEAD、完整 GET 比对版本、大小与 SHA-256，核对 HTTPS OTA 身份连续性和软件源对应 unsigned IPA。
- [ ] 保存正式签名包与 OTA 回执，更新完成记录并提交推送；释放发布锁、清理临时资源并归档 worktree。

## 执行证据

- 基线 17 个测试通过；修改现有断言后实际出现 iOS 手动入口仍显示、平台能力未定义的预期失败；最小实现后 5 个测试文件共 26 个测试通过，TypeScript 检查通过。
- 本次没有启动远程测试会话或使用共享模拟器；XCTest 用例已同步新行为，未声称运行。
- 固定发布锁已取得；当前 Android、iOS 与 GitHub 最新版本均为 0.2.161，下一统一版本为 0.2.162。
