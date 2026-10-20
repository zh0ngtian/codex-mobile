# 取消长按菜单后恢复会话单击

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 逐项执行。

**Goal:** 侧栏会话长按菜单取消后，下一次普通单击进入会话，保留平级纵向原生菜单和其它 UI。

**Architecture:** 使用真实 ThreadListPage 的内存 fixture 复现 UIKit 菜单关闭与网页点击之间的交互。只修复原生菜单锚点清理与必要的长按点击状态，不修改布局。

**Tech Stack:** UIKit、WKWebView、React、XCTest、Vitest。

- [x] 在 `tests/fixtures/native-menu/main.tsx` 接入真实侧栏，在 `mobile/ios/ActionMenuUITests.swift` 验证长按、外部取消、单击进入；运行当前代码，确认失败原因。
- [x] 在 `mobile/ios/ActionMenuBridge.swift` 修复临时菜单宿主的触摸接收；网页的点击抑制影响新触摸，在 `src/features/threads/ThreadListPage.tsx` 添加对应失败用例后最小修复。
- [x] 原生回归菜单取消与选择后单击、消息复制和编辑键盘、平级纵向菜单；运行相关 Vitest 和类型检查。
- [x] 按提交规范提交推送；取得固定渠道锁，选择更高统一版本，双端构建并发布签名 IPA、APK、OTA 和现役软件源。
- [x] 核对清单、HEAD、完整 GET 的版本、大小和 SHA-256，保存长期凭证及验收记录，推送文档，删除临时模拟器、归档工作区并释放锁。

执行原生测试：按 `tests/fixtures/native-menu/README.md` 打包 fixture 与配置专用工程，使用专用模拟器和主工作区 `.mobile-build/.ios-simulator.lock`。`xcodebuild test -project .mobile-build/ios/pakeplus/PakePlus.xcodeproj -scheme CodexMobileUITests -destination id=<专用模拟器> -parallel-testing-enabled NO -collect-test-diagnostics never -only-testing:CodexMobileUITests/ActionMenuUITests`。预期取消后会话内容出现，菜单消失。

## 修复与验证

普通取消并等待动画结束的原生路径先验通过；取消后紧接着点击的原生用例失败，网页用例也复现新触摸被旧长按状态抑制。修复仅包含：透明原生菜单宿主 `hitTest` 返回 nil，把触摸交回 WebView；侧栏新 pointerDown 清除旧的尾随点击抑制，仍保留当前长按结束时的误点击防护。没有改菜单样式、操作列表或其它 UI。

相关 Vitest 34 项通过，类型检查通过。原生 XCTest 4 项全部通过（命令退出 0），覆盖取消后单击、关闭动画期间快速单击、选择置顶后单击、消息复制与编辑键盘、六项操作直接纵向可见及重新打开。系统剪贴板回验为“原生菜单验收消息”。专用模拟器已删除并释放模拟器锁；没有创建真实网关会话，未验证真机覆盖安装和数据保留。

## 双端发布

源码提交 `f7b7147fc31df15a9a5ac8567dac47efb0f6a3ec` 已推送。在固定渠道发布锁内确认原双端 0.2.151，统一发布 0.2.152。Android 按固定 recipe 本地构建并完成内置资源与权限检查；iOS 从正式源码重新生成工程，完成设备构建、Ad Hoc 签名及验签，保留原 Bundle ID、application-identifier、权限和钥匙串组。

[固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)

| 安装包 | 版本 | 大小（字节） | SHA-256 |
| --- | --- | --- | --- |
| [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) | 0.2.152 | 4,716,023 | `515dac3c53d07169f99cd66d29b9462d80d3903c295b731dcf395567f15a6790` |
| [IPA（Ad Hoc 已签名）](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) | 0.2.152 | 3,785,435 | `4c991a04893a249e8ded2c1b38b6140207373e728bd040ea68adf392ee7735c4` |

两个固定 JSON、HEAD 和完整 GET 均核对版本、大小与散列。HTTPS OTA 安装页及清单使用配置 CA 验证通过。

按照 SignOs 最新 `distribution/source-aggregator/README.md`，同一签名 IPA 公开归档到 GitHub，并在 Cloudflare 软件源发布独立 Ad Hoc 变体，保留原未签名订阅。软件源解析版本 0.2.152、buildNumber 2152；公开清单及 GitHub 完整 GET 的大小和 SHA-256 与 OTA 凭证一致。当前 GitHub 登录用户名为 `zh0ngtian`，软件源该应用的当前开发者署名已包含该用户名，保持原值。

长期凭证保存于主工作区 `.mobile-build/dismiss-menu-release/0.2.152/`，包括双端安装包、签名报告、OTA 与软件源回执、验证 JSON、XCTest 结果包、截图及必要日志。交付收尾推送本记录，清理本次临时文件与构建容器，归档专用 worktree 并释放固定渠道发布锁。
