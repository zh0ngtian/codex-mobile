import SwiftUI

struct NativeSettingsPanelDestination: View {
    let store: NativeUIStore
    var body: some View {
        Group {
            if let panel = store.snapshot.panel {
                if panel.id == "devices" {
                    NativeDevicePanelView(panel: panel, store: store)
                } else if panel.id == "settings:notifications" {
                    NativeSettingsNotificationsView(panel: panel, store: store)
                } else {
                    NativePanelContentView(panel: panel, store: store)
                        .navigationBarBackButtonHidden(panel.dismissible == false)
                        .toolbarVisibility(.visible, for: .navigationBar)
                }
            } else if let error = store.commandError {
                Text(error).foregroundStyle(.red).textSelection(.enabled).padding()
            } else { ProgressView(store.label("正在加载", "Loading")) }
        }
    }
}
