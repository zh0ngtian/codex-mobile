import SwiftUI

struct NativeNavigationRow: View {
    let item: NativeNavigationItem
    let store: NativeUIStore
    var closesSidebar = true
    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.body).lineLimit(2)
                    if let subtitle = item.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
                if let badge = item.badge {
                    Text(badge).font(.caption2.weight(.medium)).foregroundStyle(NativePalette.accent)
                        .padding(4).background(NativePalette.bubble, in: .capsule)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 10)
            .background(item.selected == true ? NativePalette.bubble : .clear, in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .contextMenu {
            ForEach(item.actions ?? []) { action in
                NativePanelItemView(item: action, store: store, scope: .message("navigation:\(item.id)"))
            }
        }
    }
    private func open() {
        guard item.command != nil else { return }
        store.perform(item.command)
        if closesSidebar { store.sidebarIsOpen = false }
    }
}
