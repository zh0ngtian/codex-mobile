import SwiftUI

struct ComposerQuoteCards: View {
    @Environment(AppSession.self) private var session
    let quotes: [NativeMessageQuote]
    var body: some View {
        ScrollView(.vertical) {
            VStack(spacing: 6) {
                ForEach(quotes) { quote in ComposerQuoteCard(quote: quote) }
            }
        }
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.quotes")
    }
}
private struct ComposerQuoteCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let quote: NativeMessageQuote
    @State private var expanded = false
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button { expanded.toggle() } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Label(quote.source.label(english: preferences.isEnglish), systemImage: "text.quote").font(.caption).foregroundStyle(.secondary)
                    Text(quote.text).font(.subheadline).lineLimit(expanded ? nil : 2).multilineTextAlignment(.leading)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.plain).accessibilityLabel(preferences.text(expanded ? "收起引用全文" : "展开引用全文", expanded ? "Collapse quote" : "Expand quote")).accessibilityIdentifier("quote.expand")
            Button(preferences.text("移除引用", "Remove quote"), systemImage: "xmark") {
                session.nativeStore?.command("quote.remove", ["id": .string(quote.id)])
            }.labelStyle(.iconOnly).frame(width: 36, height: 36).accessibilityIdentifier("quote.remove")
        }
        .padding(10).background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.quote")
    }
}
