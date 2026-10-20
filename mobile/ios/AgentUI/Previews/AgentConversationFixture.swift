#if DEBUG
import Foundation
import Observation
import UIKit
import SwiftUI

/// 只由显式 UI 回归参数启用；不挂载业务 WebView，不连接网关或伪造真实验收。
@MainActor @Observable
final class AgentConversationFixture {
    static let argument = "--agent-conversation-fixture"
    private(set) var historyRequestCount = 0
    private var deferredCommentary: NativeMessage?
    private var navigationRefreshCount = 0
    private let store: NativeUIStore
    private let session: AppSession
    private var snapshot: NativeSnapshot
    private let selectionQuotes = AgentSelectionQuotesFixture()
    // 2秒64×64灰色视频，仅供显式离线UI回归使用。
    private let previewVideoSource = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANhbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAox0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAABAAAABAAAAAAIEbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABr21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAW9zdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwAQPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAL7AAAAAAAAAAYc3R0cwAAAAAAAAABAAAABAAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAChjdHRzAAAAAAAAAAMAAAABAABAAAAAAAEAAIAAAAAAAgAAIAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAQAAAABAAAAJHN0c3oAAAAAAAAAAAAAAAQAAALVAAAADgAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAA5EAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAAMDbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAIGWIhAAV//73ye/An9Ktb+Tz0j4e8ZQD6wZq+vbSH/7NAAAACkGaI2xBL/61K+8AAAAIQZ5BeIJ/ATEAAAAIAZ5iakEvAXs="

