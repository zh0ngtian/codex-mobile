import SwiftUI

struct AssistantBody: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let text: String
    var quoteSource: NativeQuoteSource? = nil
    var references: [NativeMessageReference] = []
    @State private var selectedReference: Int? = nil
    private var blocks: [NativeMarkdownBlock] { NativeMarkdownDocumentCache.blocks(for: text) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(segments) { segment in
                Group {
                    if let block = segment.block { blockView(block) }
                    else { NativeSelectableText(text: NativeSelectableMarkdown.blocks(segment.text), openLink: openLink) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .sheet(isPresented: Binding(get: { selectedReference != nil }, set: { if !$0 { selectedReference = nil } })) {
            if let index = selectedReference, references.indices.contains(index) {
                ScrollView { MessageReferenceCards(references: [references[index]], firstIndex: index + 1, expanded: true, onRevealSource: { selectedReference = nil }).padding() }
                    .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
            }
        }
        .selectionQuoteSource(quoteSource)
        .font(AgentTheme.chatBody)
        .textSelection(.enabled)
        .tint(AgentTheme.ink)
        .environment(\.openURL, OpenURLAction { url in
            if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") { return .systemAction }
            session.nativeStore?.command("file.open", ["href": .string(url.absoluteString)])
            return .handled
        })
    }

    private struct Segment: Identifiable {
        let id: Int
        var text: [NativeMarkdownBlock] = []
        var block: NativeMarkdownBlock?
    }
    private var segments: [Segment] {
        var result: [Segment] = []
        for block in blocks {
            let selectable = [.text, .heading, .list, .quote].contains(block.kind) &&
                !NativeMarkdownInlinePart.parse(block.text, scope: block.scope).contains { $0.destination != nil }
            if selectable {
                if result.last?.block == nil, !result.isEmpty { result[result.count - 1].text.append(block) }
                else { result.append(Segment(id: block.id, text: [block])) }
            } else { result.append(Segment(id: block.id, block: block)) }
        }
        return result
    }
    private func openLink(_ url: URL) {
        if let fragment = url.fragment, fragment.hasPrefix("codex-annotation-"), let number = Int(fragment.dropFirst("codex-annotation-".count)), references.indices.contains(number - 1) { selectedReference = number - 1; return }
        if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        } else { session.nativeStore?.command("file.open", ["href": .string(url.absoluteString)]) }
    }

    @ViewBuilder private func blockView(_ block: NativeMarkdownBlock) -> some View {
        switch block.kind {
        case .code:
            CodeCard(code: block.text, language: block.language.isEmpty ? "Code" : block.language).selectionQuoteSource(quoteSource, region: "code")
            if block.language.lowercased() == "mermaid" {
                Button(preferences.text("预览图表", "Preview diagram"), systemImage: "point.3.connected.trianglepath.dotted") {
                    session.nativeStore?.command("diagram.render", ["source": .string(block.text)])
                }
                .font(AgentTheme.small).frame(minHeight: 44)
            }
        case .heading:
            Text(inline(block)).font(.body.bold())
                .accessibilityAddTraits(.isHeader)
        case .list:
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if let checked = block.checked {
                    Image(systemName: checked ? "checkmark.square" : "square").foregroundStyle(.secondary)
                } else { Text(block.marker).foregroundStyle(.secondary).accessibilityHidden(true) }
                inlineContent(block)
            }
            .padding(.leading, CGFloat(block.depth) * 16)
        case .quote:
            inlineContent(block).foregroundStyle(.secondary)
                .padding(.leading, 14).padding(.vertical, 4)
                .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(.tint.opacity(0.4)).frame(width: 3) }
        case .rule: Divider().padding(.vertical, 4)
        case .table:
            NativeMarkdownTableView(rows: block.rows, scale: 1, store: session.nativeStore, cellScopes: block.cellScopes).selectionQuoteSource(quoteSource, region: "table")
        case .image:
            if let destination = block.destination {
                NativeMarkdownImageView(source: destination, title: block.text, store: session.nativeStore)
            }
        case .text: inlineContent(block)
        }
    }

    private func inline(_ block: NativeMarkdownBlock) -> AttributedString {
        var value = NativeInlineMarkdown.text(block.text, scope: block.scope)
        for run in value.runs where run.inlinePresentationIntent?.contains(.code) == true {
            value[run.range].foregroundColor = .gray
        }
        return value
    }

    private func inlineContent(_ block: NativeMarkdownBlock) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(NativeMarkdownInlinePart.parse(block.text, scope: block.scope)) { part in
                if let destination = part.destination {
                    NativeMarkdownImageView(source: destination, title: part.text, store: session.nativeStore)
                } else {
                    NativeSelectableText(text: NativeSelectableMarkdown.inline(part.text, scope: part.scope), openLink: openLink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
