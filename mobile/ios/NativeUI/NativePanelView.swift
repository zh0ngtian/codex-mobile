import SwiftUI

struct NativePanelView: View {
    let panel: NativePanel
    let store: NativeUIStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                if let error = store.commandError { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                ForEach(panel.items) { item in NativePanelItemView(item: item, store: store, scope: .panel(panel.id)) }
            }
                .navigationTitle(panel.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(store.label("完成", "Done")) { dismiss() } } }
        }
    }
}
