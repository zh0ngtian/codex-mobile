import SwiftUI

struct NativeInlineContentView: View {
    let text: String
    let store: NativeUIStore?
    var compact = false
    var scope = NativeMarkdownHTMLScope()
    @State private var parts: [NativeMarkdownInlinePart] = []
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parts) { part in
                if let source = part.destination { NativeMarkdownImageView(source: source, title: part.text, store: store) }
                else { Text(styled(part)).lineSpacing(5).frame(maxWidth: compact ? nil : .infinity, alignment: .leading) }
            }
        }.task(id: scope.identity + [text]) { parts = NativeMarkdownInlinePart.parse(text, scope: scope) }
    }
    private var effectiveBodySize: Double { bodySize * (compact ? 1 : 14.5 / 14) }
    private func styled(_ part: NativeMarkdownInlinePart) -> AttributedString {
        var value = NativeInlineMarkdown.text(part.text, scope: part.scope)
        for run in value.runs {
            let intent = run.inlinePresentationIntent ?? []
            if intent.contains(.stronglyEmphasized) {
                value[run.range].font = .system(size: effectiveBodySize * (store?.snapshot.fontScale ?? 1), weight: .bold)
            }
            if intent.contains(.code) {
                value[run.range].font = .system(size: effectiveBodySize * (store?.snapshot.fontScale ?? 1), design: .monospaced)
                value[run.range].foregroundColor = .secondary
            }
            if run.link != nil {
                value[run.range].foregroundColor = .primary
                value[run.range].underlineStyle = .single
            }
        }
        return value
    }

}
