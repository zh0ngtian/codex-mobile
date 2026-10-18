import SwiftUI

struct HomeHeader: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Menu {
                    Section(preferences.text("设备范围", "Device scope")) {
                        Button { session.selectListDevice(nil) } label: {
                            Label(preferences.text("全部设备", "All devices"), systemImage: session.selectedDeviceID == nil ? "checkmark" : "desktopcomputer")
                        }
                        ForEach(session.devices) { device in
                            Button { session.selectListDevice(device.id) } label: {
                                Label(deviceMenuTitle(device), systemImage: session.selectedDeviceID == device.id ? "checkmark" : "laptopcomputer")
                            }
                        }
                    }
                    Section {
                        Button { session.draftsPresented = true } label: {
                            Label(preferences.text("草稿箱", "Drafts"), systemImage: "doc.text")
                        }
                        Button { Task { await session.refreshAll() } } label: {
                            Label(preferences.text("刷新", "Refresh"), systemImage: "arrow.clockwise")
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Codex").font(.body)
                            Text(scopeTitle).font(.body).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
                }
                .tint(AgentTheme.ink)
                .accessibilityLabel(preferences.text("Codex 菜单", "Codex menu"))
                .accessibilityIdentifier("sidebar.codexMenu")
                .accessibilityValue(scopeTitle)
                Button(action: toggleSearch) {
                    Image(systemName: session.searchVisible ? "xmark" : "magnifyingglass")
                        .font(.title3.weight(.light))
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(session.searchVisible ? preferences.text("收起并清空搜索", "Close and clear search") : preferences.text("搜索会话", "Search conversations"))
                .accessibilityIdentifier("sidebar.search")
            }
        }
        .buttonStyle(.plain)
        .padding(.leading, 16)
        .padding(.trailing, 22)
        .padding(.top, 6)
        .padding(.bottom, 10)
    }

    private var scopedDevice: BackendDevice? { session.selectedDeviceID.flatMap(session.device) }
    private var scopeTitle: String { scopedDevice?.name ?? preferences.text("全部设备", "All devices") }
    private func deviceMenuTitle(_ device: BackendDevice) -> String {
        guard device.enabled else { return "\(device.name) · \(preferences.text("已暂停", "Paused"))" }
        switch device.connection {
        case .connected: return device.name
        case .connecting: return "\(device.name) · \(preferences.text("连接中", "Connecting"))"
        case .failed: return "\(device.name) · \(preferences.text("连接失败", "Failed"))"
        case .paused: return "\(device.name) · \(preferences.text("已暂停", "Paused"))"
        }
    }

    private func toggleSearch() {
        session.searchVisible.toggle()
        if !session.searchVisible { session.searchText = "" }
    }
}
