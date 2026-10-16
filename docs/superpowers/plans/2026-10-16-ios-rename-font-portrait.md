# iOS 重命名、固定字号与竖屏修复计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 逐项实现，先观察真实 RED，再实现 GREEN；实现后先规格审查再质量审查。

**目标：** 修复会话重命名无输入框；iOS 移除字号调整并固定为原“小”档 0.875；禁用横屏、固定正向竖屏。用户明确本轮仅交付签名 IPA 与 OTA，本对话后续不创建 GitHub Release。

**架构：** 保留既有业务命令、两个原生开关及 IndexedDB 状态。网页重命名沿现有 window.prompt → thread/name/set 链路，由 WKUIDelegate 提供带文本框的原生弹窗；完整原生已有的 NativeTextPrompt 路径继续保留。iOS 宿主在共享字号入口解析为 small，网页与原生投影一致，旧本地字号偏好不再扩大 iOS；普通浏览器和 Android 保持现有设置。方向在生成工程和最终 IPA 两处约束，不仅修改模拟器配置。

**技术栈：** SwiftUI、UIKit、WKWebView、React、Vitest、XCTest、releasectl。

## 已确认边界

- 独立工作区 ios-rename-font-portrait，分支 codex/ios-rename-font-portrait-20261016，基线 f977d0f6799d555139b0fbc96d4c0124e33f78fd。
- 用户已澄清“禁用竖屏”实际为“禁用横屏，固定竖屏”。
- 用户选择仅 iOS 签名 IPA + OTA；已登记 codex-mobile-ios-ota-production / ios-rename-font-portrait-20261016。不构建 APK、不创建 Release、不更新 unsigned 软件源。
- 应用字号比例固定 0.875；保留 iOS 系统 Dynamic Type 与粗体文本能力。
- 不使用演示弹窗替代真实重命名，不引入网络接口或第二套标题状态；取消不更名，默认值为当前会话名，保存继续既有去空白和请求逻辑。
- 原生偏好开关保持独立，重启生效规则和草稿保护不变。
- 只允许正向 portrait；iPhone/iPad 与 App 内浏览器共用最终 App 方向约束，最终 Info.plist 不包含 landscape。iPad 使用全屏约束以保持固定方向。

## 任务一：行为修复

**文件职责：**
- mobile/ios/build-recipe.yml：把文本输入 WKUIDelegate 接到真实原生 presenter，复制新增的单一职责 UIKit helper（如需要）；生成工程和最终 IPA 校验同一 portrait 策略。
- mobile/ios 下的文本弹窗 helper（如需要）：默认文本、可编辑输入、保存/取消、一次性 completion；使用现有可信首页与 presenter 边界，避免导航/重复回调留悬空。
- src/ui/font-size.ts、src/features/settings/FontSizeSettings.tsx：iOS 固定 small 并忽略旧大小，不再显示可调整入口。
- src/features/backends/BackendManagerSheet.tsx、ModernSettingsRoot.tsx：iOS 两种网页设置入口均不显示字体页；保留其他客户端原行为。
- src/native-ui/device-panel.ts、runtime.ts / workspace-adapter.ts：移除 iOS 字号选项，快照固定比例，过期字体动作不改变有效字号。
- mobile/ios/NativeUI/NativeSettingsView.swift、NativeReferenceSettings.swift、NativeSnapshot.swift / NativeUIStore.swift：取消字号入口，加载、离线参考及正常快照均与 0.875 一致。
- tests/ui/font-size.test.tsx、tests/ci/portrait-orientation.test.ts、现有 iOS 宿主及业务契约测试、NativeUIUITests.swift：真实行为回归。
- README.md、docs/native-ui-business-bridge.md、release/notes.md：同步实际 iOS 行为，更新日志仅写三项用户变化。

- [x] 新增 iOS 字号回归：旧 extra-large 存储仍解析 small，CSS 为 0.875，旧/新网页设置和原生 panel 无字号入口；非 iOS 原有调整测试继续通过。先运行旧实现观察预期失败。
  ```ts
  window.localStorage.setItem("codex-mobile:font-size", "extra-large");
  Object.assign(window, { __CODEX_IOS_HOST__: true, webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
  expect(readFontSize()).toBe("small");
  ```
