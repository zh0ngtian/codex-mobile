import SwiftUI

struct NativeMarkdownView: View {
    let text: String
    var scale: Double = 1
    var store: NativeUIStore? = nil
    var compact = false
    var weight: Font.Weight = .medium
    @State private var blocks: [NativeMarkdownBlock] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(blocks) { block in
                NativeMarkdownBlockView(block: block, scale: scale, store: store, compact: compact, weight: weight)
                    .padding(.top, block.spacingBefore)
            }
        }
        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        .task(id: text) { blocks = NativeMarkdownBlock.parse(text) }
        .environment(\.openURL, OpenURLAction { url in
            if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") { return .systemAction }
            guard let store else { return .discarded }
            store.command("file.open", ["href": .string(url.absoluteString)])
            return .handled
        })
    }
}
