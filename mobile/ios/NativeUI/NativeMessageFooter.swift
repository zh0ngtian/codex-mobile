import SwiftUI

struct NativeMessageFooter: View {
    let message: NativeMessage
    let store: NativeUIStore
    var body: some View {
        HStack(spacing: 12) {
            ForEach(message.actions ?? []) { item in
                if item.command?.name == "message.copy" {
                    Button { store.perform(item.command) } label: {
                        Image(systemName: "square.on.square").font(.system(size: 16)).frame(minWidth: 28, minHeight: 36)
                    }.buttonStyle(.plain).accessibilityLabel(item.title ?? store.label("复制", "Copy"))
                } else {
                    NativePanelItemView(item: item, store: store, scope: .message(message.id))
                }
            }
            if let timestamp = message.timestamp {
                Text(Date(timeIntervalSince1970: timestamp), format: .dateTime.weekday(.wide).hour().minute().locale(Locale(identifier: store.snapshot.locale)))
                    .modifier(NativeScaledFont(size: 12, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .caption))
            }
            Spacer(minLength: 0)
        }.foregroundStyle(NativePalette.statusText)
    }
}
