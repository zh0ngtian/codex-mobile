import SwiftUI

struct NativeMarkdownBlockView: View {
    let block: NativeMarkdownBlock
    var scale: Double
    var store: NativeUIStore?
    var compact = false
    var weight: Font.Weight = .medium
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    var body: some View {
        Group {
            switch block.kind {
            case .heading:
                Text(NativeInlineMarkdown.text(block.text, scope: block.scope))
                    .font(.system(size: bodySize * headingScale * scale, weight: .bold))
                    .accessibilityAddTraits(.isHeader)
            case .list:
                HStack(alignment: .top, spacing: 8) {
                    Group {
                        if let checked = block.checked {
                            Image(systemName: checked ? "checkmark.square" : "square")
                                .accessibilityLabel(label(checked ? "已完成" : "未完成", checked ? "Completed" : "Incomplete"))
                        } else {
                            Text(block.marker)
                                .font(.system(size: bodySize * (block.marker == "•" ? 20.0 / 14.0 : 1) * scale, weight: weight))
                                .accessibilityHidden(true)
                        }
                    }.frame(width: 16, height: effectiveBodySize * scale * 1.25)
                    NativeInlineContentView(text: block.text, store: store, compact: compact, scope: block.scope).frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
                }.padding(.leading, CGFloat(block.depth) * 16)
            case .code:
                if block.language.lowercased() == "mermaid", let resource = store?.snapshot.richContent?.first(where: { $0.kind == "html" && $0.text == block.text }), let html = resource.value {
                    NativeHTMLContentView(html: html, title: "Mermaid")
                } else {
                    NativeCodeView(text: block.text, language: block.language, scale: scale)
                    if block.language.lowercased() == "mermaid", let store {
                        Button(label("预览图表", "Preview Diagram")) { store.command("diagram.render", ["source": .string(block.text)]) }
                    }
                }
            case .quote:
                HStack(alignment: .top, spacing: 12) {
                    RoundedRectangle(cornerRadius: 2).fill(.secondary.opacity(0.3)).frame(width: 3)
                    NativeInlineContentView(text: block.text, store: store, compact: compact, scope: block.scope).foregroundStyle(.secondary).frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
                }.fixedSize(horizontal: false, vertical: true)
            case .rule: Divider().padding(.vertical, 4)
            case .table: NativeMarkdownTableView(rows: block.rows, scale: scale, store: store, cellScopes: block.cellScopes)
            case .image:
                if let destination = block.destination { NativeMarkdownImageView(source: destination, title: block.text, store: store) }
            case .text:
                NativeInlineContentView(text: block.text, store: store, compact: compact, scope: block.scope).frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
            }
        }.font(.system(size: effectiveBodySize * scale, weight: weight))
    }
    private var effectiveBodySize: Double { bodySize * (compact ? 1 : 14.5 / 14) }
    private var headingScale: Double {
        switch block.level {
        case 1: 24.0 / 14.0
        case 2: 20.0 / 14.0
        case 3: 18.0 / 14.0
        default: 16.0 / 14.0
        }
    }
    private func label(_ chinese: String, _ english: String) -> String { store?.label(chinese, english) ?? chinese }
}
