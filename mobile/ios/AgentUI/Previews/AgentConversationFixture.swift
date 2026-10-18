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
    private let store: NativeUIStore
    private let session: AppSession
    private var snapshot: NativeSnapshot

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
        if ProcessInfo.processInfo.arguments.contains("--agent-fast-fixture") {
            value.speeds = [NativeOption(id: "normal", title: "普通速度", value: ""), NativeOption(id: "fast", title: "Fast", value: "priority")]
            value.speedValue = ""
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
        if ProcessInfo.processInfo.arguments.contains("--agent-many-devices-fixture") {
            value.backends += (1...11).map { NativeBackend(id: "extra-device-\($0)", title: "额外设备 \($0)", connected: true) }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-steering-status-fixture") {
            value.messages.append(NativeMessage(id: "pending-steer", role: "activity", text: "正在引导的消息", status: "正在引导"))
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-edit-history-fixture") {
            value.messages[0].actions = [NativePanelItem(id: "edit", kind: "action", title: "编辑", command: NativeCommand(name: "message.edit", params: ["id": .string("question")]))]
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
        if ProcessInfo.processInfo.arguments.contains("--agent-confirmation-controls-fixture") {
            value.panel = NativePanel(id: "confirmation:workspace:fixture:1", title: "确认操作", items: [
                NativePanelItem(id: "confirmation-yes", kind: "action", title: "确认", text: "归档后，此会话将从列表中移除。确定归档吗？", command: NativeCommand(name: "confirmation.answer", params: ["key": .string("confirmation:workspace:fixture:1"), "confirmed": .bool(true)])),
                NativePanelItem(id: "confirmation-no", kind: "action", title: "取消", command: NativeCommand(name: "confirmation.answer", params: ["key": .string("confirmation:workspace:fixture:1"), "confirmed": .bool(false)])),
            ])
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-short-question-fixture") { value.messages[0].text = "好" }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-polish-fixture") {
            value.messages[0].text = String(repeating: "短行\n", count: 14) + "这是一条展开后才显示的较长正文，用于确认消息气泡在展开更多和收起时保持同样的宽度。"
            value.groups = [("z", "Zeta"), ("a", "Alpha"), ("m", "Middle")].map { key, title in
                let item = NativeNavigationItem(id: "row-" + key, title: "任务 " + title,
                    command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("thread-" + key)]),
                    isUnread: key == "a", running: key == "z")
                return NativeGroup(id: "project-" + key, title: title, items: [item], command: NativeCommand(name: "project.toggle", params: ["id": .string("project-" + key)]), collapsed: false, category: "project", cwd: "/" + title)
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-polish-fixture") {
            value.groups.insert(NativeGroup(id: "fixture-pinned", title: "", items: [NativeNavigationItem(
                id: "pinned-fixture", title: "关注的会话", command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("conversation-ui-thread")]), isPinned: true)], category: "pinned"), at: 0)
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-conversation-long-fixture") {
            value.messages += (1...14).map { index in
                NativeMessage(id: "long-\(index)", role: "assistant", text: "阅读位置 \(index)\n用于验证再次下拉时加载旧消息，并保持原有阅读位置。\n重复正文只在独立的界面回归夹具中出现。")
            }
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
        if ProcessInfo.processInfo.arguments.contains("--agent-submit-fixture") { value.canSend = true; value.draft = "触感检查" }
        if ProcessInfo.processInfo.arguments.contains("--agent-startup-loading-fixture") { value.ready = false }
        value.messages = value.messages.map { message in
            var anchored = message
            anchored.scrollAnchorId = message.id
            return anchored
        }
        let deferredMessages = value.messages
        if ProcessInfo.processInfo.arguments.contains("--agent-delayed-report-fixture") { value.messages = []; value.loading = "loading" }
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
        } else if ["navigation.sidebar", "navigation.search", "settings.open"].contains(command.name) {
            if case .bool(let open) = command.params["open"], command.name == "navigation.sidebar" { snapshot.sidebarOpen = open }
            if case .string(let text) = command.params["value"], command.name == "navigation.search" { snapshot.search = text }
            let fieldKey: String? = { if case .string(let key) = command.params["fieldKey"] { return key }; return nil }()
            let revision: Int? = { if case .number(let value) = command.params["fieldRevision"] { return Int(value) }; return nil }()
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId, fieldKey: fieldKey, fieldRevision: revision)]
            publish()
        } else if ["effort.select", "model.select", "speed.select"].contains(command.name), case .string(let value) = command.params["value"] {
            if command.name == "effort.select" { snapshot.effortValue = value }
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
