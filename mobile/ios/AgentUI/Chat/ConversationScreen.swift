import SwiftUI

struct ConversationScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversationID: UUID
    @State private var liveExpanded = true
    @State private var atBottom = true
    @State private var loadingHistory = false
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
                            if conversation.loadedOlderTurns < conversation.olderTurns {
                                Button { loadEarlier(proxy) } label: {
                                    HStack {
                                        if conversation.historyLoading {
                                            ProgressView()
                                                .controlSize(.small)
                                                .tint(AgentTheme.ink.opacity(0.6))
                                        }
                                        Text(conversation.historyError ? preferences.text("加载失败，点击重试", "Could not load. Retry") : preferences.text("加载更早消息", "Load earlier messages"))
                                    }
                                    .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                                }
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(Color.primary.opacity(0.18), lineWidth: 1)
                                }
                                .disabled(conversation.historyLoading)
                                .accessibilityIdentifier("history.loadEarlier")
                            }
                            ForEach(conversation.messages) { message in
                                MessageView(message: message, conversationID: conversationID).id(message.id)
                            }
                            if !conversation.liveCommentary.isEmpty {
                                CommentaryHistoryView(entries: conversation.liveCommentary, expanded: $liveExpanded, completed: false)
                            }
                            if conversation.phase == .running { ThinkingIndicator() }
                            QueuedMessagesView(conversationID: conversationID)
                            Color.clear.frame(height: 1).id("bottom")
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 14)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.contentOffset.y + geometry.contentInsets.top
                } action: { oldValue, newValue in
                    if oldValue > 0 && newValue <= 0 && !loadingHistory && !conversation.historyError { loadEarlier(proxy) }
                }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 90
                } action: { _, value in atBottom = value }
                .onChange(of: conversation.messages.count) { oldCount, newCount in
                    guard !loadingHistory, newCount > oldCount else { return }
                    if atBottom || conversation.messages.last?.isUser == true { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: conversation.queue.count) { if atBottom { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .background {
                LinearGradient(colors: [AgentTheme.page, AgentTheme.page, AgentTheme.code], startPoint: .top, endPoint: .bottom).ignoresSafeArea(edges: .bottom)
            }
            .safeAreaInset(edge: .top, spacing: 0) { ConversationHeader(conversationID: conversationID) }
            .safeAreaInset(edge: .bottom, spacing: 0) { ComposerBar(conversationID: conversationID) }
            .toolbarVisibility(.hidden, for: .navigationBar)
        } else { ContentUnavailableView(preferences.text("会话不可用", "Conversation unavailable"), systemImage: "bubble.left") }
    }
    private func loadEarlier(_ proxy: ScrollViewProxy) {
        guard !loadingHistory else { return }
        let anchor = session.conversation(conversationID)?.messages.first?.id
        loadingHistory = true
        Task {
            await session.loadEarlier(conversationID)
            if let anchor { proxy.scrollTo(anchor, anchor: .top) }
            loadingHistory = false
        }
    }
}
