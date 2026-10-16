import SwiftUI

struct NativeDeviceListView: View {
    let panel: NativePanel
    let store: NativeUIStore

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 7) {
                Text(store.label("已添加的设备", "Added Devices"))
                    .modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption))
                    .foregroundStyle(.secondary).frame(minHeight: 20, alignment: .leading).padding(.horizontal, 15)
                VStack(spacing: 12) {
                    ForEach(devices) { item in NativeDeviceCardView(item: item, store: store) }
                }
            }
            if let add = panel.items.first(where: { $0.id == "add" }) {
                NativeSettingsActionButton(item: add, store: store, primary: true, symbol: "plus")
            }
            ForEach(additionalItems) { item in
                NativePanelItemView(item: item, store: store, scope: .panel(panel.id))
                    .foregroundStyle(item.id == "devices-error" ? .red : .primary)
            }
        }
    }

    private var devices: [NativePanelItem] { panel.items.filter { $0.kind == "section" } }
    private var additionalItems: [NativePanelItem] { panel.items.filter { $0.kind != "section" && $0.id != "add" } }
}
