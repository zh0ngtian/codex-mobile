import SwiftUI

struct NativePanelView: View {
    let panel: NativePanel
    let store: NativeUIStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            NativePanelContentView(panel: panel, store: store)
                .toolbar {
                    if panel.dismissible != false {
                        ToolbarItem(placement: .confirmationAction) { Button(store.label("完成", "Done")) { store.closePanel(expectedID: panel.id); dismiss() } }
                    }
                }
        }.interactiveDismissDisabled(panel.dismissible == false)
    }
}
