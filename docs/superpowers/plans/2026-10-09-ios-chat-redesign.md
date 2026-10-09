# iOS 对话可读性与 ChatGPT 交互重做计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 执行独立 Markdown 单元，主任务负责连续的页面决策与集成；遵循 test-driven-development 并在交付前执行视觉与交互验收。

**Goal:** 修复输入区塌缩和正文不可读，让核心对话遵循 ChatGPT 的阅读与输入结构。

**Architecture:** 保留 React 业务状态与现有序列桥接。UIKit 使用稳定的顶部栏、原生气泡与分块 Markdown、折叠活动、明确宽度的底部输入区。源码在仓库维护，生成工程仍由固定流水线复制。

**Tech Stack:** TypeScript / UIKit / Foundation / UITableView / UITextView / Vitest / XCTest / 本机 Ad Hoc OTA。

## 视觉证据与目标

- 当前截图保存于主工作区 `.mobile-build/chat-redesign-audit/before/`：空输入框近乎零宽、常驻设置横排、表格原始竖线、回复没有段落层次。
- 参考来源：[ChatGPT 官方 App Store](https://apps.apple.com/us/app/chatgpt/id6448311069)，官方截图保存于 `.mobile-build/chat-redesign-audit/reference/`。
- 顶栏仅有侧栏入口、简洁标题/模型入口、会话菜单；设备、项目、权限位于菜单。
- 用户消息为右侧灰色气泡，回复为左侧正文；段落、标题、代码块、表格分别布局，不显示重复角色/时间或原始工具命令。
- 输入胶囊占满可用宽度，placeholder 明确，附件在左、圆形发送/停止在右；键盘收起保持草稿与可编辑性。

## 任务 1：可审查截图与失败回归

**Files:** `mobile/ios/NativeConversationUITests.swift`、`tests/ui/native-conversation.test.tsx`。

- [x] 从当前实现截图空白、历史正文、键盘编辑与收起状态，保存并实际检查。
- [x] 增加 UIKit 真实几何回归：空输入框宽度至少屏幕宽度的 65%，输入区域与发送按钮在屏幕内、44pt 可操作；加载完成后才接受截图。

```swift
XCTAssertGreaterThan(composer.frame.width, app.frame.width * 0.65)
XCTAssertLessThanOrEqual(app.buttons["codex.native.send"].frame.maxX, app.frame.maxX)
```

- [x] 增加投影回归：同一 turn 的工具与 commentary 折叠为稳定 activity 行，最终回复与用户消息完整保留。

```ts
expect(rows.map(row => row.role)).toEqual(["user", "tool", "assistant"]);
expect(rows[1].id).toBe("turn:activity");
expect(rows[1].detail).toContain("完整工具输出");
```

## 任务 2：分块 Markdown

**Files:** 新增 `mobile/ios/NativeMarkdown.swift`、`mobile/ios/NativeMarkdownTests.swift`。

- [x] 独立单元先红后绿，保留标题、段落、列表、引用、代码与表格数据。

```swift
enum NativeMarkdownBlock: Equatable {
    case paragraph(String), heading(level: Int, text: String)
    case list(ordered: Bool, items: [String], start: Int = 1), quote(String)
    case code(language: String, text: String)
    case table(headers: [String], rows: [[String]]), divider
}
// NativeMarkdown.parse(_:) 返回结构；NativeMarkdown.inline(_:font:color:) 提供 inline 属性。
```

- [x] `swiftc -D NATIVE_MARKDOWN_TESTS mobile/ios/NativeMarkdown.swift mobile/ios/NativeMarkdownTests.swift -o /tmp/codex-mobile-markdown-tests` 并执行；iOS SDK typecheck 验证 inline 样式。

## 任务 3：原生布局与交互

**Files:** `NativeConversationViewController.swift`、新增 `NativeConversationCell.swift`；`NativeConversationState.swift`；`native-conversation.ts`、`ConversationPage.tsx`。

- [x] 重做顶栏、空态与输入区，移除常驻设置行；明确 textarea 横向约束，不依赖空 UITextView intrinsic width。

```swift
composer.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 16)
composer.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -16)
sendButton.widthAnchor.constraint(equalToConstant: 44)
sendButton.heightAnchor.constraint(equalToConstant: 44)
```

- [x] 单元格使用用户气泡与回复分块 stack；code 背景、复制入口、table 横向滚动并保留完整单元格；活动行仅摘要与详情入口。
- [x] 使用菜单提供复制/编辑/完整内容；模型、权限、项目、设备动作复用 React；原有草稿 ack、IME、只读、队列、滚动锚点不退化。
- [x] 只读主界面显示人可读状态，不显示原始 active-writer 错误；保留其他真实错误及重试入口。
- [x] 拆分源文件后由 `.github/workflows/build-ios.yml` 复制，更新 CI 源码契约。

## 任务 4：视觉验收、提交与发布

- [x] 生成工程；串行跑空白/键盘几何、草稿、真实发送、翻历史与分页 XCTest，并导出实际截图。
- [x] 实际检查空白/正常回复/中文长文/工具活动/代码表格/键盘/只读/深色画面；与参考截图并排判断布局、留白、层次和按钮尺寸，发现缺陷先修复再交付。
- [x] 全量 Vitest、相关 Foundation、Python iOS、typecheck、build、diff check；独立规格与质量复审。
- [x] 中文 Conventional Commit 提交、推送并合入 main；分配高于两端固定渠道的统一版本。
- [x] 构建 APK 与本机签名 IPA，发布固定 LAN 与 HTTPS OTA；通过 JSON、HEAD、完整 GET 核对两端版本、大小和 SHA-256。
- [x] 归档仅本轮测试会话、停止网关、保存交付证据、清理临时文件并归档工作树。真机安装仍需用户验证。

交付版本 `0.2.131`；运行代码提交 `ce14c22`。实际截图、回归与双端渠道元数据见 [模拟器验证记录](../../ios-simulator-verification.md#2026-10-09-对话可读性重做)。仅回复截图夹具通过 `NATIVE_IOS_DESIGN_THREAD_TITLE` 显式启用，完成后测试会话归档。
