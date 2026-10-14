import SwiftUI

struct NativeRootView: View {
    @Bindable var store: NativeUIStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(geometry.size.width * 0.8, 420)
            ZStack(alignment: .leading) {
                NativePalette.canvas.ignoresSafeArea()
                if store.sidebarOpen {
                    NativeSidebarView(store: store).frame(width: drawerWidth)
                }
                NativeConversationView(store: store)
                    .background(NativePalette.canvas)
                    .clipShape(.rect(cornerRadius: store.sidebarOpen && !reduceMotion ? 22 : 0))
                    .scaleEffect(store.sidebarOpen && !reduceMotion ? 0.95 : 1, anchor: .leading)
                    .offset(x: store.sidebarOpen && !reduceMotion ? drawerWidth : 0)
                    .opacity(store.sidebarOpen && reduceMotion ? 0 : 1)
                    .shadow(color: .black.opacity(store.sidebarOpen ? 0.06 : 0), radius: 12)
                    .allowsHitTesting(!store.sidebarOpen)
                    .accessibilityHidden(store.sidebarOpen)
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.24), value: store.sidebarOpen)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-ui-root")
        .sheet(isPresented: settingsBinding) { NativeSettingsView(store: store) }
        .sheet(item: panelBinding) { panel in NativePanelView(panel: panel, store: store) }
        .alert(store.textPrompt?.title ?? "", isPresented: promptBinding, presenting: store.textPrompt) { prompt in
            TextField(store.label("名称", "Name"), text: $store.promptValue)
            Button(store.label("取消", "Cancel"), role: .cancel) { store.textPrompt = nil }
            Button(store.label("保存", "Save")) { store.confirmTextPrompt(prompt) }
                .disabled(store.promptValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .tint(NativePalette.accent)
        .environment(\.locale, Locale(identifier: store.snapshot.locale))
    }
    private var settingsBinding: Binding<Bool> {
        Binding(get: { store.settingsOpen }, set: { value in
            if !value { store.closePanel() }
            store.settingsOpen = value
        })
    }
    private var panelBinding: Binding<NativePanel?> {
        let presentedID = store.snapshot.panel?.id
        return Binding(get: { store.settingsOpen ? nil : store.snapshot.panel }, set: { value in
            if value == nil { store.closePanel(expectedID: presentedID) }
        })
    }
    private var promptBinding: Binding<Bool> {
        Binding(get: { store.textPrompt != nil }, set: { if !$0 { store.textPrompt = nil } })
    }
}
