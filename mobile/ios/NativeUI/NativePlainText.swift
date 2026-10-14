import Foundation

enum NativePlainText {
    static func message(_ source: String, role: String) -> String {
        guard role != "user" else { return source }
        return NativeMarkdownBlock.parse(source).map { block in
            if block.kind == .code { return block.text }
            guard let text = try? AttributedString(markdown: block.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return block.text }
            return String(text.characters)
        }.joined(separator: "\n\n")
    }
}
