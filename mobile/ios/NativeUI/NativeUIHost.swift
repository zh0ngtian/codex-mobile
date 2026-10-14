import SwiftUI

struct NativeUIHost<Legacy: View>: View {
    private let legacy: Legacy
    @State private var bridge = NativeUIBridge()
    private var store: NativeUIStore { bridge.store }
    init(@ViewBuilder legacy: () -> Legacy) { self.legacy = legacy() }
    var body: some View {
        ZStack {
            // 同一个 WebView 始终挂在真实视图树中，继续执行数据与已有系统桥。
            if !store.isReference {
                legacy
                .opacity(store.nativeEnabled && !store.showLegacyForRecovery ? 0.01 : 1)
                .allowsHitTesting(!store.nativeEnabled || store.showLegacyForRecovery)
                .accessibilityHidden(store.nativeEnabled && !store.showLegacyForRecovery)
            }
            if store.nativeEnabled && !store.showLegacyForRecovery {
                NativeRootView(store: store)
            }
        }
        .environment(\.nativeUIBridge, bridge)
    }
}
