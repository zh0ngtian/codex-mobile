import Foundation

@main struct AgentConversationIDSmoke {
    static func main() {
        let presentationID = UUID()
        let firstID = "thread:opaque/backend-a:abc"
        let secondID = "thread:opaque/backend-b:def"
        let identities = [presentationID: firstID]
        var clipboard = "原剪贴板"
        precondition(ConversationIDClipboard.copy(identities[presentationID], write: { clipboard = $0 }))
        precondition(clipboard == firstID && clipboard != presentationID.uuidString, "复制必须保留网关原始ID，不能泄漏呈现层UUID")
        precondition(ConversationIDClipboard.copy(secondID, write: { clipboard = $0 }) && clipboard == secondID, "跨设备原始ID不能复用其他映射")
        let before = clipboard
        precondition(!ConversationIDClipboard.copy(nil, write: { clipboard = $0 }))
        precondition(!ConversationIDClipboard.copy("", write: { clipboard = $0 }))
        precondition(clipboard == before, "没有真实ID时必须保留剪贴板并返回失败")
        print("Agent conversation ID smoke passed")
    }
}
