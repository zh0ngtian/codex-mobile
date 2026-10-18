import Foundation

/// 首次参与列表布局时正文已解析，避免异步任务让长消息先以零高度定位。
/// 有界缓存复用同一正文；流式文本变化会按新内容重新解析。
@MainActor enum NativeMarkdownDocumentCache {
    private final class Document: NSObject {
        let blocks: [NativeMarkdownBlock]
        init(_ text: String) { blocks = NativeMarkdownBlock.parse(text) }
    }
    private static let cache: NSCache<NSString, Document> = {
        let value = NSCache<NSString, Document>()
        value.countLimit = 32
        value.totalCostLimit = 8 * 1024 * 1024
        return value
    }()
    static func blocks(for text: String) -> [NativeMarkdownBlock] {
        let key = text as NSString
        if let existing = cache.object(forKey: key) { return existing.blocks }
        let document = Document(text)
        cache.setObject(document, forKey: key, cost: text.utf8.count * 4 + document.blocks.count * 256)
        return document.blocks
    }
}
