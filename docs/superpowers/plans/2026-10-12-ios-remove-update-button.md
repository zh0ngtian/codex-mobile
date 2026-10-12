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
- [x] 完成 `git diff --check` 并按中文 Conventional Commits 提交，推送到 `main` 触发双端构建。

### Task 3: 同版本双端交付

**Files:** 本机 `.mobile-build/ios-remove-update-release/` 保留正式包与回执；本计划记录完成证据。

- [x] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，核对 Android、iOS、HTTPS OTA 与 GitHub 版本，分配统一更高版本。
- [x] 执行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <实际分配版本> --notes 'iOS 移除检查更新按钮，保留版本信息与自动更新' --plan`；预检通过后去掉 `--plan` 构建签名并发布。
- [x] 等待当前提交的 GitHub Actions 双端构建通过，下载该版本 APK 并使用 `apk-server.py publish-channel codex-mobile <实际APK> --version <实际版本> --notes 'iOS 移除检查更新按钮'` 发布。
- [x] 通过两个固定清单、HEAD、完整 GET 比对版本、大小与 SHA-256，核对 HTTPS OTA 身份连续性和软件源对应 unsigned IPA。
- [x] 保存正式签名包与 OTA 回执，更新完成记录；释放发布锁、停止预览服务并清理临时资源。完成记录提交推送后由平台归档本次 worktree。

## 执行证据

- 基线 17 个测试通过；修改现有断言后实际出现 iOS 手动入口仍显示、平台能力未定义的预期失败；最小实现后 5 个测试文件共 26 个测试通过，TypeScript 检查通过。
- 本次没有启动远程测试会话或使用共享模拟器；XCTest 用例已同步新行为，未声称运行。
- 固定发布锁已取得；当前 Android、iOS 与 GitHub 最新版本均为 0.2.161，下一统一版本为 0.2.162。

- 实现提交 `7a00026` 已推送到 `main`；[双端构建工作流](https://github.com/zh0ngtian/codex-mobile/actions/runs/38207325559) 全部成功并发布 [v0.2.162](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.2.162)。
- 生产 Web 资源注入原生桥后检查实际界面：iOS 版本 v0.2.162、检查更新按钮 0 个；Android 同版本、按钮 1 个。截图与回执已保存；该检查不是 iOS 模拟器或真机验证。
- APK：0.2.162，4,721,755 字节，SHA-256 `f556bc13def1ac7d66c2bd5c7b65685d5bcd77f2b3e3069efcefbb2077121fba`，来源提交与实现一致。
- Ad Hoc 已签名 IPA：0.2.162，3,790,749 字节，SHA-256 `3302fc4d37a5cde35b814e944240ea3d11e2d23d1e898f644c18670d0b2c8048`。HTTPS 与 LAN 固定入口均完成清单、HEAD、完整 GET 大小与散列回验，Bundle ID、签名 application-identifier 和钥匙串组保持连续。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[固定 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) 均为本次版本。
- 正式签名包、签名报告、OTA 回执、APK 构建回执、页面截图和渠道验证 JSON 保存于长期主工作区 `.mobile-build/ios-remove-update-release/`。临时预览服务已停止；未创建远程测试会话。真机覆盖安装与数据保留未验证。
- 软件源已同步 unsigned IPA 0.2.162（2162），3,767,242 字节，SHA-256 `0bba419f3c785a180d49e086ae428d7d1f6b370a2eb08fe43cceafa0d9907306`，URL、版本、构建号、大小与 GitHub Release 一致；现有开发者署名包含当前 GitHub 登录用户名，保留原值。固定渠道锁已释放。