    init(store: NativeUIStore, session: AppSession) {
        self.store = store
        self.session = session
        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 17, hour: 10, minute: 44))!
        let entries = [
            NativeCommentaryEntry(id: "progress-1", text: "正在读取项目上下文。", timestamp: date.timeIntervalSince1970),
            NativeCommentaryEntry(id: "progress-2", text: "已检查相关文件，正在整理结果。", timestamp: date.addingTimeInterval(60).timeIntervalSince1970),
        ]
        var value = NativeSnapshot()
        value.ready = true; value.connection = "online"; value.contextId = "conversation-ui-fixture"
        value.backendId = "conversation-ui-device"; value.listBackendId = value.backendId
        value.threadId = "conversation-ui-thread"; value.title = "对话界面回归"; value.sidebarOpen = false
        value.backends = [NativeBackend(id: "conversation-ui-device", title: "界面夹具", connected: true)]
        value.models = [NativeOption(id: "model-a", title: "Model A", value: "model-a"), NativeOption(id: "model-b", title: "Model B", value: "model-b")]
        value.model = "Model A"; value.modelValue = "model-a"
        value.efforts = [NativeOption(id: "low", title: "Low", value: "low"), NativeOption(id: "medium", title: "Medium", value: "medium"), NativeOption(id: "high", title: "High", value: "high")]
        value.effortValue = "low"
        if ProcessInfo.processInfo.arguments.contains("--agent-permission-menu-fixture") {
            value.permissions = [NativeOption(id: "default", title: "默认权限", value: "default"), NativeOption(id: "auto-review", title: "自动审核", value: "auto-review"), NativeOption(id: "read-only", title: "只读", value: "read-only"), NativeOption(id: "full-access", title: "完全访问权限", value: "full-access"), NativeOption(id: "custom", title: "自定义", value: "custom")]
            value.permissionValue = "default"
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-fast-fixture") {
            value.speeds = [NativeOption(id: "normal", title: "普通速度", value: ""), NativeOption(id: "fast", title: "Fast", value: "priority")]
            value.speedValue = ""
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-composer-reference-fixture") {
            value.models[0].title = "GPT-6.1 Sol"; value.model = "GPT-6.1 Sol"
            value.effortValue = "high"; value.speedValue = "priority"; value.permissionValue = "full-access"
        }
        value.olderTurnsState = "idle"
        value.conversationActions = [NativePanelItem(id: "older", kind: "action", title: "加载更早消息", command: NativeCommand(name: "thread.older"))]
        let history = NativeMessage(id: "history", role: "activity", text: "", blocks: [NativePanelItem(id: "history-block", kind: "disclosure", title: "历史过程 (2)")], turnId: "fixture-turn", commentary: entries, commentaryBlockId: "history-block", commentaryCanAttachToReply: true)
        value.messages = [
            NativeMessage(id: "question", role: "user", text: "请检查项目上下文。\n\n", timestamp: date.addingTimeInterval(-60).timeIntervalSince1970, turnId: "fixture-turn"),
            history,
            NativeMessage(id: "answer", role: "assistant", text: "已完成检查。查看 [网页链接](https://example.com) 与 [文件链接](/tmp/example.swift#L12)。", timestamp: date.addingTimeInterval(120).timeIntervalSince1970, turnId: "fixture-turn", phase: "final_answer"),
        ]
        value.messages[2].status = ProcessInfo.processInfo.arguments.contains("--agent-no-duration-fixture") ? nil : "1小时2分钟3秒"
        if ProcessInfo.processInfo.arguments.contains("--agent-commentary-backfill-fixture") {
            deferredCommentary = history
            value.messages.removeAll { $0.id == history.id }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-running-history-fixture") {
            value.busy = true
            value.messages[1].commentaryIsRunning = true
            value.messages[2].commentaryIsRunning = true
            value.messages[2].status = nil
            value.messages[2].timestamp = nil
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-steered-replies-fixture") {
            func history(_ id: String, _ text: String) -> NativeMessage {
                NativeMessage(id: id, role: "activity", text: "", turnId: "fixture-turn",
                    commentary: [NativeCommentaryEntry(id: id + "-entry", text: text, timestamp: date.timeIntervalSince1970)], commentaryCanAttachToReply: true)
            }
            func oldReply(_ id: String, _ text: String) -> NativeMessage {
                var entry = NativeCommentaryEntry(id: id, text: text, timestamp: date.timeIntervalSince1970)
                entry.isPreviousReply = true
                return NativeMessage(id: id, role: "assistant", text: text,
                    actions: [NativePanelItem(id: id + "-copy", kind: "action", command: NativeCommand(name: "message.copy", params: ["id": .string(id)]))],
                    turnId: "fixture-turn", phase: "final_answer", commentary: [entry], commentaryCanAttachToReply: true)
            }
            value.messages = [
                NativeMessage(id: "initial", role: "user", text: "先检查问题。", turnId: "fixture-turn"),
                NativeMessage(id: "steer-1", role: "user", text: "先修复测试。", turnId: "fixture-turn"),
                NativeMessage(id: "steer-2", role: "user", text: "再检查构建。", turnId: "fixture-turn"),
                history("history-1", "第一段执行进展。"), oldReply("old-final-1", "中途旧回答一，**保留加粗**。"),
                history("history-2", "第二段执行进展。"), oldReply("old-final-2", "中途旧回答二。"),
                NativeMessage(id: "last-final", role: "assistant", text: "最终回答：完成所有调整。", status: "22秒", turnId: "fixture-turn", phase: "final_answer")
            ]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-many-devices-fixture") {
            value.backends += (1...11).map { NativeBackend(id: "extra-device-\($0)", title: "额外设备 \($0)", connected: true) }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-steering-status-fixture") {
            value.messages.append(NativeMessage(id: "pending-steer", role: "activity", text: "正在引导的消息", status: "正在引导"))
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-edit-history-fixture") {
            value.messages[0].actions = [NativePanelItem(id: "edit", kind: "action", title: "编辑", command: NativeCommand(name: "message.edit", params: ["id": .string("question")]))]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-user-links-fixture") {
            value.messages[0].text = "看下这个教程 [https://example.com/blogs/?post=usersettings](https://example.com/blogs/?post=usersettings)\n"
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-duplicate-time-fixture") {
            value.busy = true
            value.messages = [NativeMessage(id: "earlier", role: "assistant", text: "较早的执行进展。", blocks: [NativePanelItem(id: "earlier:timestamp", kind: "text", text: "2026-10-18 10:44")], timestamp: date.addingTimeInterval(86400).timeIntervalSince1970, phase: "commentary", commentaryIsLiveTail: false)]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-portrait-thumbnail-fixture") {
            let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 240)).image { context in
                UIColor.red.setFill(); context.cgContext.fill(CGRect(x: 0, y: 0, width: 40, height: 240))
            }
            let url = "data:image/png;base64," + image.pngData()!.base64EncodedString()
            value.attachments = [NativeAttachment(id: "portrait", name: "竖屏测试.png", imageURL: url)]
            value.attachments[0].type = "image/png"
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-delayed-attachment-import-fixture") { value.busy = true }
        if ProcessInfo.processInfo.arguments.contains("--agent-queue-controls-fixture") {
            value.busy = true
            value.messages = []
            value.queued = [NativeNavigationItem(id: "queue-controls", title: "队列按钮布局检查", inputText: "队列按钮布局检查", queueState: "queued", configuration: NativeQueueConfiguration(model: "Model A", effort: "low", permission: "workspace-write"))]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-table-controls-fixture") {
            value.messages = [NativeMessage(id: "table-controls", role: "assistant", text: "| # | 问题 | 修复情况 |\n| --- | --- | --- |\n| 1 | 短列 | 这段表格正文必须完整显示，长内容恢复换行，并继续支持横向查看，不能截断或丢失文字。 |\n| 2 | 编辑消息 | 保留 **加粗** 和 [链接](https://example.com) |", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-migration-table-fixture") {
            value.messages = [NativeMessage(id: "migration-table", role: "assistant", text: """
            | 部分 | 迁移内容 |
            |---|---|
            | 应用入口与构建 | 建立独立原生 iOS 工程，直接启动现有 AgentUI；逐步解除 PakePlus、`dist/index.html`、前端打包及脚本注入依赖；适配现有构建、签名和 OTA 脚本 |
            | 通信与协议 | 将 `src/backends`、`src/app-server` 的客户端逻辑迁到 Swift，覆盖鉴权、初始化、HTTP 轮询、WebSocket、超时、重连、事件游标和能力检测 |
            | 会话状态 | 将会话加载、分页、实时增量、历史回填、消息去重、运行状态、过程排序等迁入原生业务层 |
            | 写操作与交互 | 迁移发送、停止、排队、引导、历史编辑、审批、结构化提问、模型和权限选择，以及 Sidechat |
            | 多设备与侧栏 | 迁移设备注册、连接管理、项目折叠、每批五条分页、关注、未读、搜索和刷新调度 |
            | 本地存储 | 将设备配置、凭据、偏好、草稿及附件、关注和未读等，从 localStorage/IndexedDB 迁到原生存储；另行处理未确认写操作记录 |
            | 文件与系统能力 | 图片/文件导入、HEIC 转换、上传下载、预览、位置、扫码、通知和深链，改为由 Swift 业务直接调用 |
            | 富内容 | 补齐 Markdown/GFM、代码、表格、Diff、图片与媒体的原生处理；单独确定 HTML、SVG、Mermaid 和外部网页的实现边界 |
            | 桥接清理 | 替换 `NativeSnapshot → AppSession` 和字符串命令调用；最终移除业务 WebView、JS runtime、界面切换与旧界面恢复入口 |
            """, phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-release-reply-fixture") {
            value.messages = [NativeMessage(id: "release-reply", role: "assistant", text: """
            已发布 **0.3.20（3020）**，包含表格渲染和消息长按菜单修复。

            [iPhone OTA 安装](https://example.com/install.html)

            - [APK 下载](https://example.com/latest.apk)：4,745,915 字节\u{20}\u{20}
              SHA-256：`bd309dfa76a14e11957cd035f976372b22fd7e1e4dea46569008a55cff820a07`
            - [IPA 下载（Ad Hoc 已签名）](https://example.com/latest.ipa)：4,834,512 字节\u{20}\u{20}
              SHA-256：`884c6ba4f26dee837bb676dc707a60591d0f134932abcd030910c170e1e39c28`

            渠道与软件源回验通过；真机覆盖安装及数据保留待验收。
            """, phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-monospace-wrap-fixture") {
            let code = String(repeating: "0123456789abcdef", count: 16) + "\nreturn " + String(repeating: "TOKEN_", count: 32)
            value.messages = [NativeMessage(id: "monospace-wrap", role: "assistant", text: "长等宽序列应完整换行，复制保留原文。\n\n```text\n" + code + "\n```", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-code-wrap-toggle-fixture") {
            let code = String(repeating: "abcdef0123456789", count: 6) + "\nend"
            value.messages = [NativeMessage(id: "code-wrap-toggle", role: "assistant", text: "```text\n" + code + "\n```\n\n```text\nsecond_" + code + "\n```", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-confirmation-controls-fixture") {
            value.panel = NativePanel(id: "confirmation:workspace:fixture:1", title: "确认操作", items: [
                NativePanelItem(id: "confirmation-yes", kind: "action", title: "确认", text: "归档后，此会话将从列表中移除。确定归档吗？", command: NativeCommand(name: "confirmation.answer", params: ["key": .string("confirmation:workspace:fixture:1"), "confirmed": .bool(true)])),
                NativePanelItem(id: "confirmation-no", kind: "action", title: "取消", command: NativeCommand(name: "confirmation.answer", params: ["key": .string("confirmation:workspace:fixture:1"), "confirmed": .bool(false)])),
            ])
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-long-user-selection-fixture") {
            value.messages = [NativeMessage(id: "long-user", role: "user", text: (1...200).map { $0 == 200 ? "第200行：完整长消息末尾" : "第\($0)行：长消息完整显示" }.joined(separator: "\n"))]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-short-question-fixture") { value.messages[0].text = "好" }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-polish-fixture") {
            value.messages[0].text = String(repeating: "短行\n", count: 14) + "这是一条展开后才显示的较长正文，用于确认消息气泡在展开更多和收起时保持同样的宽度。"
            value.groups = [("z", "Zeta"), ("a", "Alpha"), ("m", "Middle")].map { key, title in
                let item = NativeNavigationItem(id: "row-" + key, title: key == "z" && ProcessInfo.processInfo.arguments.contains("--agent-sidebar-long-title-fixture") ? "这是一条非常长的会话名称，用来验证侧栏始终只有一行并在末尾省略完整内容" : "任务 " + title,
                    command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("thread-" + key)]),
                    isUnread: key == "a", running: key == "z")
                return NativeGroup(id: "project-" + key, title: title, items: [item], command: NativeCommand(name: "project.toggle", params: ["id": .string("project-" + key)]), collapsed: false, category: "project", cwd: "/" + title)
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-polish-fixture") {
            value.groups.insert(NativeGroup(id: "fixture-pinned", title: "", items: [NativeNavigationItem(
                id: "pinned-fixture", title: "关注的会话", command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("conversation-ui-thread")]), isPinned: true)], category: "pinned"), at: 0)
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-pagination-fixture"),
           let index = value.groups.firstIndex(where: { $0.id == "project-z" }) {
            let rows = (1...12).map { number in
                NativeNavigationItem(id: "page-row-\(number)", title: "分页会话 \(number)",
                    command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("page-thread-\(number)")]),
                    running: number == 2 && ProcessInfo.processInfo.arguments.contains("--agent-sidebar-running-count-fixture"))
            }
            value.groups[index].items = rows
            value.groups[index].allItems = rows
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-conversation-long-fixture") {
            value.messages += (1...14).map { index in
                NativeMessage(id: "long-\(index)", role: "assistant", text: "阅读位置 \(index)\n用于验证再次下拉时加载旧消息，并保持原有阅读位置。\n重复正文只在独立的界面回归夹具中出现。")
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-video-preview-fixture") {
            value.draft = "视频预览关闭后保留的草稿"
            value.canSend = true
            value.attachments = [NativeAttachment(id: "preview-video", name: "preview.mp4", type: "video/mp4",
                command: NativeCommand(name: "attachment.preview", params: ["id": .string("preview-video")]))]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-preview-polish-fixture") {
            value.messages[0].text = String(repeating: "短行\n", count: 14) + "展开后的正文仅用于核对强调色，完整文字不会改变气泡的宽度。"
            let image = UIImage(systemName: "photo")!.withTintColor(.gray, renderingMode: .alwaysOriginal).pngData()!
            let html = Data("<html><body style='font: -apple-system-body'>Neutral preview file</body></html>".utf8)
            value.messages.append(NativeMessage(id: "preview-assets", role: "assistant", text: "预览附件", blocks: [
                NativePanelItem(id: "preview-image", kind: "image", title: "preview.png", value: "data:image/png;base64," + image.base64EncodedString()),
                NativePanelItem(id: "preview-file", kind: "html", title: "preview.html", value: "data:text/html;base64," + html.base64EncodedString()),
            ]))
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-inline-image-preview-fixture") {
            let image = UIImage(systemName: "photo")!.withTintColor(.gray, renderingMode: .alwaysOriginal).pngData()!
            let source = "data:image/png;base64," + image.base64EncodedString()
            value.messages = [NativeMessage(id: "inline-image", role: "assistant", text: "![内联预览图片](\(source))", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-usage-polish-fixture") {
            value.tokenUsage = NativeTokenUsage(lastRequestTokens: 250, modelContextWindow: 1000, inputTokens: 12345, cachedInputTokens: ProcessInfo.processInfo.arguments.contains("--agent-usage-cache-fixture") ? 0 : nil, outputTokens: 25)
            value.sevenDayRateLimit = NativeRateLimit(remainingPercent: 60, resetsAt: Date().addingTimeInterval(111 * 3600 + 1800).timeIntervalSince1970, windowDurationMins: 10080)
            value.fiveHourRateLimit = NativeRateLimit(remainingPercent: 80)
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-selectable-answer-fixture") {
            value.messages = [value.messages[0], NativeMessage(id: "selectable-answer", role: "assistant", text: "第一段包含 **加粗文字**、`行内代码` 和 [网页链接](https://example.com)。\n\n第二段支持跨段自由选择文字，并保留系统的选择手柄。\n\n## Markdown 标题\n\n> 引用正文\n\n- 列表正文\n\n```swift\nlet greeting = \"Hello\"\nprint(greeting)\n```\n\n| 参数 | 含义 |\n| --- | --- |\n| 名称 | 可选择的表格正文 |", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-project-name-fixture") {
            value.threadId = nil
            value.cwd = "/Users/test/WorkSpace/MyProject"
            value.backends[0].projects = [value.cwd!, "/Users/test/WorkSpace/AnotherProject"]
            value.messages = []
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-reference-type-fixture") {
            value.cwd = "/Users/test/WorkSpace/AgentApp"
            value.messages = [NativeMessage(id: "reference-question", role: "user", text: "罗马的凯撒是同性恋吗？"), NativeMessage(id: "reference-answer", role: "assistant", text: "**尤利乌斯·凯撒确实曾被指与男性发生性关系，但没有足够证据证明他是同性恋。** 如果相关传闻属实，按照现代分类，他可能更接近双性恋。\n\n### 1. 凯撒与比提尼亚国王的绯闻\n\n公元前80年前后，年轻的凯撒出使小亚细亚的比提尼亚王国，与国王尼科美德四世（Nicomedes IV）建立了密切关系。\n\n后来，罗马政敌不断指控凯撒是国王的男宠，甚至嘲讽他是「比提尼亚王后」。", phase: "final_answer")]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-running-commentary-fixture") {
            value.busy = true
            value.messages = [value.messages[0], NativeMessage(id: "independent-commentary", role: "assistant", text: "准备读取项目。", phase: "commentary"),
                NativeMessage(id: "tool-call", role: "activity", text: "不应显示的工具调用", activityKind: "tool"),
                NativeMessage(id: "tail-commentary", role: "assistant", text: "正在整理项目。", phase: "commentary", commentaryIsLiveTail: true)]
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-model-efforts-fixture") {
            value.models[0].efforts = value.efforts
            value.models[0].defaultEffort = "medium"
            value.models[1].efforts = [NativeOption(id: "high", title: "High", value: "high")]
            value.models[1].defaultEffort = "high"
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-model-catalog-fixture") {
            value.models += (0...59).map { NativeOption(id: "catalog-\($0)", title: "Catalog Model \($0)", value: "catalog-\($0)") }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-running-scroll-fixture") {
            value.busy = true
            value.messages.append(NativeMessage(id: "streaming-scroll", role: "assistant", text: "运行中的新增进展。", phase: "commentary", commentaryIsLiveTail: true))
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-submit-fixture") { value.canSend = true; value.draft = "触感检查" }
        if ProcessInfo.processInfo.arguments.contains("--agent-multiline-composer-fixture") {
            value.canSend = true
            value.draft = "第一行：检查输入框顶部留白\n第二行：检查多行文字间距\n第三行：检查下方按钮对齐"
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-startup-loading-fixture") { value.ready = false }
        value.messages = value.messages.map { message in
            var anchored = message
            anchored.scrollAnchorId = message.id
            return anchored
        }
        let deferredMessages = value.messages
        if ProcessInfo.processInfo.arguments.contains("--agent-delayed-report-fixture") { value.messages = []; value.loading = "loading" }
        if ProcessInfo.processInfo.arguments.contains("--agent-entry-transition-fixture") { value.threadId = nil; value.messages = [] }
        if ProcessInfo.processInfo.arguments.contains(AgentSelectionQuotesFixture.argument) { selectionQuotes.configure(&value) }
        if ProcessInfo.processInfo.arguments.contains("--agent-no-devices-fixture") {
            value.backends = []; value.groups = []; value.messages = []
            value.backendId = nil; value.listBackendId = nil; value.threadId = nil
        }
        snapshot = value
        store.sendCommand = { [weak self] command in self?.dispatch(command) }
        publish()
        if ProcessInfo.processInfo.arguments.contains("--agent-delayed-report-fixture") {
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(8))
                guard let self else { return }
                self.snapshot.loading = "ready"
                self.snapshot.messages = deferredMessages
                let paragraphs = (1...85).map { "**第\($0)段分析。** 这是长报告的分段正文，包含普通文字和加粗文字，用于重现首次加载后异步 Markdown 布局与底部定位之间的竞争。正文通过真实的原生 Markdown 解析和系统文本视图排版，不能依赖短文本的高度估算。" }.joined(separator: "\n\n")
                self.snapshot.messages.append(NativeMessage(id: "large-report", role: "assistant", text: paragraphs + "\n\n报告末尾标记。", timestamp: Date().timeIntervalSince1970, phase: "final_answer"))
                self.publish()
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-approval-during-confirmation-fixture") {
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(6))
                guard let self else { return }
                self.snapshot.approvalCount = 1
                self.snapshot.approvalPanel = NativePanel(id: "approval:arriving-fixture", title: "操作审批", items: [
                    NativePanelItem(id: "approval-thread-id", kind: "text", text: "conversation-ui-thread"),
                    NativePanelItem(id: "allow-once", kind: "action", title: "仅允许这次", value: "\"accept\"", command: NativeCommand(name: "approval.decide", params: ["requestId": .string("arriving-fixture"), "decision": .string("accept")])),
                ])
                self.publish()
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-running-scroll-fixture"), !ProcessInfo.processInfo.arguments.contains("--agent-no-stream-fixture") {
            Task { [weak self] in
                for tick in 0..<300 {
                    try? await Task.sleep(for: .milliseconds(150))
                    guard !Task.isCancelled, let self,
                          let index = self.snapshot.messages.firstIndex(where: { $0.id == "streaming-scroll" }) else { return }
                    self.snapshot.messages[index].text += "\n运行中的持续输出第\(tick)行。"
                    self.publish()
                }
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-model-catalog-fixture") {
            Task { [weak self] in
                for tick in 0..<600 {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard let self else { return }
                    self.snapshot.tokenUsage = NativeTokenUsage(lastRequestTokens: Double(tick))
                    self.publish()
                }
            }
        }
    }

    private func publish() { store.receive(snapshot); session.receive(snapshot) }
    private func dispatch(_ command: NativeCommand) {
        if ProcessInfo.processInfo.arguments.contains(AgentSelectionQuotesFixture.argument), selectionQuotes.handle(command, snapshot: &snapshot) { publish(); return }

        if ProcessInfo.processInfo.arguments.contains("--agent-video-preview-fixture") {
            if command.name == "attachment.preview" {
                snapshot.panel = NativePanel(id: "attachment:preview-video", title: "preview.mp4", items: [
                    NativePanelItem(id: "draft-download", kind: "file", title: "preview.mp4", value: previewVideoSource),
                    NativePanelItem(id: "draft-content", kind: "video", title: "preview.mp4", value: previewVideoSource),
                ])
                publish()
                return
            }
            if command.name == "panel.close", case .string(let id) = command.params["id"] {
                // 扩大真实桥接关闭回执窗口，保证第二个sheet可被UI断言捕获。
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(3))
                    guard let self, self.snapshot.panel?.id == id else { return }
                    self.snapshot.panel = nil
                    self.snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: self.snapshot.contextId)]
                    self.publish()
                }
                return
            }
        }
        if command.name == "draft.set", ProcessInfo.processInfo.arguments.contains("--agent-attachment-menu-fixture") {
            if case .string(let text) = command.params["value"] { snapshot.draft = text; snapshot.canSend = !text.isEmpty || !snapshot.attachments.isEmpty }
            if case .number(let revision) = command.params["revision"] { snapshot.draftRevision = Int(revision) }
            let fieldKey: String? = { if case .string(let key) = command.params["fieldKey"] { return key }; return nil }()
            let revision: Int? = { if case .number(let value) = command.params["fieldRevision"] { return Int(value) }; return nil }()
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId, fieldKey: fieldKey, fieldRevision: revision)]
            publish()
        } else if command.name == "attachment.import", ProcessInfo.processInfo.arguments.contains("--agent-attachment-menu-fixture"), case .array(let items) = command.params["items"] {
            var accepted: [NativeAttachment] = []
            for (index, value) in items.enumerated() {
                guard case .object(let fields) = value, case .string(let name) = fields["name"], case .string(let type) = fields["type"], case .string(let data) = fields["data"] else { continue }
                accepted.append(NativeAttachment(id: command.id + "-" + String(index), name: name, imageURL: type.hasPrefix("image/") ? "data:" + type + ";base64," + data : nil, type: type, size: Data(base64Encoded: data)?.count))
            }
            let apply = { [weak self] in
                guard let self else { return }
                self.snapshot.attachments += accepted
                self.snapshot.canSend = !self.snapshot.attachments.isEmpty || !self.snapshot.draft.isEmpty
                self.snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: self.snapshot.contextId)]
                self.publish()
            }
            if ProcessInfo.processInfo.arguments.contains("--agent-delayed-attachment-import-fixture") {
                Task { try? await Task.sleep(for: .seconds(6)); guard !Task.isCancelled else { return }; apply() }
            } else { apply() }
        } else if command.name == "turn.stop", ProcessInfo.processInfo.arguments.contains("--agent-attachment-menu-fixture") {
            snapshot.busy = false
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "confirmation.answer" {
            let approved = command.params["confirmed"] == .bool(true)
            snapshot.panel = nil
            snapshot.messages = [NativeMessage(id: "confirmation-result", role: "assistant", text: approved ? "确认已执行" : "已取消", phase: "final_answer")]
            publish()
        } else if command.name == "project.toggle", case .string(let id) = command.params["id"],
           let index = snapshot.groups.firstIndex(where: { $0.id == id }) {
            snapshot.groups[index].collapsed = !(snapshot.groups[index].collapsed ?? false)
            publish()
        } else if command.name == "message.edit", ProcessInfo.processInfo.arguments.contains("--agent-edit-history-fixture") {
            snapshot.messages[0].historyEdit = NativePanel(id: "history-edit:question", title: "编辑消息", items: [
                NativePanelItem(id: "history-text", kind: "multilineField", value: snapshot.messages[0].text, command: NativeCommand(name: "history.change")),
                NativePanelItem(id: "cancel", kind: "action", title: "取消", command: NativeCommand(name: "history.cancel")),
                NativePanelItem(id: "submit", kind: "action", title: "保存并重发", command: NativeCommand(name: "history.submit")),
            ])
            publish()
        } else if command.name == "history.cancel" {
            snapshot.messages[0].historyEdit = nil; publish()
        } else if ProcessInfo.processInfo.arguments.contains("--agent-submit-fixture"), ["message.send", "turn.stop"].contains(command.name) {
            snapshot.busy = command.name == "message.send"
            snapshot.draft = ""; snapshot.canSend = false
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "thread.open", ProcessInfo.processInfo.arguments.contains("--agent-entry-transition-fixture"),
                  case .string(let thread) = command.params["threadId"] {
            snapshot.threadId = thread
            snapshot.contextId = "entry:" + thread
            snapshot.title = "会话进入回归"
            snapshot.messages = [NativeMessage(id: "entry-answer", role: "assistant", text: "会话进入标记。正文应当直接显示，不能继承侧栏的透明度转场。", phase: "final_answer")]
            snapshot.sidebarOpen = false
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "thread.manage", command.params["action"] == .string("refresh"),
                  ProcessInfo.processInfo.arguments.contains("--agent-running-history-fixture") {
            snapshot.busy = false
            for index in snapshot.messages.indices { snapshot.messages[index].commentaryIsRunning = false }
            snapshot.messages[2].status = "12秒"
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "thread.manage", command.params["action"] == .string("refresh"),
                  ProcessInfo.processInfo.arguments.contains("--agent-commentary-backfill-fixture"), let history = deferredCommentary {
            snapshot.messages.insert(history, at: 1)
            deferredCommentary = nil
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "navigation.refresh" {
            navigationRefreshCount += 1
            snapshot.error = "navigation-refresh-count:\(navigationRefreshCount)"
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if ["device.add", "device.cancel"].contains(command.name), ProcessInfo.processInfo.arguments.contains("--agent-no-devices-fixture") {
            // 只确认离线界面导航，不执行连接、保存或伪造网关成功。
            if command.name == "device.add" {
                snapshot.panel = NativePanel(id: "devices", title: "设备", items: ["name", "gatewayUrl"].map { field in
                    NativePanelItem(id: field, kind: "input", value: "", command: NativeCommand(name: "device.change", params: ["field": .string(field), "draftId": .string(command.id)]))
                })
            } else { snapshot.panel = nil }
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if ["navigation.sidebar", "navigation.search", "settings.open"].contains(command.name) {
            if case .bool(let open) = command.params["open"], command.name == "navigation.sidebar" { snapshot.sidebarOpen = open }
            if case .string(let text) = command.params["value"], command.name == "navigation.search" { snapshot.search = text }
            let fieldKey: String? = { if case .string(let key) = command.params["fieldKey"] { return key }; return nil }()
            let revision: Int? = { if case .number(let value) = command.params["fieldRevision"] { return Int(value) }; return nil }()
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId, fieldKey: fieldKey, fieldRevision: revision)]
            publish()
        } else if ["effort.select", "model.select", "speed.select", "permission.select"].contains(command.name), case .string(let value) = command.params["value"] {
            if command.name == "permission.select" { snapshot.permissionValue = value }
            else if command.name == "effort.select" { snapshot.effortValue = value }
            else if command.name == "speed.select" { snapshot.speedValue = value }
            else {
                snapshot.modelValue = value
                if let model = snapshot.models.first(where: { $0.value == value }), let efforts = model.efforts {
                    snapshot.efforts = efforts; snapshot.effortValue = model.defaultEffort ?? efforts.first?.value ?? ""
                }
            }
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "newchat.project", ProcessInfo.processInfo.arguments.contains("--agent-project-name-fixture") {
            if case .string(let path) = command.params["value"] { snapshot.cwd = path }
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
            publish()
        } else if command.name == "thread.older" {
            historyRequestCount += 1
            snapshot.olderTurnsState = "loading"
            if snapshot.conversationActions?.isEmpty == false { snapshot.conversationActions?[0].disabled = true }
            publish()
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(120))
                guard let self else { return }
                if ProcessInfo.processInfo.arguments.contains("--agent-conversation-reset-context"), self.historyRequestCount == 1 {
                    self.snapshot.contextId = "conversation-ui-reopened"
                    self.snapshot.olderTurnsState = "idle"
                    self.snapshot.conversationActions?[0].disabled = false
                    self.publish()
                    return
                }
                // 分页归并回合会改变 wire ID；稳定锚点仍指向同一原始条目。
                self.snapshot.messages = self.snapshot.messages.map { message in
                    var regrouped = message
                    regrouped.id = "regrouped:" + message.id
                    return regrouped
                }
                self.snapshot.messages.insert(contentsOf: (1...4).map { index in
                    NativeMessage(id: "older-\(index)", role: "assistant", text: "更早消息 \(index)\n本页由真实 thread.older 命令入口触发的 UI 夹具提供。")
                }, at: 0)
                self.snapshot.olderTurnsState = "exhausted"
                self.snapshot.conversationActions = []
                self.snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: self.snapshot.contextId)]
                self.publish()
            }
        } else {
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: false, contextId: snapshot.contextId, error: "此界面夹具不执行真实业务")]
            publish()
        }
    }
}

/// 只在显式进入回归夹具内采样实际显示图层，捕获页面插入时的透明度转场。
struct AgentEntryAnimationProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> ProbeView { ProbeView() }
    func updateUIView(_ view: ProbeView, context: Context) {}
    static func dismantleUIView(_ view: ProbeView, coordinator: ()) { view.stop() }
    final class ProbeView: UIView {
        private var link: CADisplayLink?
        private var frames = 0
        private var faded = false
        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            accessibilityIdentifier = "entry.animation"
            accessibilityValue = "sampling"
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            stop()
            guard window != nil else { return }
            frames = 0
            accessibilityValue = faded ? "fading" : "sampling"
            let link = CADisplayLink(target: self, selector: #selector(tick))
            self.link = link
            link.add(to: .main, forMode: .common)
        }
        func stop() { link?.invalidate(); link = nil }
        @objc private func tick() {
            frames += 1
            var current: CALayer? = layer
            while let value = current {
                let opacity = value.presentation()?.opacity ?? value.opacity
                if opacity > 0.01 && opacity < 0.99 { faded = true; accessibilityValue = "fading" }
                current = value.superlayer
            }
            if frames >= 45 {
                if !faded { accessibilityValue = "none" }
                stop()
            }
        }
    }
}
struct AgentTypographyFixture: ViewModifier {
    @Environment(\.dynamicTypeSize) private var size
    @Environment(\.legibilityWeight) private var weight
    func body(content: Content) -> some View {
        let enabled = ProcessInfo.processInfo.arguments.contains("--agent-typography-fixture")
        content.environment(\.dynamicTypeSize, enabled ? .xxxLarge : size)
            .environment(\.legibilityWeight, enabled ? .bold : weight)
    }
}
/// 显式布局回归参数下记录真实表面范围，避免辅助功能容器只返回子控件并集。
struct AgentComposerGeometryFixture: ViewModifier {
    @Environment(\.accessibilityShowBorders) private var showBorders
    @State private var frame = CGRect.zero
    func body(content: Content) -> some View {
        if ProcessInfo.processInfo.arguments.contains("--agent-composer-geometry-fixture") {
            content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
                .overlay(alignment: .topLeading) {
                    Text("\(frame.minX),\(frame.minY),\(frame.width),\(frame.height)")
                        .font(.system(size: 1)).opacity(0.01).allowsHitTesting(false)
                        .accessibilityIdentifier("composer.geometry")
                        .accessibilityValue(showBorders ? "on" : "off")
                }
        } else { content }
    }
}
#endif
