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

## 2026-10-09 未发送草稿与键盘收起回归

新增 `testUnsentDraftRemainsStableAfterKeyboardDismissal`：已配置测试网关后打开新对话，输入草稿，点击系统键盘“Done / 完成”，验证键盘消失、输入框回到底部、12 次位置采样稳定、草稿完整保留，再次输入且发送按钮可操作。该用例不发送消息。

固定 iPhone 17 Pro / iOS 26.5 验证通过。修复在 `keyboardWillHideNotification` 同步取消网页编辑焦点，防止 WKWebView 在键盘收起和视口恢复时继续追踪输入光标。原生临时采样确认失焦后 `scrollY` 和 `visualViewport.offsetTop` 均为 0，DOM 焦点回到 `BODY`。辅助功能的 `Focused` 标记与 DOM 焦点不同，不用作网页焦点的断言。

```bash
xcodebuild -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj \
  -scheme CodexMobileUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -only-testing:CodexMobileUITests/CodexMobileUITests/testUnsentDraftRemainsStableAfterKeyboardDismissal \
  -parallel-testing-enabled NO test
```

### 点击对号时的动画期补充验证

用户继续复现后，确认前一轮的 DOM 失焦和动画结束后位置采样未覆盖原生图层动画。旧实现的真实绘制帧中，WKWebView 的布局高度与呈现层高度最大相差 `371.94px`，网页已经按恢复后的视口重排，固定输入栏却被仍在插值的原生图层裁剪。

正式容器改用 `CodexMobileWebView`，在 `super.layoutSubviews()` 后移除主图层的 `position`、`bounds` 及其子属性动画。键盘避让和失焦逻辑继续生效，网页子图层动画不受此处理影响。

`configure-ios-tests.rb` 额外安装 `KeyboardLayoutProbeWebView`，用 CADisplayLink 在键盘收起期间逐帧记录高度差。该探针仅出现在显式配置过 UI 测试的工程；普通 `ios:prepare` 和 IPA 发布工程不包含探针。重复配置测试工程已验证幂等。

iPhone 17 Pro / iOS 26.5 的 XCTest 和录屏检查结果：

| 草稿场景 | 动画期最大高度差 | 保留内容、位置稳定及再次编辑 |
| --- | --- | --- |
| 32 字符短文本 | 0px | 通过 |
| 36 字符三行中文 | 0px | 通过 |
| 160 字符长中文草稿 | 0px | 通过 |

三个场景均点击系统键盘对号 `Done / 完成`，并在收起后重复检查输入框位置与草稿，随后重新输入。重新编辑允许光标位于原文中间，移除新增文本后必须完整还原原草稿。单项集成测试通过，保留 `.mobile-build/keyboard-checkmark-verified.xcresult`、`.log` 和 `.mp4`。相关 Vitest 最终运行 52 项及 TypeScript 检查通过。

### 点击发送并收起键盘的补充修复

用户补充点击发送后收起键盘仍偶尔闪烁。旧容器在 `layoutSubviews` 中移除动画，但 UIKit 可以在布局之后继续追加动画；真实点击发送的 CADisplayLink 采样记录到主图层仍有 4 个 position / bounds 动画，新增的零几何动画断言失败。

正式实现改用 `CodexMobileWebViewLayer`，在 `CALayer.add` 入口直接拒绝主图层 position / bounds 动画，其他动画正常交给 `super.add`。网页子图层不使用这个图层类型，因此网页动画保持原有行为。发送表单在调用提交回调、清空草稿或还原最大化状态之前同步取消 textarea 焦点；普通和最大化输入的行为回归先失败、修复后通过。

新增 `testSendingDismissesKeyboardWithoutFlicker`，在 iPhone 17 Pro / iOS 26.5 分别发送短消息、长中文和最大化长中文，只请求回复固定标识。三个场景均验证真实回复、键盘消失、逐帧主图层几何动画数为 0、收起后 12 次位置采样变化不超过 1px，以及下一条输入可编辑；录屏检查通过。相关 Vitest 33 项和 TypeScript 检查通过。

高度探针继续保留为诊断，但不再把原始 model / presentation 高度差单独作为闪烁断言：Core Animation 提交前，新布局和上一呈现帧可以短暂不同。回归使用实际帧采样计数、整个收起期间零几何动画、稳态位置和输入行为作为通过条件。空 textarea 的 WKWebView 辅助功能值可能等于 placeholder；最大化按钮未被暴露为 AXButton 时，测试按相邻输入框定位并验证高度确实展开。

原生结果保留在 `.mobile-build/send-keyboard-verified.xcresult`（发送三场景通过）和 `.mobile-build/send-keyboard-done-verified.xcresult`（对号保留草稿回归）。测试探针仍仅由显式 UI 测试配置安装，不进入正式 IPA。


## 2026-10-10 恢复网页界面

按用户要求移除原生对话、原生边栏、原生 Markdown 和界面切换；网页对话与边栏恢复到原生化之前的实现（`6dc2607` 界面基线）。原有 WKWebView 容器、附件选择、内置浏览器、检查更新、通知深链与键盘修复保留；同期隐藏辅助会话不发送完成通知修复保留。

全量825项Vitest/92个文件、87项iOS Python回归、类型检查和前端构建通过。旧安装偏好和迟到原生事件不能改写网页草稿或搜索的新回归先失败、恢复后通过；界面专属73个文件或删除项逐字核对基线，独立审查通过。

iPhone 17 Pro / iOS26.5成功构建启动；既有 `testBottomBarsClearHomeIndicatorWithoutKeyboard` 和 `testRepeatedKeyboardDismissalPreservesUrlDraft` 两项通过，覆盖原网页边栏/输入、底部安全区、键盘反复收起及草稿保持。本轮未发送测试消息或创建服务器会话。真实截图、日志和结果保存在主工作区 `.mobile-build/ui-rollback-audit/`；模拟器验证不代表真机覆盖安装和数据保留已验证。
