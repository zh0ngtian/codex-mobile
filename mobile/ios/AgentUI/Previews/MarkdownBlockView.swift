import SwiftUI

struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block.kind {
        case "heading1":
            Text(inlineText).font(.title.bold()).accessibilityAddTraits(.isHeader).padding(.top, 6)
        case "heading2":
            Text(inlineText).font(.title2.bold()).accessibilityAddTraits(.isHeader).padding(.top, 4)
        case "heading3":
            Text(inlineText).font(.headline).accessibilityAddTraits(.isHeader)
        case "bullet":
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("•").foregroundStyle(.secondary).accessibilityHidden(true)
                Text(inlineText).font(.body)
            }
        case "quote":
            Text(inlineText).font(.body).foregroundStyle(.secondary)
                .padding(.leading, 14).padding(.vertical, 4)
                .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(.tint.opacity(0.4)).frame(width: 3) }
        case "code":
            ScrollView(.horizontal) {
                Text(block.text).font(.system(.body, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
            .background(AgentTheme.code, in: .rect(cornerRadius: 14))
        default:
            Text(inlineText).font(.body).lineSpacing(4)
        }
    }

    private var inlineText: AttributedString {
        (try? AttributedString(markdown: block.text,
                               options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(block.text)
    }
}
