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
        value.olderTurnsState = "idle"
        value.conversationActions = [NativePanelItem(id: "older", kind: "action", title: "加载更早消息", command: NativeCommand(name: "thread.older"))]
        let history = NativeMessage(id: "history", role: "activity", text: "", blocks: [NativePanelItem(id: "history-block", kind: "disclosure", title: "历史过程 (2)")], turnId: "fixture-turn", commentary: entries, commentaryBlockId: "history-block", commentaryCanAttachToReply: true)
        value.messages = [
            NativeMessage(id: "question", role: "user", text: "请检查项目上下文。\n\n", timestamp: date.addingTimeInterval(-60).timeIntervalSince1970, turnId: "fixture-turn"),
            history,
            NativeMessage(id: "answer", role: "assistant", text: "已完成检查。查看 [网页链接](https://example.com) 与 [文件链接](/tmp/example.swift#L12)。", timestamp: date.addingTimeInterval(120).timeIntervalSince1970, turnId: "fixture-turn", phase: "final_answer"),
        ]
        value.messages[2].status = "用时 1 小时 2 分钟 3 秒"
        if ProcessInfo.processInfo.arguments.contains("--agent-short-question-fixture") { value.messages[0].text = "好" }
        if ProcessInfo.processInfo.arguments.contains("--agent-sidebar-polish-fixture") {
            value.messages[0].text = String(repeating: "短行\n", count: 6) + "这是一条展开后才显示的较长正文，用于确认消息气泡在展开更多和收起时保持同样的宽度。"
            value.groups = [("z", "Zeta"), ("a", "Alpha"), ("m", "Middle")].map { key, title in
                let item = NativeNavigationItem(id: "row-" + key, title: "任务 " + title,
                    command: NativeCommand(name: "thread.open", params: ["backendId": .string("conversation-ui-device"), "threadId": .string("thread-" + key)]),
                    isUnread: key == "a", running: key == "z")
                return NativeGroup(id: "project-" + key, title: title, items: [item], collapsed: false, category: "project", cwd: "/" + title)
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-conversation-long-fixture") {
            value.messages += (1...14).map { index in
                NativeMessage(id: "long-\(index)", role: "assistant", text: "阅读位置 \(index)\n用于验证再次下拉时加载旧消息，并保持原有阅读位置。\n重复正文只在独立的界面回归夹具中出现。")
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--agent-preview-polish-fixture") {
            value.messages[0].text = String(repeating: "短行\n", count: 6) + "展开后的正文仅用于核对强调色，完整文字不会改变气泡的宽度。"
            let image = UIImage(systemName: "photo")!.withTintColor(.gray, renderingMode: .alwaysOriginal).pngData()!
            let html = Data("<html><body style='font: -apple-system-body'>Neutral preview file</body></html>".utf8)
            value.messages.append(NativeMessage(id: "preview-assets", role: "assistant", text: "预览附件", blocks: [
                NativePanelItem(id: "preview-image", kind: "image", title: "preview.png", value: "data:image/png;base64," + image.base64EncodedString()),
                NativePanelItem(id: "preview-file", kind: "html", title: "preview.html", value: "data:text/html;base64," + html.base64EncodedString()),
            ]))
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
        if ProcessInfo.processInfo.arguments.contains("--agent-startup-loading-fixture") { value.ready = false }
        value.messages = value.messages.map { message in
            var anchored = message
            anchored.scrollAnchorId = message.id
            return anchored
        }
        snapshot = value
        store.sendCommand = { [weak self] command in self?.dispatch(command) }
        publish()
    }

    private func publish() { store.receive(snapshot); session.receive(snapshot) }
    private func dispatch(_ command: NativeCommand) {
        if ["effort.select", "model.select"].contains(command.name), case .string(let value) = command.params["value"] {
            if command.name == "effort.select" { snapshot.effortValue = value }
            else { snapshot.modelValue = value }
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
#endif
