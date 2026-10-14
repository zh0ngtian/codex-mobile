import SwiftUI

struct NativeSettingsView: View {
    @Bindable var store: NativeUIStore
    @Environment(\.dismiss) private var dismiss
    @State private var detailOpen = false
    @AppStorage(NativeUIStore.preferenceKey) private var useNativeUI = false
    var body: some View {
        NavigationStack {
            Form {
                Section(store.label("应用", "Application")) {
                    setting("语言", "Language", symbol: "globe", id: "language")
                    setting("字体大小", "Font Size", symbol: "textformat.size", id: "font")
                    Toggle(store.label("使用原生界面", "Use Native Interface"), isOn: $useNativeUI)
                        .accessibilityIdentifier("native-ui-preference")
                    Text(store.label("下次完整启动时生效", "Applies at the next full launch")).font(.caption).foregroundStyle(.secondary)
                }.listRowBackground(NativePalette.settingsCard)
                Section(store.label("连接", "Connection")) {
                    setting("设备", "Devices", symbol: "desktopcomputer", id: "devices")
                    setting("传输方式", "Transport", symbol: "network", id: "transport")
                }.listRowBackground(NativePalette.settingsCard)
                Section(store.label("通知与更新", "Notifications and Updates")) {
                    setting("通知", "Notifications", symbol: "bell", id: "notifications")
                    setting("应用更新", "App Updates", symbol: "arrow.triangle.2.circlepath", id: "updates")
                }
                .listRowBackground(NativePalette.settingsCard)
            }.scrollContentBackground(.hidden).background(NativePalette.settings)
                .environment(\.defaultMinListRowHeight, 50)
                .navigationTitle(store.label("设置", "Settings")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if store.snapshot.panel?.dismissible != false {
                        ToolbarItem(placement: .confirmationAction) { Button(store.label("完成", "Done")) { store.closePanel(); store.settingsOpen = false; dismiss() } }
                    }
                }
                .navigationDestination(isPresented: detailBinding) { NativeSettingsPanelDestination(store: store) }
                .onChange(of: store.snapshot.panel?.id, initial: true) { _, id in detailOpen = id != nil }
        }
        .interactiveDismissDisabled(store.snapshot.panel?.dismissible == false)
        .modifier(NativeScaledFont(size: 16, scale: store.snapshot.fontScale))
    }
    private var detailBinding: Binding<Bool> {
        Binding(get: { detailOpen }, set: { value in if !value { store.closePanel() }; detailOpen = value })
    }
    private func setting(_ chinese: String, _ english: String, symbol: String, id: String) -> some View {
        Button {
            detailOpen = true
            store.command("settings.open", ["id": .string(id)])
        } label: {
            HStack { Label(store.label(chinese, english), systemImage: symbol); Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true) }
        }.foregroundStyle(.primary)
    }
}
