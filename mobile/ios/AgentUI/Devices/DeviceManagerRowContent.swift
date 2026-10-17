import SwiftUI

struct DeviceManagerRowContent: View {
    @Environment(AppPreferences.self) private var preferences
    let device: BackendDevice

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(device.name).font(.headline).foregroundStyle(AgentTheme.ink)
            Text(gatewayHost).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            DeviceStatusBadge(device: device)
        }
        .padding(.vertical, 7)
    }

    private var gatewayHost: String {
        URLComponents(string: device.gatewayAddress)?.host ?? preferences.text("网关地址", "Gateway address")
    }
}
