import SwiftUI

struct NativeDeviceActionButton: View {
    let item: NativePanelItem
    let deviceTitle: String
    let store: NativeUIStore

    var body: some View {
        Button(role: destructive ? .destructive : nil, action: perform) {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol).accessibilityHidden(true) }
                Text(item.title ?? "").multilineTextAlignment(.center)
            }
            .modifier(NativeScaledFont(size: 11, scale: store.snapshot.fontScale, relativeTo: .caption))
            .frame(maxWidth: .infinity, minHeight: 44).contentShape(.rect)
        }
        .buttonStyle(.plain).foregroundStyle(destructive ? Color.red : Color.secondary)
        .disabled(item.disabled == true || item.command == nil).opacity(item.disabled == true ? 0.28 : 1)
        .accessibilityLabel("\(item.title ?? "") \(deviceTitle)")
        .accessibilityIdentifier("native-device-action-\(item.id)")
    }

    private var destructive: Bool { item.command?.name == "device.remove" }
    private var symbol: String? {
        if destructive { return "trash" }
        if item.command?.name == "device.move", case .number(let direction) = item.command?.params["direction"] {
            return direction < 0 ? "arrow.up" : "arrow.down"
        }
        return nil
    }
    private func perform() { store.perform(item.command) }
}
