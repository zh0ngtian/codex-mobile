# 原生长按菜单及用户消息操作实施计划

> **执行要求：** 使用 superpowers 的 executing-plans 与 test-driven-development，在独立 worktree 逐项执行；遵循已授权的提交、推送及双端发布要求。

**目标：** 会话列表长按打开系统菜单；用户消息长按支持编辑与复制。

**架构：** React 共用菜单桥负责 action ID、屏幕锚点及生命周期。iOS 使用 UIKit UIEditMenuInteraction，Android 使用 PopupMenu，浏览器保留可访问的网页菜单。复制由原生剪贴板处理，编辑复用现有历史回退并重发和后续对话确认。

**技术栈：** React、TypeScript、UIKit/WebKit、Kotlin/Android WebView、Vitest。

## 任务 1：先验证缺失行为

- [ ] 修改 `tests/ui/message-copy.test.tsx`：长按用户消息应显示编辑与复制；复制完整文本且去掉内部标题；菜单编辑回调绑定正确 message ID；忙碌禁用编辑仍可复制。
- [ ] 修改 `tests/ui/thread-list-page.test.tsx`：注入原生桥后列表长按只请求原生菜单，动作正确路由，关闭清理桥。
- [ ] 新增 `tests/ui/native-action-menu.test.tsx`：原生选择/取消/重复请求隔离与卸载清理。
- [ ] 运行 `npm test -- tests/ui/message-copy.test.tsx tests/ui/thread-list-page.test.tsx tests/ui/native-action-menu.test.tsx`，确认失败来自缺失菜单功能。

## 任务 2：实现并通过回归

- [ ] 新增 `src/ui/native-action-menu.ts` 与 `src/ui/ContextActionMenu.tsx`，定义菜单动作、锚点、原生事件和清理协议。
- [ ] 修改 `src/features/conversation/Timeline.tsx`，长按消息打开菜单；滚动/取消中止长按，复制原始完整正文，编辑调用既有回调；浏览器保留现有编辑按钮。
- [ ] 修改 `src/features/conversation/ConversationControls.tsx` 和 `src/features/threads/ThreadListPage.tsx`，复用原生桥，保持离线禁用及长按后的点击抑制。
- [ ] 新增 `mobile/ios/ActionMenuBridge.swift` 和 `mobile/android/ActionMenuBridge.kt`，分别呈现系统菜单并接入构建配方。
- [ ] 运行聚焦测试、`npm run typecheck`、`npm test`、`npm run build`；构建双端验证实际原生编译。

## 任务 3：交付

- [ ] 更新 README 交互能力，按 `docs/commit-conventions.md` 提交并推送。
- [ ] 获取主工作区固定发布锁，重新读取双端/OTA版本后选择更高统一版本。
- [ ] 按既有配方构建 APK；运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '原生长按菜单及消息编辑复制'`。
- [ ] 按 SignOs 最新 PUBLISH_PROMPT 发布同一签名 IPA，保留并追加 GitHub 当前用户署名。
- [ ] 通过清单、HEAD、完整 GET 核对双端版本、大小、SHA-256，保留签名产物与验收凭证到主工作区，清理临时缓存和锁。
