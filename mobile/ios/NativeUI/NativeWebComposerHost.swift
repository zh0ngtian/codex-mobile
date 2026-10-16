import SwiftUI

/// 宿主常驻在hybrid分支；sheet呈现器不随panel或输入内容的变化重建。
struct NativeWebComposerHost: View {
    @Bindable var store: NativeUIStore
    let availableHeight: CGFloat
    @State private var supplementaryHeight: CGFloat = 0
    @Environment(\.nativeUIBridge) private var bridge
    var body: some View {
        Group {
            if store.webComposerVisible {
                VStack(spacing: 4) {
                    if hasSupplementaryContent {
                        VStack(spacing: 4) {
                            if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                            if let error = store.commandError { Text(error).font(.caption).foregroundStyle(.red) }
                            if let mentions = store.snapshot.mentions, !mentions.isEmpty {
                                NativeMentionSuggestions(items: mentions, store: store, context: store.snapshot.contextId).padding(.horizontal, 12)
                            }
                        }
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { supplementaryHeight = $0 }
                    }
                    NativeComposerView(store: store, contextID: store.snapshot.contextId, availableHeight: availableHeight - (hasSupplementaryContent ? supplementaryHeight + 4 : 0)).id(store.contextKey)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("native-web-composer")
                .background { NativeComposerLayoutProbe(contextID: store.contextKey, bridge: bridge) }
            }
        }
        .sheet(item: panelBinding) { panel in NativePanelView(panel: panel, store: store) }
        .tint(NativePalette.accent)
        .environment(\.locale, Locale(identifier: store.snapshot.locale))
    }
    private var hasSupplementaryContent: Bool {
        store.notice != nil || store.commandError != nil || !(store.snapshot.mentions?.isEmpty ?? true)
    }
    private var panelBinding: Binding<NativePanel?> {
        let presentedID = store.snapshot.panel?.id
        return Binding(get: { store.webComposerVisible ? store.snapshot.panel : nil }, set: { value in
            if value == nil { store.closePanel(expectedID: presentedID) }
        })
    }
}
