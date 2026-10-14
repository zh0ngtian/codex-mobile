import SwiftUI

struct NativeSettingsPanelDestination: View {
    let store: NativeUIStore
    var body: some View {
        Group {
            if let panel = store.snapshot.panel {
                NativePanelContentView(panel: panel, store: store)
                    .navigationBarBackButtonHidden(panel.dismissible == false)
            } else if let error = store.commandError {
                Text(error).foregroundStyle(.red).textSelection(.enabled).padding()
            } else { ProgressView(store.label("正在加载", "Loading")) }
        }
    }
}
