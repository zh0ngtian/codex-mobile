import SwiftUI

struct NativeSidebarView: View {
    @Bindable var store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Codex Mobile").font(.headline)
                Spacer()
                NativeIconButton(title: store.label("关闭侧栏", "Close Sidebar"), symbol: "xmark", identifier: "native-sidebar-close") { store.sidebarOpen = false }
            }
            TextField(store.label("搜索会话", "Search Conversations"), text: $store.search)
                .accessibilityIdentifier("native-sidebar-search")
                .padding(10).background(.quaternary, in: .capsule)
                .onChange(of: store.search) { store.command("navigation.search", ["value": .string(store.search)]) }
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
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.title).font(.caption).foregroundStyle(.secondary)
                            ForEach(group.items) { item in
                                Button { store.perform(item.command); store.sidebarOpen = false } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.title).font(.body).lineLimit(2)
                                        if let subtitle = item.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                        .padding(.horizontal, 10)
                                        .background(item.selected == true ? NativePalette.bubble : .clear, in: .rect(cornerRadius: 12))
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            Button { store.settingsOpen = true } label: {
                Label(store.label("设置", "Settings"), systemImage: "gearshape").frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            }.buttonStyle(.plain).accessibilityIdentifier("native-settings-open")
        }.padding(16).background(NativePalette.canvas)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("native-sidebar")
    }
    private func navigationButton(_ title: String, symbol: String, id: String) -> some View {
        Button { store.command("panel.open", ["id": .string(id)]) } label: {
            Label(title, systemImage: symbol).frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
        }.buttonStyle(.plain)
    }
}
