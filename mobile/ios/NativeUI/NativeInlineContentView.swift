import SwiftUI

struct NativeInlineContentView: View {
    let text: String
    let store: NativeUIStore?
    var compact = false
    @State private var parts: [NativeMarkdownInlinePart] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parts) { part in
                if let source = part.destination { NativeMarkdownImageView(source: source, title: part.text, store: store) }
                else { Text(NativeInlineMarkdown.text(part.text)).lineSpacing(5).frame(maxWidth: compact ? nil : .infinity, alignment: .leading) }
            }
        }.task(id: text) { parts = NativeMarkdownInlinePart.parse(text) }
    }
}
