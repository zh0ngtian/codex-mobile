import SwiftUI

struct NativeSidebarView: View {
    @Bindable var store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Codex Mobile").modifier(NativeScaledFont(size: 17, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .headline))
                Spacer()
                NativeIconButton(title: store.label("刷新", "Refresh"), symbol: "arrow.clockwise", identifier: "native-sidebar-refresh") { store.command("navigation.refresh") }
                NativeIconButton(title: store.label("关闭侧栏", "Close Sidebar"), symbol: "xmark", identifier: "native-sidebar-close") { store.sidebarIsOpen = false }
            }
            TextField(store.label("搜索会话", "Search Conversations"), text: $store.sidebarSearchText)
                .accessibilityIdentifier("native-sidebar-search")
                .padding(10).background(.quaternary, in: .capsule)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(store.snapshot.backends) { backend in
                        Button { store.command("backend.select", ["id": .string(backend.id)]) } label: {
                            Label(backend.title, systemImage: backend.connected == true ? "desktopcomputer" : "network")
                        }.buttonStyle(.plain).frame(minHeight: 44)
                    }
                    navigationButton(store.label("设备", "Devices"), symbol: "desktopcomputer", id: "devices")
                    navigationButton(store.label("关注", "Favorites"), symbol: "star", id: "favorites")
                    navigationButton(store.label("项目", "Projects"), symbol: "folder", id: "projects")
                    navigationButton(store.label("会话", "Conversations"), symbol: "bubble.left.and.bubble.right", id: "sessions")
                    navigationButton(store.label("草稿", "Drafts"), symbol: "square.and.pencil", id: "drafts")
                    ForEach(store.snapshot.groups) { group in
                        NativeNavigationGroupView(group: group, store: store)
                    }
                }
            }
            Button { store.settingsOpen = true } label: {
                Label(store.label("设置", "Settings"), systemImage: "gearshape").frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            }.buttonStyle(.plain).accessibilityIdentifier("native-settings-open")
        }.modifier(NativeScaledFont(size: 16, scale: store.snapshot.fontScale)).padding(16).background(NativePalette.canvas)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("native-sidebar")
    }
    private func navigationButton(_ title: String, symbol: String, id: String) -> some View {
        Button {
            if ["favorites", "projects", "sessions"].contains(id) { store.command("navigation.filter", ["value": .string(id)]) }
            else if id == "drafts" { store.command("drafts.open") }
            else { store.command("settings.open", ["id": .string(id)]) }
        } label: {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
        }.buttonStyle(.plain)
    }
}
