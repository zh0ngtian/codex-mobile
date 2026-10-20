import SwiftUI

struct DeviceManagerRowContent: View {
    @Environment(AppPreferences.self) private var preferences
    let device: BackendDevice

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(device.name).font(.body).foregroundStyle(AgentTheme.ink)
            Text(gatewayHost).font(.body).foregroundStyle(.secondary).lineLimit(1)
            DeviceStatusBadge(device: device)
        }
        .padding(.vertical, 7)
    }

    private var gatewayHost: String {
        URLComponents(string: device.gatewayAddress)?.host ?? preferences.text("网关地址", "Gateway address")
    }
}
