import SwiftUI

struct ConversationScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversationID: UUID
    @State private var liveExpanded = true
    @State private var atBottom = true
    @State private var awaitingBottomAnchor = false
    @State private var scrollAccess = NativeConversationScrollAccess()
    @State private var loadingHistory = false
    @State private var historyPull = HistoryPullState()
    @State private var historyOffset: Double = 0
    @State private var historyAnchor: UUID?
    @State private var historyAnchorID: String?
    @State private var historyWasPrepended = false
    @State private var scrollIsIdle = true
    #if DEBUG
    @State private var diagnosticHistoryRequests = 0
    #endif
    var body: some View {
        if let conversation = session.conversation(conversationID) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        ConversationStatusBanners(conversation: conversation)
                        if conversation.detailError {
                            ContentUnavailableView {
                                Label(preferences.text("会话加载失败", "Conversation could not load"), systemImage: "exclamationmark.bubble")
                            } actions: {
                                Button(preferences.text("重试", "Retry")) { Task { await session.refreshConversation(conversationID) } }
                            }
                        } else {
                            if loadingHistory || conversation.historyLoading {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(AgentTheme.ink.opacity(0.6))
                                    .frame(maxWidth: .infinity, minHeight: 24)
                                    .accessibilityLabel(preferences.text("正在加载历史消息", "Loading earlier messages"))
                            } else if conversation.historyError {
                                Text(preferences.text("加载失败，再次下拉重试", "Could not load. Pull down again to retry"))
                                    .font(.body).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity)
                            }
                            ForEach(conversation.messages) { message in
                                MessageView(message: message, conversationID: conversationID).id(message.id)
                            }
                            if !conversation.liveCommentary.isEmpty {
                                CommentaryHistoryView(entries: conversation.liveCommentary, expanded: $liveExpanded, completed: false)
                            }
                            if conversation.phase == .running { ThinkingIndicator() }
                            QueuedMessagesView(conversationID: conversationID)
                            Color.clear.frame(height: 1).padding(.bottom, 14).id("bottom")
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    .background(NativeConversationScrollResolver(access: scrollAccess) {
                        withTransaction(Transaction(animation: nil)) { proxy.scrollTo("bottom", anchor: .bottom) }
                    })
                }
                .scrollBounceBehavior(.always)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("conversation.timeline")
                .background(alignment: .topLeading) {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") {
                        VStack {
                            Text(String(Int(historyOffset))).accessibilityIdentifier("scroll.diagnostic-offset")
                            Text(String(diagnosticHistoryRequests)).accessibilityIdentifier("scroll.diagnostic-history")
                        }.font(.system(size: 1)).opacity(0.01)
                    }
                    #endif
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
                .onScrollPhaseChange { _, phase, context in
                    let offset = Double(context.geometry.contentOffset.y + context.geometry.contentInsets.top)
                    scrollIsIdle = phase == .idle
                    switch phase {
                    case .tracking, .interacting:
                        awaitingBottomAnchor = false
                        scrollAccess.stopFollowing()
                        historyPull.dragBegan(at: offset)
                    case .decelerating:
                        historyPull.dragEnded(at: offset, willDecelerate: true)
                    case .idle:
                        historyPull.dragEnded(at: offset, willDecelerate: false)
                        historyPull.settled(at: offset)
                        restoreHistoryAnchor(proxy)
                        resumeBottomFollowingIfReached()
                    case .animating:
                        historyPull.programmaticScrollBegan()
                    @unknown default: break
                    }
                }
                .onScrollGeometryChange(for: Double.self) { geometry in
                    Double(geometry.contentOffset.y + geometry.contentInsets.top)
                } action: { _, offset in
                    historyOffset = offset
                    if historyPull.positionChanged(to: offset,
                        canLoad: conversation.loadedOlderTurns < conversation.olderTurns,
                        isLoading: loadingHistory || conversation.historyLoading) {
                        loadEarlier(proxy)
                    }
                }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.visibleRect.maxY >= geometry.contentSize.height - 2
                } action: { _, value in
                    atBottom = value
                    resumeBottomFollowingIfReached()
                }
                .onChange(of: conversation.messages.map(\.id)) { oldIDs, newIDs in
                    if let previous = historyAnchor,
                       let anchor = session.historyScrollMessageID(in: conversationID, previousID: previous, anchorID: historyAnchorID),
                       newIDs.first != anchor {
                        historyAnchor = anchor
                        historyWasPrepended = true
                        restoreHistoryAnchor(proxy)
                        return
                    }
                    guard !loadingHistory, newIDs.count > oldIDs.count, newIDs.last != oldIDs.last else { return }
                    if atBottom || conversation.messages.last?.isUser == true {
                        historyPull.programmaticScrollBegan()
                        scrollAccess.scrollToBottom()
                    }
                }
                .onChange(of: conversation.historyLoading) {
                    restoreHistoryAnchor(proxy)
                }
                .onChange(of: conversation.queue.count) {
                    if atBottom {
                        historyPull.programmaticScrollBegan()
                        scrollAccess.scrollToBottom()
                    }
                }
                .onChange(of: conversationID) {
                    resetHistory()
                }
                .onChange(of: session.nativeSnapshot.contextId) {
                    resetHistory()
                }
                .overlay(alignment: .bottom) {
                    if !atBottom && !conversation.detailError {
                        ScrollToBottomButton { scrollToLatest(proxy) }
                            .padding(.bottom, 4)
                            .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.15), value: atBottom)
            }
            .background(AgentTheme.page)
            .modifier(ConversationHeader(conversationID: conversationID))
            .modifier(ConversationComposerInset(conversationID: conversationID))

        } else { ContentUnavailableView(preferences.text("会话不可用", "Conversation unavailable"), systemImage: "bubble.left") }
    }
    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        historyPull.programmaticScrollBegan()
        historyAnchor = nil; historyAnchorID = nil; historyWasPrepended = false
        // 让LazyVStack按末尾ID实现目标条目，不能跳到仍在估算的contentSize坐标。
        scrollAccess.stopFollowing()
        awaitingBottomAnchor = true
        proxy.scrollTo("bottom", anchor: .bottom)
    }
    private func resumeBottomFollowingIfReached() {
        guard awaitingBottomAnchor, atBottom, scrollIsIdle else { return }
        awaitingBottomAnchor = false
        scrollAccess.resumeFollowing()
    }
    private func loadEarlier(_ proxy: ScrollViewProxy) {
        guard !loadingHistory, let conversation = session.conversation(conversationID),
              !conversation.historyLoading, conversation.loadedOlderTurns < conversation.olderTurns else { return }
        #if DEBUG
        diagnosticHistoryRequests += 1
        #endif
        let context = session.nativeSnapshot.contextId
        historyAnchor = conversation.messages.first?.id
        historyAnchorID = historyAnchor.flatMap { session.historyScrollAnchor(for: $0) }
        historyWasPrepended = false
        loadingHistory = true
        Task {
            await session.loadEarlier(conversationID)
            guard !Task.isCancelled, session.selectedConversationID == conversationID,
                  session.nativeSnapshot.contextId == context else { return }
            // 等手势结束且加载提示移除后恢复，避免手指仍在拖动时覆盖 scrollTo。
            if session.conversation(conversationID)?.messages.first?.id == historyAnchor {
                historyAnchor = nil; historyAnchorID = nil
            }
            loadingHistory = false
            historyPull.loadingFinished(at: historyOffset)
            restoreHistoryAnchor(proxy)
        }
    }
    private func restoreHistoryAnchor(_ proxy: ScrollViewProxy) {
        guard scrollIsIdle, !loadingHistory,
              session.conversation(conversationID)?.historyLoading == false,
              historyWasPrepended, let anchor = historyAnchor else { return }
        historyPull.programmaticScrollBegan()
        proxy.scrollTo(anchor, anchor: .top)
        historyAnchor = nil
        historyAnchorID = nil
        historyWasPrepended = false
    }
    private func resetHistory() {
        awaitingBottomAnchor = false
        scrollAccess.stopFollowing()
        historyPull.reset()
        historyAnchor = nil; historyAnchorID = nil
        loadingHistory = false; historyWasPrepended = false; scrollIsIdle = true
    }
}
