import SwiftUI

struct NativeUIHost<Legacy: View>: View {
    private let legacy: Legacy
    @State private var bridge = NativeUIBridge()
    @Environment(\.scenePhase) private var scenePhase
    private var store: NativeUIStore { bridge.store }
    private var isConversationFixture: Bool {
        #if DEBUG
        bridge.conversationFixture != nil
        #else
        false
        #endif
    }
    init(@ViewBuilder legacy: () -> Legacy) { self.legacy = legacy() }
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // 同一个 WebView 始终挂在真实视图树中，继续执行数据与已有系统桥。
                if !store.isReference && !isConversationFixture {
                    legacy
                    .opacity(store.nativeEnabled && !store.showLegacyForRecovery ? 0.01 : 1)
                    .allowsHitTesting(!store.nativeEnabled || store.showLegacyForRecovery)
                    .accessibilityHidden(store.nativeEnabled && !store.showLegacyForRecovery)
                }
                if store.nativeEnabled && !store.showLegacyForRecovery {
                    if store.isReference {
                        NativeRootView(store: store, availableHeight: geometry.size.height)
                    } else {
                        RootView()
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("agent-ui-root")
                            .environment(bridge.agentSession)
                            .environment(bridge.agentPreferences)
                            .environment(\.locale, Locale(identifier: bridge.agentPreferences.isEnglish ? "en" : "zh-Hans"))
                            .tint(AgentTheme.ink)
                            #if DEBUG
                            .modifier(AgentTypographyFixture())
                            #endif
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)

        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if let fixture = bridge.conversationFixture {
                Text("\(fixture.historyRequestCount)")
                    .font(.system(size: 1)).frame(width: 1, height: 1).allowsHitTesting(false)
                    .accessibilityIdentifier("history-request-count")
            }
            if NativeConversationLoadProfile.enabled {
                Text(NativeConversationLoadProfile.shared.status)
                    .font(.system(size: 1)).frame(width: 1, height: 1).opacity(0.01).allowsHitTesting(false)
                    .accessibilityIdentifier("load-profile.status")
            }
            if ProcessInfo.processInfo.arguments.contains("--native-ui-preference-probe") {
                Text(store.savedNativePreference ? "1" : "0")
                    .font(.system(size: 1)).frame(width: 1, height: 1).allowsHitTesting(false)
                    .accessibilityIdentifier("native-ui-saved-preference")
            }
        }
        #endif
        .background {
            if #available(iOS 18.0, *) { NativeProMotionSupport().frame(width: 0, height: 0).accessibilityHidden(true) }
        }
        .environment(\.nativeUIBridge, bridge)
        .onChange(of: store.showLegacyForRecovery, initial: true) { _, recovery in
            bridge.setLegacyVisible(!store.nativeEnabled || recovery)
            if recovery { bridge.recoverLegacy() }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in bridge.setActive(phase == .active) }
        .onChange(of: bridge.agentPreferences.appearance, initial: true) { _, appearance in
            AppAppearanceController.apply(appearance)
        }
    }
}
