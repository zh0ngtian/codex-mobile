import SwiftUI

struct NativeTimelineView: View {
    let store: NativeUIStore
    @Bindable var timeline: NativeTimelineState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var userScrolling = false
    @State private var requestedAtTop = false
    @State private var contentFits = true

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 30) {
                    if let older = olderAction {
                        NativePanelItemView(item: older, store: store, scope: .message("history:\(store.threadKey)"))
                    }
                    ForEach(store.snapshot.messages) { message in NativeMessageView(message: message, store: store) }
                }
                .scrollTargetLayout()
                .padding(.top, 20).padding(.bottom, 24)
            }
            .accessibilityIdentifier("native-timeline")
            .safeAreaInset(edge: .top, spacing: 0) {
                NativeConversationChrome(store: store).zIndex(1)
            }
            .scrollClipDisabled()
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .scrollPosition(id: $timeline.visibleMessageID, anchor: .top)
            .scrollDismissesKeyboard(.interactively)
            .onScrollPhaseChange { _, phase in userScrolling = phase == .interacting || phase == .decelerating }
            .onScrollGeometryChange(for: NativeScrollMetrics.self) { geometry in
                NativeScrollMetrics(atTop: geometry.contentOffset.y + geometry.contentInsets.top < 20,
                    atBottom: geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 60,
                    height: geometry.containerSize.height,
                    contentFits: geometry.contentSize.height <= geometry.containerSize.height)
            } action: { _, metrics in
                contentFits = metrics.contentFits
                if userScrolling { timeline.followsTail = metrics.atBottom }
                if !metrics.atTop { requestedAtTop = false }
                if metrics.atTop, userScrolling, !requestedAtTop, let older = olderAction, older.disabled != true {
                    requestedAtTop = true
                    store.perform(older.command)
                }
                if !userScrolling, timeline.followsTail, !metrics.atBottom { scrollToTail(proxy) }
            }
            .onChange(of: timeline.revision) { restoreOrFollow(proxy) }
            .onAppear { restoreOrFollow(proxy) }
            .overlay(alignment: .bottomTrailing) {
                if !timeline.followsTail {
                    Button(store.label("转至底部", "Jump to Latest"), systemImage: "arrow.down") { jumpToTail(proxy) }
                        .labelStyle(.iconOnly).frame(width: 44, height: 44)
                        .background(.regularMaterial, in: .circle).overlay { Circle().stroke(.primary.opacity(0.08)) }
                        .padding(16).accessibilityIdentifier("native-jump-to-bottom")
                }
            }
        }
    }
    private var olderAction: NativePanelItem? { store.snapshot.conversationActions?.first { $0.command?.name == "thread.older" } }
    private func restoreOrFollow(_ proxy: ScrollViewProxy) {
        if let anchor = timeline.pendingAnchorID {
            proxy.scrollTo(anchor, anchor: .top)
            timeline.didRestoreAnchor()
        } else if timeline.followsTail { scrollToTail(proxy) }
    }
    private func scrollToTail(_ proxy: ScrollViewProxy) {
        guard !contentFits else { return }
        guard let last = store.snapshot.messages.last?.id else { return }
        proxy.scrollTo(last, anchor: .bottom)
    }
    private func jumpToTail(_ proxy: ScrollViewProxy) {
        timeline.followsTail = true
        if reduceMotion { scrollToTail(proxy) }
        else { withAnimation(.easeOut(duration: 0.2)) { scrollToTail(proxy) } }
    }
}
