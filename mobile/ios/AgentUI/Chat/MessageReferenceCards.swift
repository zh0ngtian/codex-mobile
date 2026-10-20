import SwiftUI

struct MessageReferenceCards: View {
    let references: [NativeMessageReference]
    var firstIndex = 1
    var expanded = false
    var onRevealSource: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(references.enumerated()), id: \.offset) { index, reference in
                MessageReferenceCard(reference: reference, number: firstIndex + index, initiallyExpanded: expanded, onRevealSource: onRevealSource)
            }
        }
    }
}
private struct MessageReferenceCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let reference: NativeMessageReference
    let number: Int
    let onRevealSource: (() -> Void)?
    @State private var expanded: Bool
    init(reference: NativeMessageReference, number: Int, initiallyExpanded: Bool, onRevealSource: (() -> Void)?) {
        self.reference = reference; self.number = number; self.onRevealSource = onRevealSource
        _expanded = State(initialValue: initiallyExpanded)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(preferences.text("引用 \(number)", "Quote \(number)")).font(.caption).foregroundStyle(.secondary)
                        if !expanded { Text(reference.text).font(.body).lineLimit(2).multilineTextAlignment(.leading) }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(.rect)
            }
            .buttonStyle(.plain).accessibilityIdentifier("message.reference.toggle")
            .accessibilityValue(preferences.text(expanded ? "已展开" : "已收起", expanded ? "Expanded" : "Collapsed"))
            if expanded {
                NativeSelectableText(text: NSAttributedString(string: reference.text, attributes: [.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label]), identifier: "message.reference.text")
                    .fixedSize(horizontal: false, vertical: true)
                if let comment = reference.annotation { Text(comment).font(.body).foregroundStyle(.secondary) }
                if session.referenceMessageID(reference) != nil {
                    Button(preferences.text("查看来源", "View source")) { session.revealReference(reference); onRevealSource?() }
                        .frame(minHeight: 44).accessibilityIdentifier("message.reference.source")
                }
            }
        }
        .padding(10).background(.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
        .accessibilityElement(children: .contain).accessibilityIdentifier("message.reference")
    }
}
