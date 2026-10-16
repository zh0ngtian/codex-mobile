import SwiftUI

struct NativeSidebarView: View {
    @Bindable var store: NativeUIStore
    @State private var searchVisible = false
    @State private var deviceMenuOpen = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                NativeIconButton(title: store.label("关闭侧栏", "Close Sidebar"), symbol: "line.3.horizontal", identifier: "native-sidebar-close") { store.sidebarIsOpen = false }
                Button { deviceMenuOpen.toggle() } label: {
                    VStack(spacing: 3) {
                        HStack(spacing: 7) {
                            Text("Codex").modifier(NativeScaledFont(size: 18, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline))
                            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 5) {
                            Circle().fill(store.listBackendConnected ? .green : .gray).frame(width: 6, height: 6)
                            Image(systemName: "laptopcomputer").font(.system(size: 11))
                            Text(deviceTitle).lineLimit(1)
                        }.modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .caption)).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.plain).accessibilityIdentifier("native-sidebar-device-menu")
                NativeIconButton(title: store.label("搜索会话", "Search Conversations"), symbol: "magnifyingglass", identifier: "native-sidebar-search-open") { searchVisible.toggle() }
            }.padding(.horizontal, 16).padding(.bottom, 12)
            if searchVisible || !store.sidebarSearchText.isEmpty {
                TextField(store.label("搜索会话", "Search Conversations"), text: $store.sidebarSearchText)
                    .accessibilityIdentifier("native-sidebar-search")
                    .padding(10).background(.quaternary, in: .capsule).padding(.horizontal, 20).padding(.bottom, 10)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(leadingGroups) { group in
                        NativeNavigationGroupView(group: group, store: store).padding(.bottom, 16)
                    }
                    if !projectGroups.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(store.label("项目", "Projects"))
                                .modifier(NativeScaledFont(size: 15, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline))
                                .frame(minHeight: 20, alignment: .leading)
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(projectGroups) { group in NativeNavigationGroupView(group: group, store: store) }
                            }
                        }.padding(.bottom, 8)
                    }
                    ForEach(trailingGroups) { group in
                        NativeNavigationGroupView(group: group, store: store).padding(.bottom, 16)
                    }
                }.padding(.horizontal, 20).padding(.top, 0).padding(.bottom, 24)
            }.scrollIndicators(.hidden)
        }.background { NativePalette.canvas.ignoresSafeArea(.container) }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                NativeNewConversationLauncher(store: store)
                    .background {
                        Rectangle().fill(.regularMaterial)
                            .overlay(NativePalette.canvas.opacity(0.6))
                            .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.5), .init(color: .black, location: 1)], startPoint: .top, endPoint: .bottom))
                            .ignoresSafeArea(.container, edges: .bottom)
                    }
            }
            .accessibilityElement(children: .contain).accessibilityIdentifier("native-sidebar")
            .overlay(alignment: .topLeading) {
                if deviceMenuOpen {
                    GeometryReader { geometry in
                        ZStack(alignment: .topLeading) {
                            Button { deviceMenuOpen = false } label: {
                                Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(store.label("关闭设备菜单", "Close Device Menu"))
                            NativeSidebarDeviceMenu(store: store) { deviceMenuOpen = false }
                                .frame(width: min(340, max(196, geometry.size.width - 96)))
                                .offset(x: 78, y: 56)
                        }
                    }
                }
            }
    }
    private var projectGroups: [NativeGroup] { store.snapshot.groups.filter { $0.category == "project" } }
    private var leadingGroups: [NativeGroup] { store.snapshot.groups.filter { $0.category == "pinned" || $0.category == "search" || $0.category == nil } }
    private var trailingGroups: [NativeGroup] { store.snapshot.groups.filter { $0.category == "recent" } }
    private var listBackend: NativeBackend? { store.snapshot.backends.first { $0.id == store.snapshot.listBackendId } }
    private var deviceTitle: String { store.snapshot.listBackendId == "all" ? store.label("全部设备", "All Devices") : listBackend?.title ?? store.label("选择设备", "Select Device") }
}
