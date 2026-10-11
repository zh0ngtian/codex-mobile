# 历史编辑键盘与定位计划

**Goal:** 进入历史消息编辑时自动聚焦并弹出键盘；键盘缩小可见区域后，把历史编辑框滚动到可见区域，避开固定底部输入栏。

**Architecture:** 保留编辑动作中同步挂载及 focus；会话滚动 hook 在编辑期间暂停跟随底部，显式滚动到历史 textarea。通过滚动容器、内容和底部输入栏的 ResizeObserver，以及 window/visualViewport 的 resize 更新可见边界；使用单帧调度并清理监听与待执行帧。编辑取消后继续允许用户滚动与恢复底部跟随。

**Tech Stack:** React、TypeScript、Playwright、WKWebView/XCUITest。

## 实施
- [x] 修改 `tests/e2e/history-edit-focus.spec.ts`：给编辑消息前增加旧回复，聚焦后模拟键盘缩小 viewport，断言 textarea 整体位于滚动区域与 composer 之间；先跑 Chromium/WebKit 确认失败。
- [x] 在 `src/features/conversation/conversation-scroll.ts` 接收 `historyEditMessageId?: string`，通过 ref 在回调执行时判断编辑状态，阻止待执行的底部跟随。进入编辑先取消跟随帧并定位，键盘/容器 resize 后再次定位。
- [x] `src/features/conversation/ConversationPage.tsx` 传递 `historyEdit?.target.messageId`；`Timeline.tsx` 使用 `input.focus({ preventScroll: true })` 保留同步弹键盘，由会话容器管理滚动。
- [x] 可见区域上边界采用 `max(scroller.top, visualViewport.offsetTop) + 12`，下边界采用 `min(scroller.bottom, visualViewport.bottom, composer.top) - 12`；大编辑框通过 CSS 可见高度变量限制，容器仅纵向滚动。
- [x] 跑 `npm exec playwright test -- --config tests/e2e/history-edit-focus.config.ts`，以及 `tests/ui/conversation-scroll.test.tsx`、`tests/ui/conversation-page-pagination.test.tsx`、`tests/ui/conversation.test.tsx`、`tests/ui/layout-css.test.ts`；前端类型检查与构建。
- [x] 扩展隔离网关的原生菜单 fixture 和 XCUITest，覆盖点击/原生编辑、自动键盘、编辑框在键盘及 composer 以上，保持输入能力；使用模拟器锁串行验证。

## 交付
- [x] 阅读提交规范，中文 Conventional Commits 提交并推送；获取固定渠道锁，按两端和 OTA 的最大版本加一分配统一版本。
- [x] 构建新 APK 和 Ad Hoc 签名 IPA，发布固定 LAN 和 HTTPS OTA，核对 JSON、HEAD、完整 GET、散列、签名及包内前端一致性。
- [x] 按 SignOs 最新 source-aggregator 文档核对对应 GitHub Release 未签名 IPA 的软件源版本；已签名 IPA 只留 OTA/LAN。
- [x] 保存验收证据与交付记录、提交推送，清理本任务临时文件并归档工作树。

## 验证记录

- 修改前 WebKit 在键盘缩小后的 420px 布局视口中，编辑框被固定输入栏遮挡；对应 E2E 失败。修复后 Chromium、WebKit、mobile WebKit 共 3 项通过，并增加仅 visualViewport 缩小的覆盖。
- 相关 Vitest 131 项通过，包含待执行底部跟随与历史编辑定位的冲突、取消编辑后的恢复；前端类型检查和构建通过。
- iOS 26.5 模拟器真实键盘测试通过，覆盖编辑按钮与 UIKit 长按菜单；特大字号、多行历史原文下编辑框在底部模型选项和键盘以上，输入与取消正常。fixture 使用真实 TurnCard、会话滚动 hook 和正式 CSS，不访问真实网关。

- 补充多行末尾光标验收：原生探针先复现编辑框变矮后末尾光标不可见，再验证修复后两个入口均显示末尾光标；仅当光标位于末尾时同步 textarea 内部滚动，不改用户中间的选区。

## 交付记录

- 代码已提交并推送：`9c072e3`、`295eb21`；固定渠道串行分配并发布统一版本 **0.2.156**。
- APK：4,720,335 字节；SHA-256 `aaa3bccf4d378a287b9a35202e19906aedc459ae6ed178507d6edfbc3a544979`。签名证书与之前版本连续。
- Ad Hoc 已签名 IPA：3,789,077 字节；SHA-256 `a8560f475308557318be16e16c9164e5dfadd8176cc8176600a766471ffb48aa`。保留 Bundle ID、Team、application-identifier 和钥匙串权限，签名验收通过。
- 固定 APK/IPA 清单、HEAD、完整 GET 与 HTTPS OTA 均通过回验；两端包内入口 JS/CSS 散列一致，正式工程未包含测试探针。
- OTA 安装页：<https://192.168.123.79:8766/channels/codex-mobile/current/install.html>。
- APK：<http://192.168.123.79:8765/channels/codex-mobile/latest.apk>；IPA：<http://192.168.123.79:8765/channels/codex-mobile/latest.ipa>。
- GitHub Actions `38150954534` 成功，正式 Release `v0.2.156` 的未签名 IPA 已同步至现有软件源订阅。开发者原署名已包含本次 GitHub 登录用户名，保持原值；已签名 IPA 仅发布 OTA/LAN。
- 软件源未签名 IPA：3,765,638 字节；SHA-256 `67619261507f5c8ceaa75e617464cfe9b669bf1d62d443eecbb072400c4f136f`。GitHub HEAD、完整 GET、附件 digest 和软件源清单一致。
- 日志、模拟器附件、安装包与发布回执保存在主工作区 `.mobile-build/history-editor-scroll-release/`。模拟器锁与发布锁已释放，未创建真实网关测试会话；本轮未执行真机覆盖安装验证。
