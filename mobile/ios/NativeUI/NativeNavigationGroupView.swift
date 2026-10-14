import SwiftUI

struct NativeNavigationGroupView: View {
    let group: NativeGroup
    let store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: toggle) {
                HStack {
                    Text(group.title).modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    if group.command != nil {
                        Image(systemName: group.collapsed == true ? "chevron.right" : "chevron.down")
                            .font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                }.frame(minHeight: 32)
            }.buttonStyle(.plain).disabled(group.command == nil)
            ForEach(group.items) { item in NativeNavigationRow(item: item, store: store) }
            ForEach(group.actions ?? []) { action in
                NativePanelItemView(item: action, store: store, scope: .message("group:\(group.id)"))
            }
        }
    }
    private func toggle() { store.perform(group.command) }
}
