import SwiftUI

struct NativeInlineContentView: View {
    let text: String
    let store: NativeUIStore?
    var compact = false
    var scope = NativeMarkdownHTMLScope()
    var textStyle: UIFont.TextStyle = .body
    var strong = false
    @State private var parts: [NativeMarkdownInlinePart] = []
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parts) { part in
                if let source = part.destination { NativeMarkdownImageView(source: source, title: part.text, store: store) }
                else {
                    NativeSelectableText(text: NativeSelectableMarkdown.inline(part.text, scope: part.scope, font: .preferredFont(forTextStyle: textStyle), strong: strong),
                                         identifier: "markdown.selectable", openLink: { openURL($0) })
                        .frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
                }
            }
        }.task(id: scope.identity + [text]) { parts = NativeMarkdownInlinePart.parse(text, scope: scope) }
    }
}
