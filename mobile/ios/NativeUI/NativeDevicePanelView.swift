import SwiftUI

struct NativeDevicePanelView: View {
    let panel: NativePanel
    let store: NativeUIStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NativeSettingsDetailView(panel: panel, store: store, back: back) {
            if panel.items.contains(where: { $0.id == "device-confirmation" }) {
                NativeDeviceConfirmationView(panel: panel, store: store)
            } else if panel.items.contains(where: { $0.id == "gatewayUrl" }) {
                NativeDeviceFormView(panel: panel, store: store)
            } else {
                NativeDeviceListView(panel: panel, store: store)
            }
        }
    }

    private func back() {
        if let cancel = panel.items.first(where: { $0.id == "cancel" || $0.id == "back" }) {
            store.perform(cancel.command)
        } else {
            dismiss()
        }
    }
}
