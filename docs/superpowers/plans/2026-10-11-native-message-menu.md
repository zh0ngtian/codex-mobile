# 原生长按菜单及用户消息操作实施计划

> **执行要求：** 使用 superpowers 的 executing-plans 与 test-driven-development，在独立 worktree 逐项执行；遵循已授权的提交、推送及双端发布要求。

**目标：** 会话列表长按打开系统菜单；用户消息长按支持编辑与复制。

**架构：** React 共用菜单桥负责 action ID、屏幕锚点及生命周期。iOS 使用 UIKit UIEditMenuInteraction，Android 使用 PopupMenu，浏览器保留可访问的网页菜单。复制由原生剪贴板处理，编辑复用现有历史回退并重发和后续对话确认。

**技术栈：** React、TypeScript、UIKit/WebKit、Kotlin/Android WebView、Vitest。

## 任务 1：先验证缺失行为

- [x] 修改 `tests/ui/message-copy.test.tsx`：长按用户消息应显示编辑与复制；复制完整文本且去掉内部标题；菜单编辑回调绑定正确 message ID；忙碌禁用编辑仍可复制。
- [x] 修改 `tests/ui/thread-list-page.test.tsx`：注入原生桥后列表长按只请求原生菜单，动作正确路由，关闭清理桥。
- [x] 新增 `tests/ui/native-action-menu.test.tsx`：原生选择/取消/重复请求隔离与卸载清理。
- [x] 运行 `npm test -- tests/ui/message-copy.test.tsx tests/ui/thread-list-page.test.tsx tests/ui/native-action-menu.test.tsx`，确认失败来自缺失菜单功能。

## 任务 2：实现并通过回归

- [x] 新增 `src/ui/native-action-menu.ts` 与 `src/ui/ContextActionMenu.tsx`，定义菜单动作、锚点、原生事件和清理协议。
- [x] 修改 `src/features/conversation/Timeline.tsx`，长按消息打开菜单；滚动/取消中止长按，复制原始完整正文，编辑调用既有回调；所有平台保留现有编辑按钮与消息布局。
- [x] 修改 `src/features/conversation/ConversationControls.tsx` 和 `src/features/threads/ThreadListPage.tsx`，复用原生桥，保持离线禁用及长按后的点击抑制。
- [x] 新增 `mobile/ios/ActionMenuBridge.swift` 和 `mobile/android/ActionMenuBridge.kt`，分别呈现系统菜单并接入构建配方。
- [x] 运行聚焦测试、`npm run typecheck`、`npm test`、`npm run build`；构建双端验证实际原生编译。

## 任务 3：交付

- [x] 更新 README 交互能力，按 `docs/commit-conventions.md` 提交并推送。
- [x] 获取主工作区固定发布锁，重新读取双端/OTA版本后选择更高统一版本。
- [x] 按既有配方构建 APK；运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '原生长按菜单及消息编辑复制'`。
- [x] 按 SignOs 最新 PUBLISH_PROMPT 发布同一签名 IPA，保留并追加 GitHub 当前用户署名。
- [x] 通过清单、HEAD、完整 GET 核对双端版本、大小、SHA-256，保留签名产物与验收凭证到主工作区，清理临时缓存和锁。

## 验收与固定渠道交付

- 客户端源码提交 `3007133` 已推送 `origin/main`。本任务只修改长按菜单及菜单动作，保留原有消息布局、样式和编辑按钮；编辑复用现有历史消息编辑流程。
- TDD 已先验证长按菜单、动作路由及旧菜单隔离缺失；最终聚焦 Vitest 41 项与 TypeScript 检查通过。此前完整 Vitest 872 项通过；合并上游后 879 项中的 HTTP 会话时序用例首跑失败，该文件 48 项重跑全部通过；Python 89 项通过。
- iOS 26.5 独立模拟器验收 2 项通过：真实 UIKit 菜单、复制、原位置编辑并自动弹出键盘、会话置顶与重新打开；系统剪贴板经 `simctl pbpaste` 回验完整正文一致。原生编辑回调同步提交 React 状态，避免脱离 WebKit 用户操作上下文后无法弹出键盘。
- Android 按固定容器配方完成 Kotlin 编译、APK 权限及内置资源检查；未连接 Android 真机。本次未创建网关真实测试会话；内存验收页不进入正式产物，专用模拟器已删除。
- 发布锁内确认原双端/OTA版本为 0.2.143，统一发布 0.2.144；Android 与 iOS 固定清单、HEAD 和完整 GET 的版本、文件大小及 SHA-256 一致。
- [HTTPS OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)与 HTTPS 更新清单通过受信 CA 校验。IPA 已 Ad Hoc 签名，保留 Bundle ID `vip.loock.codexmobile`、application-identifier `SC456JW7RP.app.jade6694.grapefruit3766` 和原钥匙串组。签名验证与模拟器测试不代表已验证真机覆盖安装及数据保留。
- 依照 SignOs 最新 `distribution/app-source/PUBLISH_PROMPT.md` 的迁移后流程，将同一已签名 IPA 发布到现役家中 HTTPS 软件源；保留 `loock-ai / zh0ngtian` 署名。软件源版本、构建号 2144、大小、SHA-256 及完整下载均通过核验；未恢复停用的 Cloudflare 发布流程。

| 安装包 | 版本 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) | 0.2.144 | 4,959,543 | `9738fcc8f2411cff730697e746449053f5c1c6fa56d1dd2b5e7e98c82edb13dc` |
| [IPA（Ad Hoc 已签名）](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) | 0.2.144 | 3,781,654 | `7a56efa45084ebe1d039b939fb77a7072d56e95267c50d24f18982c871c8b823` |

签名包、APK、原生菜单/编辑截图、XCTest 结果及渠道回验凭证保留在主工作区 `.mobile-build/native-message-menu-release/0.2.144/`。无用构建缓存与临时文件随本任务 worktree 清理；固定发布锁在交付结束后释放。
