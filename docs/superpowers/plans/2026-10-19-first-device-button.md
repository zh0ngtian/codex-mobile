# 首台设备引导按钮修复计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐步执行；采用先失败后修复的 UI 回归。

**Goal:** 修复无设备页面“添加设备”按钮竖向挤压、图文与底色无法区分的问题，供用户在模拟器验收；用户后续明确本轮不发布。

**Architecture:** 保留 ContentUnavailableView 和既有添加设备命令，仅在 actions 内明确横向图文布局、正常控件尺寸与中性反差配色。沿用交互约定第4.5节的设备管理中性色要求，不改变主题偏好或首次自动弹出表单行为。

**Tech Stack:** SwiftUI、XCUITest、releasectl。

## 1. 复现与修复

涉及文件：`mobile/ios/AgentUI/Devices/NoDevicesView.swift`、`mobile/ios/AgentUI/Previews/AgentConversationFixture.swift`、`mobile/ios/AgentAppUITests.swift`。扩展现有 DEBUG 夹具提供无设备快照与添加/取消表单的离线导航回执，不执行连接或保存。

- [x] 登记 `first-device-button-20261019`；在 `codex/first-device-button-20261019` 独立工作区开发。基线 `ios-native-ui.test.ts` 17项通过。
- [x] 在独立 iPhone 17 Pro、正常字号、竖屏的离线无设备夹具添加回归。关闭首次连接表单，断言按钮宽度大于高度的1.8倍、高度44至60pt，中心区域存在反差文字像素；点击后必须出现 `device.name` 与 `device.address`。列表截图前等待表单真实退出，并选择当前可交互的按钮，不能将弹层后面的首页控件当成当前列表。

```swift
XCTAssertGreaterThan(button.frame.width, button.frame.height * 1.8)
XCTAssertGreaterThanOrEqual(button.frame.height, 44)
XCTAssertLessThanOrEqual(button.frame.height, 60)
XCTAssertGreaterThan(Self.iconInkPixels(app.screenshot().image, element: button.frame, screen: app.frame, light: appearance == "Light"), 15)
```

- [x] 运行 `CodexMobileUITests/AgentAppUITests/testFirstDeviceButtonKeepsHorizontalLabelAndContrast`，保存修复前失败截图与日志。
- [x] 最小修复为显式 `Label`，固定横向理想尺寸，使用 `.labelStyle(.titleAndIcon)`、`.controlSize(.large)`、`.tint(AgentTheme.ink)` 与 `.foregroundStyle(AgentTheme.page)`；保留原动作和辅助功能标识。
- [x] 运行同一回归转绿，核对浅色、深色与粉色强调色下按钮中性且清晰，保留截图。

## 2. 约定与模拟器验收（用户已取消发布）

涉及文件：`docs/interaction-alignment.md`。本轮不发布，保留现行 `release/notes.md`。

- [x] 同步设备连接现行要求、验收要点及变更记录，明确本地已验证、未发布状态。
- [x] 完成 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`，将命令和日志保留在仓库外 validation 目录。本轮撤回发布，不提交 ready 凭证。
- [x] 按中文 Conventional Commits 提交并推送修复分支，保留模拟器及截图供用户验收。
- [x] 用户要求“不用发布，在模拟器给我验收”；已将协调任务置为 withdrawn，未 ready、未形成批次、未推进 main、未发布安装包。

本轮不创建远端测试聊天，不执行真机安装或网关部署。模拟器与本地日志只证明本次界面回归，不声明真机覆盖安装或数据保留验证。

## 实际验证

- 最终同一离线夹具、同一用例的旧实现复现：首页104×28pt、同色图文；设备列表60×96.33pt、同色图文。新增可交互检查后，截图与用户提供的异常一致。
- 修复后用例34.718秒通过，首页133.67×50.33pt、列表141.67×50.33pt；四张深浅色截图逐张检查通过，点击打开表单、取消返回列表通过。仅提供离线界面导航回执，不宣称真实网关连接成功。
- 最终日志目录：`~/Library/Application Support/ReleaseCoordinator/validations/first-device-button-20261019/`。UI证据为`ui-confirmed-red.log`、`ui-confirmed-green.log`及`confirmed-*-attachments/`；两个对应xcresult位于本任务工作区`.mobile-build/`。
- `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`：212项通过，`adapter-regression-final.log`。
- 在上游release-coordinator执行`python3 -B -m unittest discover -s tests -p 'test_*.py'`：最终59项通过，`coordinator-recovery-idle.log`；此前两次并发运行分别在10秒时序等待断言失败，失败日志及17项定向复跑通过日志均保留。
- `npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`：140项通过，`build-contract.log`；`npm run typecheck`及`npm run build`通过。
- 真实业务尝试中未确认表单取消回执，不计为设备列表验收；最终改用现有DEBUG夹具的明确无设备场景。已选择正确的独立模拟器，并停在浅色设备列表；使用者可点击添加设备或完成查看首页。
