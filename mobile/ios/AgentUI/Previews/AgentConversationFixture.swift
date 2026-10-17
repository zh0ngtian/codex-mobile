#if DEBUG
import Foundation
import Observation

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
        value.olderTurnsState = "idle"
        value.conversationActions = [NativePanelItem(id: "older", kind: "action", title: "加载更早消息", command: NativeCommand(name: "thread.older"))]
        let history = NativeMessage(id: "history", role: "activity", text: "", blocks: [NativePanelItem(id: "history-block", kind: "disclosure", title: "历史过程 (2)")], turnId: "fixture-turn", commentary: entries, commentaryBlockId: "history-block", commentaryCanAttachToReply: true)
        value.messages = [
            NativeMessage(id: "question", role: "user", text: "请检查项目上下文。\n\n", turnId: "fixture-turn"),
            history,
            NativeMessage(id: "answer", role: "assistant", text: "已完成检查。查看 [网页链接](https://example.com) 与 [文件链接](/tmp/example.swift#L12)。", turnId: "fixture-turn", phase: "final_answer"),
        ]
        if ProcessInfo.processInfo.arguments.contains("--agent-conversation-long-fixture") {
            value.messages += (1...14).map { index in
                NativeMessage(id: "long-\(index)", role: "assistant", text: "阅读位置 \(index)\n用于验证再次下拉时加载旧消息，并保持原有阅读位置。\n重复正文只在独立的界面回归夹具中出现。")
            }
        }
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
        if command.name == "thread.older" {
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
#endif
