import SwiftUI

struct NativeSettingsView: View {
    @Bindable var store: NativeUIStore
    @Environment(\.dismiss) private var dismiss
    @State private var detailOpen = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text(store.label("设置", "Settings")).modifier(NativeScaledFont(size: 21, scale: store.snapshot.fontScale, weight: .bold, relativeTo: .title2))
                    Spacer()
                    Button(store.label("关闭", "Close"), systemImage: "xmark", action: close)
                        .labelStyle(.iconOnly).font(.body.bold()).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).background(NativePalette.settingsCard, in: .circle)
                        .accessibilityIdentifier("native-settings-close")
                        .disabled(store.snapshot.panel?.dismissible == false)
                }.padding(.leading, 24).padding(.trailing, 16).padding(.top, 12).padding(.bottom, 12)
                ScrollView {
                    VStack(spacing: 22) {
                        NativeSettingsGroupView(title: store.label("应用", "Application")) {
                            NativeSettingsChoiceRow(title: store.label("语言", "Language"), symbol: "globe", item: item("language"), store: store)
                            separator
                            NativeSettingsChoiceRow(title: store.label("字体大小", "Font Size"), symbol: "textformat.size", item: item("font"), store: store)
                            separator
                            Toggle(isOn: preferenceBinding) { Label(store.label("使用原生界面", "Use Native Interface"), systemImage: "iphone") }
                                .padding(.horizontal, 15).frame(minHeight: 55)
                                .accessibilityIdentifier("native-ui-preference")
                                .disabled(store.preferenceSaving || !store.canChangeNativePreference)
                        }
                        VStack(alignment: .leading, spacing: 5) {
                            Text(store.label("下次完整启动时生效", "Applies at the next full launch")).font(.caption).foregroundStyle(.secondary)
                            if store.preferenceSaving { ProgressView(store.label("正在保存输入与附件…", "Saving text and attachments…")) }
                            if let error = store.preferenceError { Text(error).foregroundStyle(.red).accessibilityIdentifier("native-ui-preference-error") }
                            if let error = item("font-error")?.text { Text(error).foregroundStyle(.red) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 15).padding(.top, -15)
                        NativeSettingsGroupView(title: store.label("连接", "Connection")) {
                            NativeSettingsNavigationRow(title: store.label("设备", "Devices"), symbol: "desktopcomputer", value: store.label("\(store.navigationBackends.count) 台", "\(store.navigationBackends.count) devices")) { open("devices") }
                            separator
                            NativeSettingsChoiceRow(title: store.label("传输方式", "Transport"), symbol: "network", item: item("transport"), store: store)
                        }
                        Text(transportHint)
                            .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 15).padding(.top, -15)
                        NativeSettingsGroupView(title: store.label("通知", "Notifications")) {
                            NativeSettingsNavigationRow(title: store.label("通知", "Notifications"), symbol: "bell", value: selected("push")) { open("notifications") }
                        }
                    }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
                }.scrollIndicators(.hidden)
                Button { open("updates") } label: {
                    HStack(spacing: 7) { Text("Codex Mobile"); Text(version) }
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.plain).accessibilityLabel(store.label("版本与检查更新", "Version and Check for Updates"))
                    .accessibilityIdentifier("native-settings-version")
            }
            .background(NativePalette.settings)
            .navigationTitle(store.label("设置", "Settings")).navigationBarTitleDisplayMode(.inline)
            .toolbarVisibility(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: detailBinding) {
                NativeSettingsPanelDestination(store: store).toolbarVisibility(.visible, for: .navigationBar)
            }
            .task { store.command("settings.open", ["id": .string("settings")]) }
            .onChange(of: store.snapshot.panel?.id, initial: true) { _, id in
                if let id { detailOpen = id != "settings:root" }
            }
        }
        .interactiveDismissDisabled(store.snapshot.panel?.dismissible == false)
        .presentationDetents([.large]).presentationDragIndicator(.hidden)
        .modifier(NativeScaledFont(size: 14, scale: store.snapshot.fontScale))
    }

    private var separator: some View { Divider().padding(.leading, 48).padding(.trailing, 15) }
    private var transportHint: String {
        item("transport")?.value == "stream" ? store.label("实时接收回复，切换后自动重连所有设备", "Replies arrive live. Changing transport reconnects all devices.") : store.label("定时同步回复，切换后自动重连所有设备", "Replies sync periodically. Changing transport reconnects all devices.")
    }
    private func item(_ id: String) -> NativePanelItem? { store.snapshot.panel?.id == "settings:root" ? store.snapshot.panel?.items.first { $0.id == id } : nil }
    private func selected(_ id: String) -> String { let field = item(id); return field?.options?.first { $0.value == field?.value }?.title ?? "" }
    private var version: String {
        item("app-version")?.text ?? "v\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")"
    }
    private var preferenceBinding: Binding<Bool> { Binding(get: { store.savedNativePreference }, set: { store.requestNativePreference($0) }) }
    private var detailBinding: Binding<Bool> {
        Binding(get: { detailOpen }, set: { value in
            detailOpen = value
            if !value { store.command("settings.open", ["id": .string("settings")]) }
        })
    }
    private func open(_ id: String) { detailOpen = true; store.command("settings.open", ["id": .string(id)]) }
    private func close() { store.closePanel(); store.settingsOpen = false; dismiss() }
}
