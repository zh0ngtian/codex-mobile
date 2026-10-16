import Foundation
import SwiftUI

enum NativeInlineMarkdown {
    static func text(_ value: String, scope: NativeMarkdownHTMLScope = .init()) -> AttributedString {
        let prepared = NativeMarkdownDisplaySource(value, scope: scope)
        var text = (try? AttributedString(markdown: prepared.markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(prepared.markdown)
        prepared.restore(&text)
        for run in text.runs where run.link != nil {
            text[run.range].underlineStyle = .init(pattern: .dash)
        }
        return text
    }
}
