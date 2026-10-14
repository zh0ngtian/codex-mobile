import SwiftUI

struct NativeMarkdownView: View {
    let text: String
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    var scale: Double = 1
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(NativeMarkdownBlock.parse(text)) { block in
                Group {
                    switch block.kind {
                    case .heading: Text(inline(block.text)).font(.system(size: bodySize * (20.0 / 14.0) * scale, weight: .bold)).accessibilityAddTraits(.isHeader)
                    case .list: HStack(alignment: .firstTextBaseline, spacing: 8) { Text("•").accessibilityHidden(true); Text(inline(block.text)).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading) }
                    case .code: NativeCodeView(text: block.text, language: block.language, scale: scale)
                    case .text: Text(inline(block.text)).lineSpacing(5).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }.padding(.top, block.spacingBefore)
            }
        }.font(.system(size: bodySize * scale, weight: .medium)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
    }
    private func inline(_ value: String) -> AttributedString {
        (try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(value)
    }
}
