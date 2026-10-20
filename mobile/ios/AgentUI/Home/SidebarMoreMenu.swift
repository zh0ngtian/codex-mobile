import SwiftUI

struct SidebarMoreMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let devices = session.devices.map { device in
            SidebarDeviceMenuOption(id: device.id, title: title(device), selected: session.selectedDeviceID == device.id)
        }
        SidebarMoreMenuContents(devices: devices,
            english: preferences.isEnglish,
            scopeTitle: session.selectedDeviceID.flatMap(session.device)?.name ?? preferences.text("全部设备", "All devices"),
            select: { session.selectListDevice($0) }, drafts: { session.draftsPresented = true },
            refresh: { Task { await session.refreshAll() } }, settings: { session.settingsPresented = true })
            .equatable()
    }
    private func title(_ device: BackendDevice) -> String {
        guard device.enabled else { return device.name + " · " + preferences.text("已暂停", "Paused") }
        switch device.connection {
        case .connected: return device.name
        case .connecting: return device.name + " · " + preferences.text("连接中", "Connecting")
        case .failed: return device.name + " · " + preferences.text("连接失败", "Failed")
        case .paused: return device.name + " · " + preferences.text("已暂停", "Paused")
        }
    }
}

private struct SidebarDeviceMenuOption: Identifiable, Equatable {
    let id: UUID
    let title: String
    let selected: Bool
}

/// 设备连接/范围真正变化时更新，避免无关消息快照反复重建菜单。
private struct SidebarMoreMenuContents: View, Equatable {
    let devices: [SidebarDeviceMenuOption]
    let english: Bool
    let scopeTitle: String
    let select: (UUID?) -> Void
    let drafts: () -> Void
    let refresh: () -> Void
    let settings: () -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.devices == rhs.devices && lhs.english == rhs.english && lhs.scopeTitle == rhs.scopeTitle
    }
    var body: some View {
        Menu {
            Group {
                Section(english ? "Device scope" : "设备范围") {
                    ForEach(devices) { device in
                        Button { select(device.id) } label: {
                            Label(device.title, systemImage: device.selected ? "checkmark" : "laptopcomputer")
                        }
                    }
                }
                Section {
                    Button(action: drafts) { Label(english ? "Drafts" : "草稿箱", systemImage: "doc.text") }
                        .accessibilityIdentifier("sidebar.drafts")
                    Button(action: refresh) { Label(english ? "Refresh" : "刷新", systemImage: "arrow.clockwise") }
                        .accessibilityIdentifier("sidebar.refresh")
                    Button(action: settings) { Label(english ? "Settings" : "设置", systemImage: "gearshape") }
                        .accessibilityIdentifier("sidebar.settings")
                }
            }.tint(AgentTheme.ink)
        } label: { SidebarIconLabel(systemImage: "ellipsis") }
        .modifier(SidebarIconAppearance())
        .menuIndicator(.hidden).menuOrder(.fixed)
        .accessibilityLabel(english ? "Sidebar menu" : "侧栏菜单")
        .accessibilityValue(scopeTitle).accessibilityIdentifier("sidebar.more")
    }
}
