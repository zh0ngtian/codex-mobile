import SwiftUI

struct NativeConversationView: View {
    @Bindable var store: NativeUIStore
    let availableHeight: CGFloat
    @State private var supplementaryHeight: CGFloat = 0
    @ScaledMetric(relativeTo: .title3) private var greetingSize = 18
    @State private var composerFocused = false
    var body: some View {
        Group {
            if hasTimeline {
                NativeTimelineView(store: store, timeline: store.timeline(for: store.threadKey)).id(store.threadKey)
            } else {
                VStack(spacing: 0) {
                    if !store.snapshot.ready {
                        VStack(spacing: 16) {
                            ProgressView(store.label("正在加载", "Loading"))
                            Button(store.label("使用旧界面恢复", "Recover Using Web Interface")) { store.showLegacyForRecovery = true }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if noDevice {
                        NativeNoDeviceView(store: store)
                    } else {
                        Text(store.label("你好，让我们开始吧", "Hello, let’s get started"))
                            .font(.system(size: greetingSize * store.snapshot.fontScale, weight: .semibold))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) { NativeConversationChrome(store: store, noDevice: noDevice) }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
        .clipped()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !noDevice {
                VStack(spacing: 4) {
                    if hasSupplementaryContent {
                        VStack(spacing: 4) {
                            if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                            if let mentions = store.snapshot.mentions, !mentions.isEmpty {
                                NativeMentionSuggestions(items: mentions, store: store, context: store.snapshot.contextId).padding(.horizontal, 12)
                            }
                        }
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { supplementaryHeight = $0 }
                    }
                    NativeComposerView(store: store, onFocusChanged: { composerFocused = $0 }, availableHeight: availableHeight - (hasSupplementaryContent ? supplementaryHeight + 4 : 0)).id(store.contextKey)
                }
            }
        }
        .background { NativePageBackground(focused: composerFocused) }
    }
    private var hasSupplementaryContent: Bool { store.notice != nil || !(store.snapshot.mentions?.isEmpty ?? true) }
    private var hasTimeline: Bool { store.snapshot.ready && !noDevice && !store.snapshot.messages.isEmpty }
    private var noDevice: Bool { !store.isReference && store.snapshot.ready && store.snapshot.backends.isEmpty }
}
