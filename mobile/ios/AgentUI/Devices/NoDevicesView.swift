import SwiftUI

struct NoDevicesView: View {
    @Environment(AppPreferences.self) private var preferences
    let addDevice: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(preferences.text("连接你的第一台设备", "Connect your first device"), systemImage: "desktopcomputer")
        } description: {
            Text(preferences.text("添加设备名称和包含访问口令的完整网关地址，即可开始选择项目和会话。", "Add a device name and a full gateway URL containing its access token to start choosing projects and conversations."))
        } actions: {
            Button(preferences.text("添加设备", "Add device"), systemImage: "plus", action: addDevice)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("devices.addFirst")
        }
    }
}
