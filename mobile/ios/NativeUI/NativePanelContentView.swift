import SwiftUI

struct NativePanelContentView: View {
    let panel: NativePanel
    let store: NativeUIStore
    var body: some View {
        Form {
            if let error = store.commandError { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            ForEach(panel.items) { item in NativePanelItemView(item: item, store: store, scope: .panel(panel.id)) }
        }
        .scrollContentBackground(.hidden).background(NativePalette.settings)
        .environment(\.defaultMinListRowHeight, 50)
        .navigationTitle(panel.title).navigationBarTitleDisplayMode(.inline)
    }
}
