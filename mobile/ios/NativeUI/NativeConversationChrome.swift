import SwiftUI

/// 滚动及空状态共用的顶部界面；timeline 直接将其作为 ScrollView 的安全区内容。
struct NativeConversationChrome: View {
    let store: NativeUIStore
    var noDevice = false
    var body: some View {
        VStack(spacing: 0) {
            NativeConversationHeader(store: store, noDevice: noDevice)
            NativeConversationStatusView(store: store)
            if let error = store.snapshot.error ?? store.commandError {
                VStack(spacing: 12) {
                    Text(error).font(.callout).textSelection(.enabled)
                    Button(store.label("使用旧界面恢复", "Recover Using Web Interface")) { store.showLegacyForRecovery = true }
                }.padding().frame(maxWidth: .infinity).background(.red.opacity(0.08))
            }
        }
        .accessibilityHidden(store.sidebarOpen)
        .allowsHitTesting(!store.sidebarOpen)
    }
}
