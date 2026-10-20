#if DEBUG
import Foundation

/// 仅负责系统选文菜单到真实Composer视图的UI夹具；不连接网关，不作为协议验收。
@MainActor final class AgentSelectionQuotesFixture {
    static let argument = "--agent-selection-quotes-fixture"
    private var main: NativeSnapshot?
    private var side: NativeSnapshot?
    func configure(_ snapshot: inout NativeSnapshot) {
        snapshot.title = "选文引用界面夹具"
        snapshot.draft = "已有问题"; snapshot.canSend = true
        snapshot.attachments = [NativeAttachment(id: "selection-file", name: "example.txt", type: "text/plain", size: 4)]
        snapshot.quotes = []
        let source = NativeQuoteSource(backendId: snapshot.backendId!, threadId: snapshot.threadId!, turnId: "selection-turn", itemId: "selection-answer", region: "body", revision: "fixture-v1")
        var user = source; user.itemId = "selection-user"; user.region = "user"
        var commentary = source; commentary.itemId = "selection-commentary"; commentary.region = "commentary"
        snapshot.messages = [
            NativeMessage(id: "selection-user", role: "user", text: "这是用户消息中的可选文字。", quoteSource: user),
            NativeMessage(id: "selection-answer", role: "assistant", text: "这段文字用于选文引用验收。\n\n第二段包含重复内容，重复内容。 😀！？\n\n查看 [网页链接](https://example.com) 与 **重点**。\n\n```swift\nlet answer = 42\n```\n\n| 项目 | 数值 |\n| --- | --- |\n| 引用 | 2 |", quoteSource: source, commentary: [NativeCommentaryEntry(id: "selection-commentary", text: "执行过程里的可选文字。", quoteSource: commentary)])
        ]
    }
    func handle(_ command: NativeCommand, snapshot: inout NativeSnapshot) -> Bool {
        var ok = true
        switch command.name {
        case "message.quote", "sidechat.quote":
            guard command.params["contextId"] == snapshot.contextId.map(NativeJSONValue.string),
                  case .object(let sourceObject) = command.params["source"],
                  let data = try? JSONEncoder().encode(NativeJSONValue.object(sourceObject)), let source = try? JSONDecoder().decode(NativeQuoteSource.self, from: data),
                  case .string(let text) = command.params["text"], !text.isEmpty else { return false }
            let quote = NativeMessageQuote(id: UUID().uuidString, source: source, text: text)
            if command.name == "sidechat.quote" {
                if snapshot.sidechatActive == true { ok = false; break }
                main = snapshot
                snapshot.threadId = "selection-ui-side"; snapshot.contextId = "selection-ui-side-context"; snapshot.title = "Sidechat 1"
                snapshot.sidechatActive = true; snapshot.sidechatParentId = main?.threadId; snapshot.messages = []; snapshot.draft = ""; snapshot.attachments = []; snapshot.canSend = false
                snapshot.sidechatActions = [NativePanelItem(id: "selection-return", kind: "action", title: "返回主聊天", command: NativeCommand(name: "sidechat.return"))]
                snapshot.quotes = [quote]
            } else { snapshot.quotes = (snapshot.quotes ?? []) + [quote] }
            snapshot.quoteFocusToken = UUID().uuidString
        case "quote.remove":
            if case .string(let id) = command.params["id"] { snapshot.quotes?.removeAll { $0.id == id } }
        case "draft.set":
            if case .string(let text) = command.params["value"] { snapshot.draft = text; snapshot.canSend = !text.isEmpty || !snapshot.attachments.isEmpty }
            if case .number(let revision) = command.params["revision"] { snapshot.draftRevision = Int(revision) }
        case "sidechat.return":
            guard let saved = main else { return false }; side = snapshot; snapshot = saved
        case "sidechat.open":
            guard let saved = side else { return false }; main = snapshot; snapshot = saved
        case "message.send":
            snapshot.quotes = []; snapshot.draft = ""; snapshot.attachments = []; snapshot.canSend = false
        default: return false
        }
        let key: String? = { if case .string(let key) = command.params["fieldKey"] { return key }; return nil }()
        let revision: Int? = { if case .number(let value) = command.params["fieldRevision"] { return Int(value) }; return nil }()
        snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: ok, contextId: snapshot.contextId, fieldKey: key, fieldRevision: revision)]
        return true
    }
}
#endif
