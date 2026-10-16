import SwiftUI

struct NativeDeviceConfirmationView: View {
    let panel: NativePanel
    let store: NativeUIStore

    var body: some View {
        if let message = panel.items.first(where: { $0.id == "device-confirmation" })?.text {
            Text(message).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                .padding(16).background(NativePalette.settingsCard, in: .rect(cornerRadius: 23))
                .accessibilityIdentifier("native-device-confirmation")
        }
        HStack(spacing: 10) {
            if let cancel = panel.items.first(where: { $0.id == "back" }) {
                NativeSettingsActionButton(item: cancel, store: store)
            }
            if let confirm = panel.items.first(where: { $0.id == "confirm" }) {
                NativeSettingsActionButton(item: confirm, store: store, primary: true)
            }
        }.disabled(panel.dismissible == false)
        ForEach(panel.items.filter { !["device-confirmation", "back", "confirm"].contains($0.id) }) { item in
            NativePanelItemView(item: item, store: store, scope: .panel(panel.id))
        }
    }
}
