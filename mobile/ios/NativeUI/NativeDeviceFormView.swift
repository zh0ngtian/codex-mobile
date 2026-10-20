import SwiftUI

struct NativeDeviceFormView: View {
    let panel: NativePanel
    let store: NativeUIStore

    var body: some View {
        VStack(spacing: 22) {
            if let name = item("name") { NativeSettingsFieldView(item: name, store: store, scope: .panel(panel.id)) }
            if let gateway = item("gatewayUrl") {
                NativeSettingsFieldView(item: gateway, store: store, scope: .panel(panel.id), placeholder: "https://gateway.example")
            }
            if let scan = item("scan") { NativeSettingsActionButton(item: scan, store: store, symbol: "qrcode") }
            HStack(spacing: 10) {
                if let cancel = item("cancel") { NativeSettingsActionButton(item: cancel, store: store) }
                if let save = item("save") { NativeSettingsActionButton(item: save, store: store, primary: true) }
            }.padding(.top, 2)
        }
        .disabled(panel.dismissible == false)
        ForEach(additionalItems) { item in
            NativePanelItemView(item: item, store: store, scope: .panel(panel.id))
                .foregroundStyle(item.id == "devices-error" ? .red : .primary)
        }
    }

    private func item(_ id: String) -> NativePanelItem? { panel.items.first { $0.id == id } }
    private var additionalItems: [NativePanelItem] { panel.items.filter { !["name", "gatewayUrl", "scan", "cancel", "save"].contains($0.id) } }
}
