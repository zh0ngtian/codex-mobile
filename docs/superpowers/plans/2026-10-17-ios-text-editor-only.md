# iOS 仅文字编辑区原生实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 原生开关仅替换文字编辑区，输入栏其余按钮和菜单由网页实现。

**Architecture:** 保留真实网页表单，用 textarea 作为布局代理，按其有效矩形定位原生文字编辑器。可信主文档桥传递带 context 的几何/焦点/选区与编辑状态，复用现有 runtime 草稿版本和业务回调。独立完整原生界面维持原有路径。

**Tech Stack:** React/TypeScript、现有 NativeRuntime、WKWebView、UIKit/SwiftUI、Vitest、Swift SDK 类型检查与 XCUITest。

## 任务一：网页表单与原生编辑器边界（同一耦合改动）

**文件职责：**
- `src/features/conversation/ConversationPage.tsx`：原生输入时仍渲染网页表单和所有操作控件；textarea 仅做锚点/布局代理，网页模式恢复可编辑；原生模式隐藏最大化按钮。
- `src/native-ui/web-composer.ts`、`protocol.ts`、`runtime.ts`：声明并发布编辑器锚点/可见/阻挡/字号/焦点与 UTF-16 选区，挂载/卸载/resize/visualViewport/菜单变化更新，旧 context 清理不影响新登记。
- `src/styles.css` 与需要的现代界面 CSS：隐藏代理的文字与 Web 编辑命中但保留布局，自然增缩并遵守最大高度；消息区预留整个网页表单高度。
- `mobile/ios/NativeUI/NativeWebComposerHost.swift`、`NativeUIHost.swift`、`NativeUIBridge.swift`、`NativeWebComposerPresentation.swift`：混合模式只承载原生文字编辑；按实际 WKWebView 与 DOM 坐标转换；可信 frame、有限矩形及 context 校验；旧输入失效；不覆盖网页按钮与遮罩。
- 小型 `NativeWebTextEditor.swift`（需要时）：单一原生 UITextView/编辑控件、输入法组合、原生滚动、焦点及 UTF-16 选区同步；保持既有 draftRevision/selectionRevision 语义，不能由迟到快照覆盖正在编辑文本。
- `tests/ui/native-ui-web-composer.test.tsx`、原生 store/桥接 smoke、`tests/ci/ios-native-ui.test.ts`、必要 NativeUI UI 测试：真实行为合同。
- `README.md`、`docs/ios-native-ui-bridge.md`（以现有文档路径为准）、`release/notes.md`：更新用户可见行为。

