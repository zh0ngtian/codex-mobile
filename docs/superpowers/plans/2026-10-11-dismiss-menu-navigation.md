# 取消长按菜单后恢复会话单击

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 逐项执行。

**Goal:** 侧栏会话长按菜单取消后，下一次普通单击进入会话，保留平级纵向原生菜单和其它 UI。

**Architecture:** 使用真实 ThreadListPage 的内存 fixture 复现 UIKit 菜单关闭与网页点击之间的交互。只修复原生菜单锚点清理与必要的长按点击状态，不修改布局。

**Tech Stack:** UIKit、WKWebView、React、XCTest、Vitest。

- [x] 在 `tests/fixtures/native-menu/main.tsx` 接入真实侧栏，在 `mobile/ios/ActionMenuUITests.swift` 验证长按、外部取消、单击进入；运行当前代码，确认失败原因。
- [x] 在 `mobile/ios/ActionMenuBridge.swift` 修复临时菜单宿主的触摸接收；网页的点击抑制影响新触摸，在 `src/features/threads/ThreadListPage.tsx` 添加对应失败用例后最小修复。
- [x] 原生回归菜单取消与选择后单击、消息复制和编辑键盘、平级纵向菜单；运行相关 Vitest 和类型检查。
- [ ] 按提交规范提交推送；取得固定渠道锁，选择更高统一版本，双端构建并发布签名 IPA、APK、OTA 和现役软件源。
- [ ] 核对清单、HEAD、完整 GET 的版本、大小和 SHA-256，保存长期凭证及验收记录，推送文档，删除临时模拟器、归档工作区并释放锁。

执行原生测试：按 `tests/fixtures/native-menu/README.md` 打包 fixture 与配置专用工程，使用专用模拟器和主工作区 `.mobile-build/.ios-simulator.lock`。`xcodebuild test -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj -scheme CodexMobileUITests -destination id=<专用模拟器> -parallel-testing-enabled NO -collect-test-diagnostics never -only-testing:CodexMobileUITests/ActionMenuUITests`。预期取消后会话内容出现，菜单消失。

## 修复与验证

普通取消并等待动画结束的原生路径先验通过；取消后紧接着点击的原生用例失败，网页用例也复现新触摸被旧长按状态抑制。修复仅包含：透明原生菜单宿主 `hitTest` 返回 nil，把触摸交回 WebView；侧栏新 pointerDown 清除旧的尾随点击抑制，仍保留当前长按结束时的误点击防护。没有改菜单样式、操作列表或其它 UI。

相关 Vitest 34 项通过，类型检查通过。原生 XCTest 4 项全部通过（命令退出 0），覆盖取消后单击、关闭动画期间快速单击、选择置顶后单击、消息复制与编辑键盘、六项操作直接纵向可见及重新打开。系统剪贴板回验为“原生菜单验收消息”。专用模拟器已删除并释放模拟器锁；没有创建真实网关会话，未验证真机覆盖安装和数据保留。
