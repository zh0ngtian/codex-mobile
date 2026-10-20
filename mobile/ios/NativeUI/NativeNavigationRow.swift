import SwiftUI

struct NativeNavigationRow: View {
    let item: NativeNavigationItem
    let store: NativeUIStore
    var closesSidebar = true
    var showsSubtitle = true
    var rowHeight: CGFloat = 44
    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale, weight: .medium)).lineLimit(2)
                    if showsSubtitle, let subtitle = item.subtitle { Text(subtitle).modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption)).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
                if let badge = item.badge {
                    Text(badge).modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, weight: .medium, relativeTo: .caption2)).foregroundStyle(NativePalette.accent)
                        .padding(4).background(NativePalette.bubble, in: .capsule)
                }
            }
            .frame(maxWidth: .infinity, minHeight: rowHeight, alignment: .leading)

        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(item.selected == true ? .isSelected : [])
        .accessibilityIdentifier("native-navigation-\(item.id)")
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
