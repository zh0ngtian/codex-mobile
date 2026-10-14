import SwiftUI

struct NativeMentionSuggestions: View {
    let items: [NativeOption]
    let store: NativeUIStore
    let context: String?
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(items) { item in
                    Button { insert(item) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).font(.callout.weight(.medium))
                            if let subtitle = item.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 6)
                    }.buttonStyle(.plain)
                }
            }
        }.frame(maxHeight: 160).background(.regularMaterial, in: .rect(cornerRadius: 16))
            .accessibilityIdentifier("native-mention-suggestions")
    }
    private func insert(_ item: NativeOption) {
        var params: [String: NativeJSONValue] = ["id": .string(item.id)]
        if let context { params["contextId"] = .string(context) }
        store.command("mention.insert", params)
    }
}
