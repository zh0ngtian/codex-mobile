import Foundation

/// 仅离线 UI 验收使用；正式历史编辑仍由现有 JS 业务拥有者驱动。
enum NativeHistoryEditReference {
    static let editKey = "history:turn:message"
    static let messageID = "turn:message"
    static func snapshot(fails: Bool) -> NativeSnapshot {
        var value = NativeSnapshot()
        value.ready = true; value.connection = "online"; value.locale = "zh-CN"
        value.contextId = "history-reference-context"; value.threadId = fails ? "history-reference-failure" : "history-reference"
        value.title = "历史消息原位编辑验收"; value.draft = "普通输入草稿"; value.canSend = true
        value.messages = [NativeMessage(id: messageID, role: "user", text: "原消息", blocks: [NativePanelItem(id: "attachment", kind: "file", title: "original.txt", text: "原消息附件")], actions: [action("edit", "编辑", "message.edit")]), NativeMessage(id: "later", role: "assistant", text: "后续对话仍在原位置")]
        return value
    }
    private static func action(_ id: String, _ title: String, _ name: String, confirmed: Bool = false) -> NativePanelItem {
        NativePanelItem(id: id, kind: "action", title: title, command: NativeCommand(name: name, params: ["editKey": .string(editKey), "turnId": .string("turn"), "messageId": .string("message"), "contextId": .string("history-reference-context"), "confirmed": .bool(confirmed)]))
    }
    private static func editor(_ text: String) -> NativePanel {
        var field = action("history-text", "消息", "history.change")
        field.kind = "multilineField"; field.value = text
        return NativePanel(id: "history-edit:\(editKey)", title: "编辑历史消息", items: [field, NativePanelItem(id: "history-attachments", kind: "text", title: "原消息的 1 个附件会保留"), action("history-submit", "保存并重新发送", "history.submit"), action("history-cancel", "取消", "history.cancel")])
    }
    @MainActor static func handle(_ name: String, params: [String: NativeJSONValue], snapshot: inout NativeSnapshot, error: inout String?) -> Bool {
        guard snapshot.threadId?.hasPrefix("history-reference") == true else { return false }
        guard let index = snapshot.messages.firstIndex(where: { $0.id == messageID }) else { return false }
        switch name {
        case "message.edit": snapshot.messages[index].historyEdit = editor(snapshot.messages[index].text)
        case "history.change":
            if case .string(let value) = params["value"] { snapshot.messages[index].historyEdit = editor(value) }
        case "history.cancel": snapshot.messages[index].historyEdit = nil; snapshot.panel = nil
        case "history.submit":
            guard let value = snapshot.messages[index].historyEdit?.items.first?.value else { return true }
            if params["confirmed"] != .bool(true) {
                snapshot.panel = NativePanel(id: "confirm-history:\(editKey)", title: "确认修改历史消息", items: [NativePanelItem(id: "warning", kind: "text", title: "修改并重新发送将删除此消息之后的对话"), action("history-confirm", "确认并发送", "history.submit", confirmed: true)])
            } else {
                snapshot.panel = nil
                if snapshot.threadId == "history-reference-failure" { error = "发送失败，请重试" }
                else { snapshot.messages[index].text = value; snapshot.messages[index].historyEdit = nil; snapshot.messages.removeAll { $0.id == "later" } }
            }
        case "panel.close": snapshot.panel = nil
        default: return false
        }
        return true
    }
}
