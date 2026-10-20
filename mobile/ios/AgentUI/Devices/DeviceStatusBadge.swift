import SwiftUI

struct DeviceStatusBadge: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    let device: BackendDevice

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { statusLabels }
            VStack(alignment: .leading, spacing: 4) { statusLabels }
        }
        .font(.body)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var statusLabels: some View {
        Label(connectionTitle, systemImage: connectionSymbol)
            .foregroundStyle(connectionColor)
        if isBusy {
            Label(preferences.text("忙碌", "Busy"), systemImage: "hourglass")
                .foregroundStyle(.secondary)
        }
        if session.pendingCount(for: device.id) > 0 {
            Label(preferences.text("\(session.pendingCount(for: device.id)) 项待审批", "\(session.pendingCount(for: device.id)) approvals"), systemImage: "hand.raised")
                .foregroundStyle(.orange)
        }
    }

    private var isBusy: Bool {
        session.conversations.contains { $0.deviceID == device.id && $0.phase.isBusy }
    }

    private var connectionTitle: String {
        guard device.enabled else { return preferences.text("已暂停", "Paused") }
        switch device.connection {
        case .connected: return preferences.text("已连接", "Connected")
        case .connecting: return preferences.text("连接中", "Connecting")
        case .paused: return preferences.text("已暂停", "Paused")
        case .failed: return preferences.text("连接失败", "Connection failed")
        }
    }

    private var connectionSymbol: String {
        guard device.enabled else { return "pause.circle" }
        switch device.connection {
        case .connected: return "checkmark.circle"
        case .connecting: return "arrow.trianglehead.2.clockwise.rotate.90"
        case .paused: return "pause.circle"
        case .failed: return "exclamationmark.circle"
        }
    }

    private var connectionColor: Color {
        guard device.enabled else { return .secondary }
        switch device.connection {
        case .connected: return .green
        case .connecting: return .secondary
        case .paused: return .secondary
        case .failed: return .red
        }
    }
}
