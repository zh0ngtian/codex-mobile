import Foundation

struct NativeMessage: Codable, Identifiable {
    var id: String
    var role: String
    var text: String
    var status: String? = nil
    var blocks: [NativePanelItem]? = nil
    var actions: [NativePanelItem]? = nil
    var timestamp: Double? = nil
    var historyEdit: NativePanel? = nil
    var turnId: String? = nil
    var itemId: String? = nil
    var phase: String? = nil
    var commentary: [NativeCommentaryEntry]? = nil
    var commentaryBlockId: String? = nil
    var commentaryCanAttachToReply: Bool? = nil
    var commentaryIsLiveTail: Bool? = nil
    var scrollAnchorId: String? = nil
    var scrollAnchorIds: [String]? = nil
    var activityKind: String? = nil
    var hidesExecutionActivity: Bool { ["tool", "reasoning", "plan"].contains(activityKind ?? "") }

    /// 仅替换有明确语义对应的旧历史区块；同消息里的其他工具或推理仍保留。
    var presentationBlocks: [NativePanelItem] {
        (blocks ?? []).filter { block in
            if role == "assistant", phase == "commentary", block.kind == "text", block.id == id + ":timestamp" { return false }
            return !(commentary?.isEmpty == false && block.id == commentaryBlockId)
        }
    }
}

struct NativeCommentaryEntry: Codable, Identifiable {
    var id: String
    var text: String
    var timestamp: Double? = nil
    var blocks: [NativePanelItem]? = nil
    var isPreviousReply: Bool? = nil
}
