import Foundation

enum NativeInlineMarkdown {
    static func text(_ value: String, scope: NativeMarkdownHTMLScope = .init()) -> AttributedString {
        let prepared = NativeMarkdownDisplaySource(value, scope: scope)
        var text = (try? AttributedString(markdown: prepared.markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(prepared.markdown)
        prepared.restore(&text)
        return text
    }
}
