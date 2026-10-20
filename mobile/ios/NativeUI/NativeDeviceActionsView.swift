import SwiftUI

struct NativeDeviceActionsView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        layout {
            ForEach(actions) { action in
                NativeDeviceActionButton(item: action, deviceTitle: item.title ?? "", store: store)
            }
        }
    }

    private var actions: [NativePanelItem] {
        ["toggle", "up", "down", "remove"].compactMap { suffix in
            item.children?.first { $0.id == "\(item.id):\(suffix)" }
        }
    }
}