- [x] 更新生成工程 fixture，断言 iPhone/iPad Debug/Release 方向均仅 portrait，UIRequiresFullScreen 为 true；最终 IPA 校验必须拒绝 landscape / 缺失方向，先 RED。
- [ ] 为实际 WKWebView 会话重命名加输入框/默认名/取消/保存回归。委托合同使用原生系统输入框：
  ```swift
  func webView(_ webView: WKWebView,
               runJavaScriptTextInputPanelWithPrompt prompt: String,
               defaultText: String?,
               initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (String?) -> Void) {
      // 接现有可信主文档和真实 presenter；取消回传 nil，保存回传输入，一次完成。
  }
  ```
- [ ] 最小实现后运行关联测试和 npm run typecheck；生成完整 iOS 工程检查 Swift 编译，保持全部回归断言，不调整超时预算。
- [ ] 自审并按 Conventional Commits 中文标题与“新增功能/主要修改”正文提交，不推 main、不自行正式发包。

## 任务二：实际 UI、复核与交付

- [ ] 使用共享模拟器锁、独立 QA Bundle 与真实生产 App + 离线 HTTP fixture；确认旧版/新版网页会话菜单及侧栏重命名均有文本框、预填当前名，取消无请求，保存更新标题；完整原生重命名仍可编辑。
- [ ] iOS 旧/新网页及完整原生设置均无字号入口；旧大字号存储下网页 CSS 和原生比例仍为 0.875；系统辅助字号仍可用。
- [ ] 先竖屏输入再旋转设备，App 和内置浏览器保持 portrait，输入、发送和弹窗操作可达；保存截图、Info.plist、几何与原始 xcresult。
- [ ] 测试结束卸载 QA App、释放共享锁，不创建真实远端测试会话。
- [ ] 规格、质量独立审查；adapter-regression、coordinator-recovery、build-contract、typecheck 均 passed 后，推送固定 SHA 并 ready。
- [ ] 等待 OTA-only 成功 receipt，核对任务包含、冻结 SHA、签名身份和完整 entitlements/钥匙串组连续性。
- [ ] 固定 LAN IPA、HTTPS OTA 清单/HEAD/完整 GET 校验版本、大小和 SHA-256；确认本轮没有 GitHub Release / APK / 软件源发布。交付给出 OTA 页与签名 IPA 的版本、大小、散列，并注明实际真机验收边界。

## 基线验证

- 三个关联文件共 28 项通过；证据在仓库外 ~/Library/Application Support/CodexMobile/validation/ios-rename-font-portrait-20261016/baseline.log。
- 当前完整原生已有 alert TextField；网页会话和侧栏重命名仍调用 window.prompt，宿主 recipe 没有文本输入 WKUIDelegate 实现，需要在真实运行链路复现验证。

## 实现验证记录

- 2026-10-16：真实 f977 基线 App 的网页会话菜单重命名在等待系统文本输入框时失败；设备横转后保持 portrait 的真实 UI 回归同样失败。原始 xcresult 由主任务保存在独立 QA 产物中。
- 字号/方向回归先观察 RED：旧字号仍解析为大档、CSS 为 1.25、设置仍有字号选项；配方仍允许横屏。真实 Swift Store 编译后在“原生加载态固定小字号”断言失败。对应 `implementation-red.log`、`native-model-red.log`；prompt 注入及语言契约先 RED，见 `text-input-contract-red.log`。
- 最小修复后 16 个关联测试文件 171 项通过（`implementation-green.log`），包含生成配方执行 fixture、最终 IPA plist 拒绝非法方向、原生 Swift Store 实际编译运行、旧检查点恢复、iOS/非 iOS 字号路径与桥接契约。
- `npm run typecheck`、文本输入桥 Swift 6 iOS SDK 类型检查、完整 NativeUIUITests 的 iOS XCTest 类型检查均通过，无诊断。生成整合宿主编译和真实 UI GREEN 继续由主任务执行，尚不能用这些检查替代。
- 上述日志均位于仓库外 `~/Library/Application Support/CodexMobile/validation/ios-rename-font-portrait-20261016/`。
- 提交前补充源 Info.plist 的双设备方向数组断言先 RED，再显式写入仅 portrait，避免只依赖工程生成设置覆盖；关联方向/构建/文本桥测试继续 GREEN，见 `plist-directions-red.log`、`plist-directions-green.log`。
