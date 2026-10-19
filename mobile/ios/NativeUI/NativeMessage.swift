import Foundation

struct NativeMessage: Codable, Identifiable {
    var id: String
    var role: String
    var text: String
    var rawText: String? = nil
    var references: [NativeMessageReference]? = nil
    var status: String? = nil
    var blocks: [NativePanelItem]? = nil
    var actions: [NativePanelItem]? = nil
    var timestamp: Double? = nil
    var historyEdit: NativePanel? = nil
    var turnId: String? = nil
    var itemId: String? = nil
    var phase: String? = nil
    var quoteSource: NativeQuoteSource? = nil
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
    var quoteSource: NativeQuoteSource? = nil
}


struct NativeQuoteSource: Codable, Equatable, Hashable, Sendable {
    var backendId: String
    var threadId: String
    var turnId: String
    var itemId: String
    var region: String
    var revision: String
    var params: [String: NativeJSONValue] {
        ["backendId": .string(backendId), "threadId": .string(threadId), "turnId": .string(turnId), "itemId": .string(itemId), "region": .string(region), "revision": .string(revision)]
    }
    func label(english: Bool) -> String {
        switch region { case "user": english ? "User message" : "用户消息"; case "commentary": english ? "Execution details" : "执行过程"; case "code": english ? "Code" : "代码"; case "table": english ? "Table" : "表格"; default: english ? "Assistant message" : "助手消息" }
    }
}
struct NativeMessageQuote: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var source: NativeQuoteSource
    var text: String
}
/// TextKit 的范围始终基于实际显示文字，UTF-16偏移不会被当成Markdown源码偏移。
struct NativeQuoteSelection {
    var source: NativeQuoteSource
    var renderedText: String
    var range: NSRange
    func params(contextID: String) -> [String: NativeJSONValue]? {
        let value = renderedText as NSString
        guard range.location != NSNotFound, range.location >= 0, range.length > 0, range.location <= value.length, range.length <= value.length - range.location else { return nil }
        let selected = value.substring(with: range)
        guard !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return ["contextId": .string(contextID), "source": .object(source.params), "renderedText": .string(renderedText), "start": .number(Double(range.location)), "end": .number(Double(NSMaxRange(range))), "text": .string(selected)]
    }
}

struct NativeMessageReference: Codable, Identifiable, Equatable, Hashable, Sendable {
    var text: String
    var annotation: String? = nil
    var source: Source? = nil
    var id: String { text + "|" + (annotation ?? "") + "|" + (source?.messageId ?? "") }
    struct Source: Codable, Equatable, Hashable, Sendable {
        var messageId: String
        var startOffset: Int
        var endOffset: Int
    }
}
