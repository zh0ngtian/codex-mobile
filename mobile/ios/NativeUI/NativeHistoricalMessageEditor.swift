import SwiftUI

struct NativeHistoricalMessageEditor: View {
    let editor: NativePanel
    let messageID: String
    let store: NativeUIStore
    @FocusState private var focused: Bool
    private var scope: NativeFieldScope { .historyEdit(contextID: store.snapshot.contextId ?? "", messageID: messageID, editID: editor.id) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(editor.title).foregroundStyle(.secondary).font(.caption)
            if let field = editor.items.first(where: { $0.id == "history-text" }) {
                TextField(field.title ?? "", text: textBinding(field), axis: .vertical)
                    .lineLimit(3...12).focused($focused).disabled(field.disabled == true)
                    .textFieldStyle(.plain).padding(12)
                    .background(NativePalette.canvas, in: .rect(cornerRadius: 12))
                    .accessibilityIdentifier("native-history-input")
            }
            ForEach(editor.items.filter { $0.id != "history-text" && $0.kind != "action" }) { item in
                NativePanelItemView(item: item, store: store, scope: scope)
            }
            ViewThatFits(in: .horizontal) {
                HStack { actions }
                VStack(alignment: .leading) { actions }
            }
        }
        .padding(14).background(NativePalette.bubble, in: .rect(cornerRadius: NativeVisualMetrics.bubbleRadius))
        .modifier(NativeScaledFont(size: 16, scale: store.snapshot.fontScale))
        .task(id: editor.id) { focused = editor.dismissible != false }
    }
    private var actions: some View {
        ForEach(editor.items.filter { $0.kind == "action" }) { item in
            Button(item.title ?? "") { store.perform(item.command) }
                .frame(minHeight: 44).disabled(item.disabled == true)
                .accessibilityIdentifier("native-\(item.id)")
        }
    }
    private func textBinding(_ item: NativePanelItem) -> Binding<String> {
        let fieldScope = scope
        return Binding(get: { store.fieldValue(item, scope: fieldScope) }, set: { value in
            store.setFieldValue(value, item: item, scope: fieldScope)
            store.sendFieldEdit(item, scope: fieldScope, values: ["value": .string(value)])
        })
    }
}
