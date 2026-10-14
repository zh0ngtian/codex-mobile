import SwiftUI

struct NativeNoDeviceView: View {
    let store: NativeUIStore
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "desktopcomputer").font(.system(size: 40)).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(store.label("添加设备后即可连接 Codex。", "Add a device to connect to Codex."))
                .modifier(NativeScaledFont(size: 18, scale: store.snapshot.fontScale)).multilineTextAlignment(.center)
            Button(store.label("添加设备", "Add Device"), systemImage: "plus") { store.command("settings.open", ["id": .string("devices")]) }
                .buttonStyle(.borderedProminent).controlSize(.large).frame(minHeight: 44)
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
