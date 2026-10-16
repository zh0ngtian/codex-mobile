import SwiftUI

struct NativeUIHost<Legacy: View>: View {
    private let legacy: Legacy
    @State private var bridge = NativeUIBridge()
    @Environment(\.scenePhase) private var scenePhase
    private var store: NativeUIStore { bridge.store }
    init(@ViewBuilder legacy: () -> Legacy) { self.legacy = legacy() }
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // 同一个 WebView 始终挂在真实视图树中，继续执行数据与已有系统桥。
                if !store.isReference {
                    legacy
                    .opacity(store.nativeEnabled && !store.showLegacyForRecovery ? 0.01 : 1)
                    .allowsHitTesting(!store.nativeEnabled || store.showLegacyForRecovery)
                    .accessibilityHidden(store.nativeEnabled && !store.showLegacyForRecovery)
                }
                if store.nativeEnabled && !store.showLegacyForRecovery {
                    NativeRootView(store: store, availableHeight: geometry.size.height)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .overlay(alignment: .bottom) {
                if store.composerEnabled && !store.nativeEnabled && !store.showLegacyForRecovery {
                    NativeWebComposerHost(store: store, availableHeight: geometry.size.height)
                }
            }
        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if ProcessInfo.processInfo.arguments.contains("--native-ui-preference-probe") {
                Text(store.savedNativePreference ? "1" : "0")
                    .font(.system(size: 1)).frame(width: 1, height: 1).allowsHitTesting(false)
                    .accessibilityIdentifier("native-ui-saved-preference")
            }
        }
        #endif
        .environment(\.nativeUIBridge, bridge)
        .onChange(of: store.showLegacyForRecovery, initial: true) { _, recovery in
            bridge.setLegacyVisible(!store.nativeEnabled || recovery)
            if recovery { bridge.recoverLegacy() }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in bridge.setActive(phase == .active) }
    }
}
