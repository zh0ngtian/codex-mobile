# iOS 本地构建与模拟器验证

Codex Mobile iOS 复用当前 React 前端，内置于固定提交的 PakePlus SwiftUI / WKWebView 容器。设备地址和口令由用户在 App 中添加，构建产物不携带私人网关配置。

## 生成与运行

要求 macOS、Xcode、Node.js 20.9+、Git、jq。首次运行先执行 `npm ci`。

```bash
npm run ios:prepare -- --version 0.2.91
open .mobile-build/ios/pakeplus/PakePlus.xcodeproj
```

在 Xcode 中选择 `PakePlus` scheme 和 iPhone 模拟器，再运行。也可通过 XcodeBuildMCP 设置上述工程、scheme 和模拟器后调用 `build_run_sim`。

```bash
xcodebuild \
  -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj \
  -scheme PakePlus \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath .mobile-build/ios-derived-data build
```

`--plan` 只输出步骤。准备脚本复用 `.github/workflows/build-ios.yml` 中的固定容器提交、pnpm 主版本、前端构建、配置和原生硬化；图标按 asset catalog 的尺寸在本地生成。成功后替换 `.mobile-build/ios/` 中的生成工程；不要在该目录维护手写源码。失败时保留上一次成功工程。

## 模拟器 UI 回归

UI 测试使用真实网关和 Codex app-server，会创建一条仅要求回复标识符的测试会话。使用新的测试模拟器可以完整覆盖首次配置；已配置模拟器会复用现有设备，继续验证重启和消息往返。测试环境需要中文界面。

启动测试网关（确保 `codex` 在 PATH 中）：

```bash
HOST=127.0.0.1 PORT=18786 CODEX_APP_SERVER_PORT=18785 \
CODEX_MOBILE_TOKEN=ios-simulator-check \
CODEX_MOBILE_RUNTIME_FILE=/tmp/codex-mobile-ios-runtime.json \
CODEX_MOBILE_SERVE_STATIC=false npm start
```

这个口令仅用于本机临时测试。测试结束后关闭该终端网关。

安装生成测试 target 的 Ruby 依赖，然后添加测试 scheme：

```bash
gem install xcodeproj --user-install
ruby scripts/configure-ios-tests.rb
xcodebuild \
  -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj \
  -scheme CodexMobileUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath .mobile-build/ios-derived-data \
  -parallel-testing-enabled NO \
  -resultBundlePath .mobile-build/ios-ui-tests.xcresult test
```

每次 `resultBundlePath` 应为空目录或使用新名称。XcodeBuildMCP 的 `test_sim` 同样可执行此 scheme。

## 2026-10-08 验证结果

版本 `0.2.91`，原生 build `2091`；iPhone 17 Pro，iOS 26.5，Xcode 27。

| 检查 | 结果 |
| --- | --- |
| 从当前源码生成内置前端和 Xcode 工程 | 通过 |
| 模拟器构建、安装、冷启动 | 通过 |
| 首次设备名称与网关地址输入 | 通过 |
| 错误口令提示与重新配置 | 通过，显示“访问口令不正确” |
| 真实网关初始化与会话列表 | 通过 |
| App 退出重启后设备配置保留 | 通过 |
| 新建会话、打开模型设置、选择“中”推理强度 | 通过 |
| 键盘弹出后输入框和发送按钮可操作 | 通过 |
| 真实消息发送、轮询与最终回复 | 通过，收到 `IOS_SIMULATOR_OK` |
| 未签名真机 Release 构建及 IPA 资源扫描 | 通过 |
| TypeScript 与相关打包、运行环境、viewport 回归 | 通过，21 项 |

XCTest 的完整流程为 1 项集成测试；首次配置验证和最终完整流程分别保留在本机 `.mobile-build/ios-ui-tests-6.xcresult` 与 `.mobile-build/ios-ui-tests-final.xcresult`。

![键盘避让后的设备配置](assets/ios-simulator/keyboard-safe-area.png)

![模拟器真实消息往返](assets/ios-simulator/message-roundtrip.png)

修复了两处原生适配：WebView 只忽略容器安全区，保留键盘避让；Xcode 的 `MARKETING_VERSION` 与 `CURRENT_PROJECT_VERSION` 使用本次发布版本，避免 App 始终显示模板的 `1.0`。

模拟器验证不包含真机摄像头、麦克风、定位及后台推送。未签名 IPA 需要 Apple 签名后才能安装到真机；模拟器使用构建目录中的 `.app`。
