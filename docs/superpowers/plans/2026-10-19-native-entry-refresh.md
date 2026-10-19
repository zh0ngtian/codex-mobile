# 原生会话进入稳定性与侧栏刷新实施计划

**目标：** 消除 iOS 原生会话进入时的闪动，在侧栏右上角增加 `arrow.clockwise` 刷新按钮，与底部更多按钮同字重、字号、外框尺寸及水平位置。

**实现边界：** 沿用现有 SwiftUI 页面、消息锚点与 `navigation.refresh` 业务命令，不改变数据协议。刷新按钮复用 `SidebarIconButton`；保留用户未要求删除的菜单刷新入口。会话及新对话路由使用 `.transition(.identity)`，只取消插入/移除的透明度转场，保留抽屉位移。

**技术栈：** SwiftUI、UIKit、XCTest、Vitest、现役 releasectl。

## 1. 根因与失败用例

- [x] 读取现行规则、页面与滚动实现，登记发布任务，在独立 worktree 开发。
- [x] 在共享模拟器锁内运行 iPhone 17 Pro 正常字号竖屏基线并录制；在最新 main 上再次反向验证，移除修复后图层探针检出 `fading`。
- [x] 闪动与顶部刷新入口均先检出失败；图层探针等待45帧采样完成，刷新检查尺寸、水平中心与真实命令调用。

## 2. 最小实现与回归

- [x] 在 `mobile/ios/AgentUI/App/RootView.swift` 的会话身份及新对话路由上使用 `.transition(.identity)`，保留滚动与历史锚点。
- [x] 在 `mobile/ios/AgentUI/Home/SidebarScreen.swift` 增加独立顶部按钮，使用 `SidebarIconButton(systemImage: "arrow.clockwise", title: ..., identifier: "sidebar.refreshTop")`，点击执行现有 `session.refreshAll()`；右侧 padding 与更多按钮复用同一值。
- [x] 原生范围11个不同UI用例最终通过，包含真实网关刷新及四次重复进入；完整45帧采样和截图核对通过。常驻侧栏的旧销毁断言已同步为交互状态验收。

## 3. 文档、提交与正式交付

- [x] 同步交互约定与README；更新本版本两项实际中文变化，标记本地已验证、待发布。
- [x] 最终基线204项 adapter-regression、59项 coordinator-recovery、138项 build-contract 及 typecheck 通过；原生UI范围验收另列。
- [ ] `git diff --check` 后按中文 Conventional Commits 提交并推送固定 SHA。
- [ ] 提交 releasectl ready，持续 heartbeat，等待默认双端成功 receipt 并核对 APK、已签名 IPA、OTA 和 unsigned 软件源。
- [ ] 安装正常模拟器 App，退出夹具，释放模拟器锁；如产生测试会话及时归档。

发布任务：`native-entry-refresh-20261019`；目标：`codex-mobile-lan-production`。未取得成功 receipt 前不标记已发布。

独立审查已通过。按审查修复采样前误判通过的探针缺口；真实网关helper改为等待常驻侧栏控件实际可点击。OTA页面测试先读取标准输入，再初始化jsdom，七项既有读取失败全部恢复通过。未改变生产OTA行为。
