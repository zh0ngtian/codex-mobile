import SwiftUI

struct DeviceManagerRow: View {
    @Environment(AppPreferences.self) private var preferences
    let device: BackendDevice
    let isReordering: Bool

    var body: some View {
        Group {
            if isReordering {
                DeviceManagerRowContent(device: device)
            } else {
                NavigationLink(value: DeviceFormRoute.edit(device.id)) {
                    DeviceManagerRowContent(device: device)
                }
            }
        }
        .accessibilityHint(isReordering ? preferences.text("拖动以调整设备顺序", "Drag to reorder devices") : preferences.text("编辑设备连接", "Edit device connection"))
    }
}
