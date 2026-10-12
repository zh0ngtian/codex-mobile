# Skill 选择与会话菜单顺序修复计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前独立 worktree 逐项执行；共享模拟器和发布渠道需要串行持锁。

**Goal:** 手机输入 `@` 后可以选择 Skill，边栏会话置顶前后保持相同菜单顺序。

**Architecture:** 复用现有 React 输入框和原生菜单桥，先用实际触摸与菜单位置变化复现，再只修改导致失败的事件处理和 UIKit 排序配置。使用隔离 fixture，不发送真实测试消息。

**Tech Stack:** React、TypeScript、Vitest、Playwright、Swift UIKit、XCTest。

---

## 1. 复现与回归

- [x] 阅读输入框、Skill 目录、菜单桥及现役发布规则；隔离 worktree 安装依赖。现有 Skill 与边栏测试 40 项通过。
- [x] 扩展 `tests/fixtures/native-menu/main.tsx`，加入真实 `ConversationPage` 的 Skill 输入验收及靠近屏幕上下边缘的会话菜单。
- [x] 在 `mobile/ios/ActionMenuUITests.swift` 添加触摸选择与上下位置菜单顺序断言。关键断言：`XCTAssertEqual(input.value as? String, "$pdf ")`；按 `置顶/取消置顶、刷新会话、复制会话、复制会话 ID、重命名、归档` 比较各项 frame.minY。
- [x] 编写 `tests/e2e/skill-picker.spec.ts` 和配置，用 Chromium 与 mobile WebKit 验证 `@pdf` 点击、中文紧邻 `@`、滚动后选择和最大化输入。关键断言：`await expect(input).toHaveValue("$pdf ")`。
- [x] 先运行新增测试，记录实际失败；原生测试按 fixture README 配置工程，独占主工作区 `.mobile-build/.ios-simulator.lock`。

## 2. 最小修复

- [x] 根据复现修改 `src/features/conversation/ConversationPage.tsx` 的选择事件与失焦协调，保留键盘选择、滚动取消和标准 `$skill` 标记。
- [x] 如中文紧邻触发失败，修改 `src/app-server/skills.ts` 的触发边界，仍排除邮件和已有英文标识中的 `@`。
- [x] 在 `mobile/ios/ActionMenuBridge.swift` 的宿主按钮设置 `button.preferredMenuElementOrder = .fixed`，维持动作数组顺序。
- [x] 运行 `npm test -- tests/ui/skill-mention.test.tsx tests/ui/skills.test.ts tests/ui/thread-list-page.test.tsx tests/ui/native-action-menu.test.tsx tests/ui/conversation-controls.test.tsx`、`npm run typecheck`、新增 Playwright 与原生 XCTest，确认回归通过。

## 3. 提交与双端交付

- [ ] 更新本计划的实际根因与验证结果，`git diff --check` 后按中文 Conventional Commits 提交并推送 main。
- [ ] 持有主工作区 `.mobile-build/.fixed-channel-publish.lock`，读取 Android/iOS/OTA 清单和 GitHub Releases，分配统一更高版本。
- [ ] 推送后使用 GitHub 双端构建的 APK 与 unsigned IPA，检查源码提交；本机运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <已分配版本> --notes '修复 Skill 触摸选择并固定会话长按菜单顺序'`。
- [ ] 发布相同版本 APK，检查固定清单、HEAD 和完整 GET 的版本、大小和 SHA-256；核对软件源的 GitHub unsigned IPA 版本与开发者署名。
- [ ] 保存正式签名包、回执和必要验收证据到长期主工作区，清理临时测试资源、释放锁并归档 worktree。交付正文展示固定 OTA、APK、IPA 链接与完整包信息。

## 根因与验证记录

- mobile WebKit 在 `pointerdown.preventDefault()` 后不发送候选按钮的兼容 `click`，原实现只在 `click` 选择；真实 Playwright 触摸和 Vitest 指针回归先失败。改为在有效触摸 `touchend` 选择（笔输入使用 `pointerup`），同时通过位移阈值和 `pointercancel` 排除滚动；鼠标和键盘沿用现有入口。
- 原触发边界仅允许空白，中文紧邻 `@` 时不会打开候选；现支持中文和开引号/括号及中文标点，并使 Skill/插件结构化解析遵循相同边界，邮件与已有调用名仍排除。
- UIKit 默认根据菜单锚点决定优先项靠近触摸位置，靠近下方时会倒序。模拟器红测显示“刷新会话”的 y 为 724，前一项底边为 808；宿主 UIButton 设置 `.fixed` 后上下锚点及置顶/取消置顶顺序通过。
- 65 项相关 Vitest、24 项移动打包/iOS 工程回归、TypeScript 检查通过；Chromium/mobile WebKit 8 项 E2E 通过。
- iPhone 17 Pro / iOS 26.5 的既有 5 项原生菜单回归及新增顺序测试通过；触摸候选测试使用不限制 AX 类型的标签匹配。`pointerup` 提前移除候选在实际 WKWebView 上会让尾随触摸收起键盘，因此通过新的红测将选择延后到 `touchend` 并取消默认行为；最终键盘保持、三次真实坐标拖动后草稿不变、滚动后选择最后一项全部通过（`skill-native-final.xcresult`）。XCTest 的通用 `swipeUp` 对 AX 列表裁剪到近似点击，事件探针确认无 move；已改为可见区域坐标拖动，探针已移除。
- 两端原渠道和最新 GitHub Release 均为 0.2.160，计划统一发布 0.2.161。持有固定发布锁，iOS 配置、签名身份与升级连续性预检通过。GitHub 当前登录用户名与软件源现有署名一致，保持原值。

本轮不连接真实网关、不创建测试会话，无需会话归档。原生菜单、Skill 验收截图、日志与 xcresult 保存到长期主工作区的 `.mobile-build/skill-picker-menu-release/`。模拟器验收不代表真机覆盖升级和数据保留已验证。
