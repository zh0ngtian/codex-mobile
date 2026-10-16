# 新版非原生设备菜单修复与 iOS OTA 计划

**目标：** 修复已安装 0.2.182 后仍出现的设备菜单行错位，以及在 iPhone 上点“设置”无法进入设置页的问题。

**问题定位：** 用户截图对应新版非原生 `ModernSidebarHeader`，而上次修复只覆盖了 SwiftUI 原生菜单。菜单内的设备列表继承了全局横向列表的负外边距；WebKit 触摸转移焦点时 `onBlur` 可能先卸载菜单，阻止设置按钮收到 click。

**交付方式：** 在独立分支按 TDD 添加触摸/焦点回归，修复菜单布局和交互；用 iOS 模拟器运行 App 的新版非原生界面，实际点击菜单及设置并保存截图。完成必要本地门禁后推送固定 SHA，通过 `codex-mobile-ios-ota-production` 发布新的签名 OTA；不发布 GitHub Release 或 APK。

## 步骤

- [x] 在 `modern-navigation.test.tsx` 先加入 iOS 式空 `relatedTarget` 焦点转移和设置点击回归，确认旧代码失败。
- [x] 修改菜单焦点处理与设备列表布局，保证菜单各行对齐、设置回调可达；运行针对性测试。
- [x] 生成 iOS 模拟器工程，启动 App 的新版非原生界面，检查菜单布局并实际进入设置页；保留 XCTest 结果和截图。
- [x] 通过 typecheck、build、发布适配器及协调器检查，更新中文更新说明，提交推送。
- [x] 将同一固定 SHA 提交 OTA-only 队列，等待成功凭证；独立核对 HTTPS/LAN 清单、HEAD、完整 GET、大小和 SHA-256。

模拟器使用打入当前前端的 App/WKWebView，通过仅供本地调试的启动参数注入离线设备；没有连接生产网关或创建真实会话。`ModernSidebarUITests.testDeviceMenuAlignmentAndSettingsOpenInEmbeddedWebView` 最终 1 项通过，截图见[菜单](../../assets/ios-simulator/modern-sidebar-menu-20261016.png)与[设置页](../../assets/ios-simulator/modern-sidebar-settings-20261016.png)。

最终 OTA 0.2.183 验收见[发布记录](evidence/2026-10-16-modern-sidebar-menu-ota.json)。未进行真机覆盖安装与数据保留验证。