- [ ] 先新增行为回归并观察 RED：启用 hybrid 后网页附件/发送/模型/权限按钮仍存在，模型和权限点击进入原网页回调；textarea 原生替代而非整个表单隐藏。已有 `tests/ui/native-ui-web-composer.test.tsx` 的“卸载Web表单”断言需改为本轮新合同，保留遮罩/context 门禁断言。
- [ ] 新增几何/焦点/草稿/UTF-16 光标/旧 context 拒绝的有效输入测试；运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/native-ui-web-composer.test.tsx tests/ui/native-ui-drafts.test.tsx tests/ci/ios-native-ui.test.ts --maxWorkers=2`，确认只因尚未实现的行为失败，保存 RED 日志。
- [ ] 最小实现以上职责。网页按钮使用原回调，附件文件控件继续调用现有选择链路；不让 hybrid 的 `NativePanelView` 或 `NativeComposerView` 重新接管网页菜单。关闭原生开关时页面仍可输入，开关不重置草稿。
- [ ] 同一编辑器按现有草稿更新/选区协议同步；编辑时不重建，不在输入法组合态强制替换 text；外部插入 Skill/插件/位置能插入正确光标并恢复原生焦点。菜单弹出期间隐藏/禁用编辑器，关闭后在同一 context 恢复选区与输入。
- [ ] 运行关联测试、`npm run typecheck`、完整 NativeUI iOS SDK Swift 类型检查。保持已有全原生输入/菜单合同，仅更新 hybrid 合同。自审 `git diff --check`，依中文 Conventional Commits 提交，正文包含新增功能和主要修改。不得自行正式发布。

## 任务二：真实 UI、审查与统一交付

- [ ] 规格审查后质量审查，修复所有实质问题并复审。
- [ ] 在共享模拟器锁内，用 iPhone 17 Pro、正常字号、竖屏及离线生产 App fixture 验证：原生文字区，所有网页按钮与网页弹层，文件选择器取消，模型/权限/Fast 后继续输入且草稿/光标正确，长文本有界增缩，发送与会话切换，开关关闭恢复网页编辑。
- [ ] 保存原始 xcresult/截图/探针和 fixture 到仓库外 validation；不建立真实远端测试会话，卸载独立 QA App 并释放锁。
- [ ] 必要全量测试、类型检查、166 项发布回归、现役协调器恢复回归，整理真实证据，提交推送固定 SHA。
- [ ] 对现有 OTA-only 任务提交 ready，等待成功 receipt；不直接分配版本，不独立执行正式发布入口。
- [ ] 固定 LAN IPA 与 HTTPS OTA 清单、HEAD/完整 GET 的版本、字节数、SHA-256 一致；签名身份/权限/钥匙串组连续，无 GitHub/APK/软件源发布。归档工作区后交付链接和签名包信息，明确实际真机验收边界。

## 已有基线

当前 `origin/main` 为 `1153c9f`，最近输入栏字体/间距变更已在 `49cfaeb`。使用已附加且干净的隔离工作区，新分支 `codex/ios-composer-web-controls-20261017`。两份关联 UI 测试基线 11 项通过，日志在仓库外本任务 `baseline.log`。

## 本地验收完成

- 运行源码固定为 `57c35dade2674e3b4f36a625f77b77ee816abcdb`，网页与原生源码文件 SHA-256 在私有 validation 留存，并与最终测试前后核对一致。全量 132 文件、1517 项通过，TypeScript 和完整 NativeUI Swift 5 iOS SDK 类型检查通过；发布 Python 回归 166 项、现役协调器恢复回归 30 项通过。
- iPhone 17 Pro（iOS 26.5）、正常系统字号、竖屏的最终 8 项真实 UI 全部通过：新旧网页布局的原生文字和网页选项、模型/推理/Fast/权限选择后续输、附件菜单与系统 Files 取消后草稿/光标保留、网页发送一次且请求正文完整、增长上限与清空缩回、关闭原生输入回到网页编辑。另针对质量发现的颜色问题，在同一设备的隔离 App 内设置 dark 宿主，确认原生编辑器仍按网页浅底使用可读文字颜色。
- 已验证并修复的真实问题：键盘缩小 bounds 早于网页矩形时不能禁用 UITextView 交互，否则会失焦；观察焦点与显式请求版本分离；React commit 后重放对应正文/版本的 UTF-16 选区；网页控件 pointerdown 到 click 完成期间保持输入栏几何，取消和完成时清理。
- 网页选项保留 aria-pressed 语义，XCTest 中映射 Switch；父任务早期只查 Button 的误判已更正，未据此修改菜单产品行为。文件取消后重新点击文字中部会自然改变光标，最终验收先用原生选区探针核对位置，再明确在末尾继续编辑，没有新增取消后自动弹键盘行为。
- 规格及质量独立审查依序通过，全部 P2 已关闭。原始 RED/GREEN、8 项完整 xcresult、截图、探针、fixture 和源文件散列保存在仓库外 `~/Library/Application Support/CodexMobile/validation/ios-composer-web-controls-20261017/`；各轮失败保留原样，不将混合失败批次宣称全通过。
- 测试全部采用离线内存协议响应，未创建真实远端会话。正式交付继续使用现役 OTA-only 项目，待协调器成功 receipt 与固定 IPA/HTTPS OTA 完整下载回验；尚未进行真机覆盖安装及数据保留验收。
