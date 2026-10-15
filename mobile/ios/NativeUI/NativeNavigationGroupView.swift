import SwiftUI

struct NativeNavigationGroupView: View {
    let group: NativeGroup
    let store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                if let command = group.command {
                    Button { store.perform(command) } label: {
                        headerTitle.contentShape(.rect)
                    }.buttonStyle(.plain).accessibilityLabel(group.title)
                } else {
                    headerTitle
                }
                if let command = newCommand {
                    Button { store.perform(command) } label: {
                        Image(systemName: "square.and.pencil").font(.system(size: 17)).foregroundStyle(.secondary).frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel(store.label("新对话", "New Conversation"))
                        .accessibilityIdentifier("native-group-new-\(group.id)")
                        .disabled(!store.snapshot.ready || store.snapshot.pending == true || store.awaitingNewConversation)
                }
            }
            .padding(.top, isProject ? 0 : 12)
            if group.loading == "loading" {
                ProgressView(store.label("正在加载…", "Loading…")).font(.caption).padding(.leading, isProject ? 30 : 0)
            } else if group.loading == "error" {
                Text(store.label("加载失败", "Could not load")).font(.caption).foregroundStyle(.secondary).padding(.leading, isProject ? 30 : 0)
            }
            ForEach(group.items) { item in
                NativeNavigationRow(item: item, store: store, showsSubtitle: group.category == "search" || store.snapshot.listBackendId == "all", rowHeight: group.category == "pinned" ? 49 : 44)
                    .padding(.leading, isProject ? 30 : 0)
            }
            ForEach(group.actions ?? []) { action in
                NativePanelItemView(item: action, store: store, scope: .message("group:\(group.id)"))
            }
        }
    }
    private var headerTitle: some View {
        HStack(spacing: 12) {
            if isProject { Image(systemName: "folder").font(.system(size: 17)).frame(width: 18) }
            VStack(alignment: .leading, spacing: 2) {
                Text(group.title).modifier(NativeScaledFont(size: 15, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .headline)).lineLimit(1)
                if let subtitle = group.subtitle {
                    Text(subtitle).modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            if !isProject, group.command != nil {
                Image(systemName: group.collapsed == true ? "chevron.right" : "chevron.down").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }.frame(minHeight: isProject || group.category == "recent" ? 44 : 20)
    }
    private var newCommand: NativeCommand? {
        group.newCommand ?? (group.category == "recent" ? NativeCommand(name: "thread.new") : nil)
    }
    private var isProject: Bool { group.category == "project" }
}
