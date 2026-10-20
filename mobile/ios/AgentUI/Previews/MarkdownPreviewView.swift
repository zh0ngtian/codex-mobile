import SwiftUI

struct MarkdownPreviewView: View {
    let source: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(MarkdownBlock.parse(source)) { block in
                    MarkdownBlockView(block: block)
                }
            }
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(22)
        }
    }
}
