import Foundation

enum UserMessageText {
    /// 只收掉末尾空白行，原消息仍用于复制与历史编辑。
    static func visible(_ text: String) -> String {
        guard let trailingLines = text.range(of: #"\R[\s]*$"#, options: .regularExpression) else { return text }
        return String(text[..<trailingLines.lowerBound])
    }
}
