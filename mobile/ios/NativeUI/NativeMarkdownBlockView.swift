import SwiftUI

struct NativeMarkdownBlockView: View {
    let block: NativeMarkdownBlock
    var scale: Double
    var store: NativeUIStore?
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    var body: some View {
        Group {
            switch block.kind {
            case .heading:
                Text(NativeInlineMarkdown.text(block.text))
                    .font(.system(size: bodySize * headingScale * scale, weight: .bold))
                    .accessibilityAddTraits(.isHeader)
            case .list:
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let checked = block.checked {
                        Image(systemName: checked ? "checkmark.square" : "square")
                            .accessibilityLabel(label(checked ? "已完成" : "未完成", checked ? "Completed" : "Incomplete"))
                    } else { Text(block.marker).accessibilityHidden(true) }
                    Text(NativeInlineMarkdown.text(block.text)).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading)
                }.padding(.leading, CGFloat(block.depth) * 12)
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
                    Text(NativeInlineMarkdown.text(block.text)).lineSpacing(5).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                }.fixedSize(horizontal: false, vertical: true)
            case .rule: Divider().padding(.vertical, 4)
            case .table: NativeMarkdownTableView(rows: block.rows, scale: scale)
            case .image:
                if let destination = block.destination {
                    if let resource = store?.snapshot.richContent?.first(where: { $0.kind == "image" && $0.text == destination }) {
                        NativeImageView(source: resource.value ?? destination, title: block.text, previewSource: resource.previewURL)
                    } else if NativeImageData.remoteURL(destination) != nil || destination.hasPrefix("data:") {
                        NativeImageView(source: destination, title: block.text)
                    } else if let store {
                        Button(block.text.isEmpty ? label("查看图片", "View Image") : block.text, systemImage: "photo") {
                            store.command("file.open", ["href": .string(destination)])
                        }
                    }
                }
            case .text:
                Text(NativeInlineMarkdown.text(block.text)).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.font(.system(size: bodySize * scale, weight: .medium))
    }
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
