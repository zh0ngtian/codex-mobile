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
- 取消重命名补充：真实 UI 已复现输入框取消无更名、无写请求，但原生菜单消费后网页仍保留打开状态，下一次点击会先关闭旧状态。新增 React 回归先 RED：共享菜单未调用关闭，旧版/新版会话页取消后的 `aria-expanded` 均仍为 true（3 项失败、99 项通过，`rename-cancel-react-red.log`）。
- 共享会话操作菜单仅对原生重命名选择补充收起：先分发原动作，让侧栏同步捕获会话与后端，再关闭已消费的菜单；网页可见菜单取消行为及其他菜单动作保持原样。四个关联文件 105 项通过（`rename-cancel-react-green.log`），覆盖旧/新版会话页重开、侧栏原目标重命名、网页取消保留菜单及原生菜单既有合同；`npm run typecheck` 通过（`rename-cancel-typecheck.log`）。真实取消→重开→保存 UI 验收继续由主任务执行。

## 新增范围：输入栏统一系统菜单

用户后续明确五项需求，并确认：Fast、模型与推理强度均去掉当前选中的 ✓；模型目录打开即全部列出，超出屏幕允许 iOS 系统滚动。模型按钮必须同时显示推理强度。本轮仍仅 iOS 签名 IPA + OTA。

### 任务：菜单呈现与状态保持

**文件职责：**
- `NativeComposerView.swift`：附件入口改系统 Menu，消除原附件/权限 sheet 调节路径；同一 TextField、自然增缩、选择与草稿保护不变。
- `NativeComposerConfigurationView.swift`：审核模式使用系统 Menu 和对应 SF Symbol；Fast、模型、推理选项不再绘制选中 ✓，模型/推理仍平级 Section、固定顺序、ForEach 完整目录，不加入自定义分页或 ScrollView。
- 新的单一职责附件 Menu 视图（如需）：同时支持工具栏点开和侧栏新建附件快捷入口的程序打开。SwiftUI 不提供程序打开时，沿现有 `ActionMenuBridge.swift` 中 UIButton/UIMenu/performPrimaryAction 的模式实现可交互按钮；不能直接复用其 hitTest 永远 nil 的透明按钮，也不能保留旧 sheet 作为分支回退。
- `NativeUIStore.swift` 或小型呈现策略：附件动作捕获菜单生成时的 context；只读、等待新会话、侧栏打开和过期上下文均拒绝执行，保留原业务命令及 API。
- `NativeAttachmentOptionsView.swift`、`NativePermissionOptionsView.swift`、`NativePermissionOptionView.swift`、`NativeComposerAdjustment*.swift`：用 rg 核对引用，仅删除确实不再使用的旧 sheet 路径，保留必要安全合同并更新旧 smoke。
- 现有 Swift smoke、相关 NativeUIUITests 与构建契约，以及 README、桥接文档、release/notes.md。

- [x] 先为附件菜单动作绑定和旧 context 拒绝、当前模型及推理标签补真实 Swift 行为回归，观察旧实现 RED；保留原草稿、selectionRevision、等待新会话回归。
- [x] 附件菜单直接显示四项：照片 `photo`、文件 `paperclip`、Skill 与插件 `at`、当前位置 `location`，仍走 attachment.pick/photos、attachment.pick/files、panel.open/mentions、location.insert。
- [x] 审核模式遍历权威 snapshot.permissions，使用语义相应图标（只读/工作区/自动审核/完全访问），选择仍走 chooseComposerOption(permission.select, contextID:)；按钮保持 44pt，图标与文字共享现有工具栏字号。
- [x] Fast、模型、推理强度按钮只显示文本或相应速度图标，不显示选择 ✓；菜单固定顺序和全部目录保持。
- [x] 模型按钮用单一可见文本呈现“模型 · 推理强度”，避免 SwiftUI Menu 将多个 Text 仅提取第一项；空值沿现有“智能”语义，长名称优先保留末尾推理强度，可中间截断。实际截图须看到推理值，不能只用原 accessibilityValue 判定。
- [ ] 侧栏新建附件入口仍直接打开同一个系统菜单；选文件/照片进入原系统选择器、取消可重新打开；Skill/Plugin 后续面板仍走原业务，菜单外取消保留草稿。
- [ ] 关联回归、TypeScript 和 Swift 类型检查后自审提交，不操作发布；规格与质量依序复核。
- [ ] 主任务真实 UI 覆盖四类菜单、图标和无 ✓ 截图、模型与推理可见文本、全部目录/溢出系统滚动、选择后草稿保留、侧栏附件快捷入口和原系统文件选择器；再统一全量必要验证并 ready。

### 实际 UI 补充缺陷：取消重命名后菜单重开

- 新文本输入桥已在真实原生会话菜单中显示系统文本框、预填和取消；字号与实际固定竖屏两项已 GREEN。
- `rename-cancel-reopen-red.xcresult` 证明会话页取消后下一次点击会话操作无法立即重开：原生 UIMenu 已消费，但 React actionsOpen 只在动作成功时清理。侧栏 managedThread 的相同保留条件由源码确认，React 回归保护原目标与后端，侧栏真实 UI 待继续验证，不把它描述为已复现的同一重开缺陷。修复须在正确捕获目标后清理原生呈现状态，取消不发命名请求；普通网页 fallback 行为保持。
- 首次 GREEN 测试包崩溃来自主任务自写 QA 探针空样式 parseFloat 得 NaN，进入 NSJSONSerialization 后抛异常；仅忽略目录探针已改为有限数值/null。生产实现未因此修改，原始 crash 保存于私有 validation 目录。

### 输入栏菜单实现验证

- 2026-10-16：新增实际生产 Swift store 回归先观察 RED：侧栏打开后，旧配置菜单仍派发模型、推理、速度及审核动作（`composer-menu-context-red.log`）。
- 新菜单上下文合同替换旧 sheet 的恢复合同；真实 Swift smoke 覆盖四项附件动作、原上下文、不可编辑/等待/侧栏拒绝、草稿与 selectionRevision 保持，以及模型/推理单一标签。宿主 17 项全部 GREEN（`composer-menu-green.log`）；最终相关六文件 65 项通过（`composer-menu-final-tests.log`），包含原生 runtime、workspace、附件及新对话业务回归。
- `npm run typecheck`、完整 NativeUI iOS SDK Swift 类型检查（与工程一致的 Swift 5 模式）和 NativeUIUITests 的 XCTest 类型检查均通过；日志分别为 `composer-menu-typecheck.log`、`composer-menu-swift-typecheck.log`、`composer-menu-xctest-typecheck.log`。首轮额外 Swift 6 全目录检查触及既有 Markdown NSCache 并发诊断，未将该无关代码纳入本次菜单修改。
- UIKit 新按钮保留正常命中测试，使用系统 `willEndFor` 完成回调清理状态，随后才执行原附件命令；不再保留附件或权限 sheet。实际系统菜单、目录溢出、图标、可见推理标签、快捷入口与系统选择器验收继续由主任务执行。
