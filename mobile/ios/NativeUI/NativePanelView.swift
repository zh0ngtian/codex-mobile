import SwiftUI

struct NativePanelView: View {
    let panel: NativePanel
    let store: NativeUIStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form { ForEach(panel.items) { item in NativePanelItemView(item: item, store: store) } }
                .navigationTitle(panel.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(store.label("完成", "Done")) { dismiss() } } }
        }
    }
}
