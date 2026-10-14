import SwiftUI

struct NativeQueuedMessagesView: View {
    let store: NativeUIStore
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(store.snapshot.queued) { item in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, relativeTo: .caption)).lineLimit(2)
                        if let subtitle = item.subtitle { Text(subtitle).modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption2)).foregroundStyle(.secondary) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    if let badge = item.badge { Text(badge).modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption2)).foregroundStyle(.secondary) }
                    Menu(store.label("管理排队消息", "Manage Queued Message"), systemImage: "ellipsis") {
                        if let command = item.command {
                            Button(store.label("发送", "Send")) { store.perform(command) }
                        }
                        ForEach(item.actions ?? []) { action in
                            NativePanelItemView(item: action, store: store, scope: .message("queue:\(item.id)"))
                        }
                    }.labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                }.padding(.horizontal, 12).background(.quaternary, in: .rect(cornerRadius: 12))
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("native-queued-messages")
    }
}
